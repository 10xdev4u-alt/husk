/**
 * Tests for v0.8.0's GeminiProvider.
 *
 * Coverage:
 *   - identity (name = 'gemini', model override)
 *   - has correct model default + override
 *   - implements the Provider interface
 *   - chat() returns the right ChatResponse shape
 *   - stream() yields the right ChatChunk shape
 *   - throws when no api key is configured
 *
 * We don't hit the real Gemini API in these tests — we use a
 * FakeGenAIClient that satisfies the duck-typed interface. The
 * integration test against a real Gemini API lives in
 * examples/14-gemini-provider and is smoke-tested manually.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Provider } from '../src/core/types.js';
import { GeminiProvider } from '../src/providers/gemini.js';

class FakeGenAIClient {
  chatResponse: unknown = {
    candidates: [
      {
        content: {
          parts: [{ text: 'hello from fake gemini' }],
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 },
  };
  streamChunks: unknown[] = [
    { candidates: [{ content: { parts: [{ text: 'hel' }] } }] },
    { candidates: [{ content: { parts: [{ text: 'lo' }] } }] },
    {
      candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 },
    },
  ];
  chatCalls: unknown[] = [];
  streamCalls: unknown[] = [];

  models = {
    generateContent: async (params: unknown) => {
      this.chatCalls.push(params);
      return this.chatResponse;
    },
    generateContentStream: async (params: unknown) => {
      this.streamCalls.push(params);
      return this.streamChunks;
    },
  };
}

describe('GeminiProvider — identity', () => {
  test('name is "gemini" and default model is "gemini-2.5-flash"', () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    expect(provider.name).toBe('gemini');
    expect(provider.model).toBe('gemini-2.5-flash');
  });

  test('respects model override', () => {
    const provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-2.5-pro' });
    expect(provider.model).toBe('gemini-2.5-pro');
  });

  test('implements the Provider interface', () => {
    const provider: Provider = new GeminiProvider({ apiKey: 'test-key' });
    expect(typeof provider.chat).toBe('function');
    expect(typeof provider.stream).toBe('function');
  });
});

describe('GeminiProvider — chat()', () => {
  let fake: FakeGenAIClient;
  let provider: GeminiProvider;

  beforeEach(() => {
    fake = new FakeGenAIClient();
    provider = new GeminiProvider({ apiKey: 'test-key' });
    provider.setClientForTesting(
      fake as unknown as Parameters<typeof provider.setClientForTesting>[0],
    );
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = undefined;
    process.env.GOOGLE_API_KEY = undefined;
  });

  test('maps a basic text response to a ChatResponse', async () => {
    const result = await provider.chat({
      model: '',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.message.role).toBe('assistant');
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello from fake gemini' }]);
    expect(result.stopReason).toBe('end_turn');
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 8 });
  });

  test('extracts the system prompt from messages', async () => {
    await provider.chat({
      model: '',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
    });
    const call = fake.chatCalls[0] as { config?: { systemInstruction?: string } };
    expect(call?.config?.systemInstruction).toBe('be terse');
  });

  test('passes tools through to functionDeclarations', async () => {
    await provider.chat({
      model: '',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 'echo',
          description: 'Echoes the input',
          inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
          execute: async () => ({ output: 'x' }),
        },
      ],
    });
    const call = fake.chatCalls[0] as {
      config?: { tools?: Array<{ functionDeclarations?: Array<{ name: string }> }> };
    };
    expect(call?.config?.tools?.[0]?.functionDeclarations?.[0]?.name).toBe('echo');
  });
});

describe('GeminiProvider — stream()', () => {
  test('yields text chunks + a final message_end', async () => {
    const fake = new FakeGenAIClient();
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    provider.setClientForTesting(
      fake as unknown as Parameters<typeof provider.setClientForTesting>[0],
    );

    const events: unknown[] = [];
    for await (const event of provider.stream({
      model: '',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      events.push(event);
    }
    const types = events.map((e) => (e as { type: string }).type);
    expect(types[0]).toBe('text');
    expect(types[1]).toBe('text');
    expect(types[types.length - 1]).toBe('message_end');

    // The final event should carry the usage
    const last = events[events.length - 1] as {
      type: string;
      usage?: { inputTokens: number; outputTokens: number };
    };
    expect(last.usage).toEqual({ inputTokens: 12, outputTokens: 8 });
  });
});

describe('GeminiProvider — no API key', () => {
  test('throws a clear error if GEMINI_API_KEY is not set', async () => {
    process.env.GEMINI_API_KEY = undefined;
    process.env.GOOGLE_API_KEY = undefined;
    const provider = new GeminiProvider(); // no apiKey
    await expect(
      provider.chat({ model: '', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/no API key/i);
  });
});
