/**
 * Tests for the v0.5.0 streaming surface.
 *
 * Covers:
 *   - parseToolInput() helper (partial JSON reassembly)
 *   - Agent.streamRun() with a fake provider (no network, no API keys)
 *   - Stream events yielded for end_turn vs tool_use
 *   - The 'no stream()' fallback in streamRun()
 *
 * Uses a `FakeStreamProvider` that yields a hard-coded sequence of
 * ChatChunks — same shape the real Anthropic / OpenAI providers
 * emit. Tests verify the agent loop's behavior, not the providers'
 * wire-format translations (those are exercised by their own
 * integration tests).
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { Agent } from '../src/core/agent.js';
import type {
  AgentStreamEvent,
  ChatChunk,
  ChatRequest,
  ChatResponse,
  Provider,
  ToolDefinition,
  ToolResult,
} from '../src/core/types.js';
import { defineTool, objectSchema, stringField } from '../src/tools/registry.js';

/** A provider that yields a pre-canned sequence of chunks from stream(). */
class FakeStreamProvider implements Provider {
  readonly name = 'fake';
  readonly model: string;
  private readonly chunksForRequest: ChatChunk[][];
  private requestIndex = 0;
  /** Optional: pre-canned chat() responses (for the no-stream fallback). */
  private readonly chatResponses: ChatResponse[] | undefined;

  constructor(model: string, chunksForRequest: ChatChunk[][], chatResponses?: ChatResponse[]) {
    this.model = model;
    this.chunksForRequest = chunksForRequest;
    this.chatResponses = chatResponses;
  }

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    if (!this.chatResponses) {
      throw new Error('FakeStreamProvider: no chat() response configured');
    }
    const response = this.chatResponses[this.requestIndex++];
    if (!response) throw new Error('FakeStreamProvider: no more chat() responses');
    return response;
  }

  async *stream(_request: ChatRequest): AsyncIterable<ChatChunk> {
    const chunks = this.chunksForRequest[this.requestIndex++];
    if (!chunks) {
      // Subsequent calls return empty stream — agent loop will treat as end_turn.
      yield {
        type: 'message_end',
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
      return;
    }
    for (const c of chunks) yield c;
  }
}

/** Provider that ONLY implements chat() — exercises the streamRun fallback. */
class ChatOnlyProvider implements Provider {
  readonly name = 'chat-only';
  readonly model = 'chat-only-1';
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    return {
      message: { role: 'assistant', content: 'fallback response from chat()' },
      usage: { inputTokens: 5, outputTokens: 3 },
      stopReason: 'end_turn',
      model: 'chat-only-1',
    };
  }
  // No stream() method.
}

const helloTool: ToolDefinition = defineTool({
  name: 'hello',
  description: 'Says hello to the named subject',
  inputSchema: objectSchema({ subject: stringField() }),
  execute: async (input: unknown): Promise<ToolResult> => {
    const { subject } = input as { subject: string };
    return { output: `Hello, ${subject}!` };
  },
});

describe('Agent.streamRun() — end_turn path', () => {
  test('yields text events + done event for a simple end_turn response', async () => {
    const provider = new FakeStreamProvider('fake-1', [
      [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world' },
        { type: 'text', text: '!' },
        { type: 'message_end', stopReason: 'end_turn', usage: { inputTokens: 4, outputTokens: 3 } },
      ],
    ]);
    const agent = new Agent({ model: provider });
    const events: AgentStreamEvent[] = [];
    for await (const e of agent.streamRun('hi')) events.push(e);

    expect(events.map((e) => e.type)).toEqual(['text', 'text', 'text', 'done']);
    const texts = events.filter((e): e is { type: 'text'; text: string } => e.type === 'text');
    expect(texts.map((e) => e.text).join('')).toBe('Hello world!');
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    if (done && done.type === 'done') {
      expect(done.output).toBe('Hello world!');
      expect(done.usage.inputTokens).toBe(4);
      expect(done.usage.outputTokens).toBe(3);
      expect(done.iterations).toBe(1);
    }
  });
});

describe('Agent.streamRun() — tool_use path', () => {
  test('yields tool_call_start, tool_call_delta, tool_result, then done', async () => {
    const provider = new FakeStreamProvider('fake-1', [
      // First call: model wants to call hello tool.
      [
        { type: 'tool_use_start', toolUse: { id: 'tu_1', name: 'hello' } },
        {
          type: 'tool_use_delta',
          toolUse: { id: 'tu_1', name: 'hello', inputDelta: '{"subject":"' },
        },
        { type: 'tool_use_delta', toolUse: { id: 'tu_1', name: 'hello', inputDelta: 'world"}' } },
        { type: 'message_end', stopReason: 'tool_use', usage: { inputTokens: 5, outputTokens: 6 } },
      ],
      // Second call: model has the tool result, finishes.
      [
        { type: 'text', text: 'The tool said hello.' },
        { type: 'message_end', stopReason: 'end_turn', usage: { inputTokens: 8, outputTokens: 4 } },
      ],
    ]);
    const agent = new Agent({ model: provider, tools: [helloTool] });
    const events: AgentStreamEvent[] = [];
    for await (const e of agent.streamRun('greet the world')) events.push(e);

    const types = events.map((e) => e.type);
    expect(types).toContain('tool_call_start');
    expect(types).toContain('tool_call_delta');
    expect(types).toContain('tool_result');
    expect(types[types.length - 1]).toBe('done');

    const toolResult = events.find((e) => e.type === 'tool_result');
    if (toolResult && toolResult.type === 'tool_result') {
      expect(toolResult.name).toBe('hello');
      expect(toolResult.result.output).toBe('Hello, world!');
      expect(toolResult.result.isError).toBeUndefined();
    }
  });
});

describe('Agent.streamRun() — fallback for chat-only providers', () => {
  test('yields a single text event + done when stream() is not implemented', async () => {
    const agent = new Agent({ model: new ChatOnlyProvider() });
    const events: AgentStreamEvent[] = [];
    for await (const e of agent.streamRun('hi')) events.push(e);

    expect(events.length).toBe(2);
    expect(events[0]?.type).toBe('text');
    expect(events[1]?.type).toBe('done');
    if (events[0]?.type === 'text') {
      expect(events[0].text).toBe('fallback response from chat()');
    }
    if (events[1]?.type === 'done') {
      expect(events[1].output).toBe('fallback response from chat()');
      expect(events[1].iterations).toBe(1);
    }
  });
});

describe('Agent.streamRun() — error in tool execution', () => {
  test('error result flows through to the model and loop continues', async () => {
    const brokenTool: ToolDefinition = defineTool({
      name: 'broken',
      description: 'Always throws',
      inputSchema: objectSchema({}),
      execute: async (): Promise<ToolResult> => {
        throw new Error('boom');
      },
    });
    const provider = new FakeStreamProvider('fake-1', [
      [
        { type: 'tool_use_start', toolUse: { id: 'tu_b', name: 'broken' } },
        { type: 'tool_use_delta', toolUse: { id: 'tu_b', name: 'broken', inputDelta: '{}' } },
        { type: 'message_end', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 2 } },
      ],
      [
        { type: 'text', text: 'I see the error.' },
        { type: 'message_end', stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
    ]);
    const agent = new Agent({ model: provider, tools: [brokenTool] });
    const events: AgentStreamEvent[] = [];
    for await (const e of agent.streamRun('try the broken tool')) events.push(e);

    const toolResult = events.find((e) => e.type === 'tool_result');
    if (toolResult && toolResult.type === 'tool_result') {
      expect(toolResult.result.isError).toBe(true);
      expect(toolResult.result.output).toContain('boom');
    }
    expect(events[events.length - 1]?.type).toBe('done');
  });
});

describe('Agent.streamRun() — tool input JSON reassembly', () => {
  test('reassembles partial JSON across multiple deltas', async () => {
    // The input arrives as four separate delta chunks.
    const provider = new FakeStreamProvider('fake-1', [
      [
        { type: 'tool_use_start', toolUse: { id: 'tu_2', name: 'hello' } },
        { type: 'tool_use_delta', toolUse: { id: 'tu_2', name: 'hello', inputDelta: '{"sub' } },
        { type: 'tool_use_delta', toolUse: { id: 'tu_2', name: 'hello', inputDelta: 'ject":' } },
        { type: 'tool_use_delta', toolUse: { id: 'tu_2', name: 'hello', inputDelta: '"alice' } },
        { type: 'tool_use_delta', toolUse: { id: 'tu_2', name: 'hello', inputDelta: '"}' } },
        { type: 'message_end', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
      ],
      [
        { type: 'text', text: 'done' },
        { type: 'message_end', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
      ],
    ]);
    const agent = new Agent({ model: provider, tools: [helloTool] });
    const toolResult = await (async () => {
      for await (const e of agent.streamRun('test')) {
        if (e.type === 'tool_result') return e;
      }
      return undefined;
    })();
    expect(toolResult).toBeDefined();
    expect(toolResult?.result.output).toBe('Hello, alice!');
  });
});
