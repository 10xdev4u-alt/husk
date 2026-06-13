/**
 * Husk — OpenAI provider adapter.
 *
 * Translates Husk's provider-agnostic ChatRequest to the OpenAI
 * Chat Completions API format and back. The shape is similar to
 * Anthropic but with two important differences:
 *
 * 1. Tool results are their own message role ('tool'), not blocks in
 *    a user message. The Husk agent loop emits tool results as user-
 *    role messages with tool_result content blocks; we split them
 *    out into individual tool-role messages here.
 *
 * 2. Assistant tool calls are an array of tool_call objects on the
 *    assistant message, not content blocks. We map Husk's tool_use
 *    blocks to OpenAI's tool_calls shape.
 *
 * 3. Tools use the legacy 'functions' shape via the 'tools' field with
 *    'function' type. (OpenAI's new 'tools' format is the same; we
 *    use it.)
 */

import OpenAI from 'openai';
import type {
  ChatChunk,
  ChatRequest,
  ChatResponse,
  ContentBlock,
  Message,
  Provider,
  StopReason,
  ToolDefinition,
} from '../core/types.js';

export interface OpenAIProviderOptions {
  /** Override the API key. Default: process.env.OPENAI_API_KEY. */
  readonly apiKey?: string;
  /** Model id. Default: 'gpt-5'. */
  readonly model?: string;
  /** Override the API base URL (for proxies, Azure OpenAI, etc). */
  readonly baseURL?: string;
  /** Organization id (for OpenAI orgs). */
  readonly organization?: string;
}

export class OpenAIProvider implements Provider {
  readonly name = 'openai';
  readonly model: string;
  private readonly client: OpenAI;

  constructor(options: OpenAIProviderOptions = {}) {
    this.model = options.model ?? 'gpt-5';
    this.client = new OpenAI({
      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      ...(options.organization ? { organization: options.organization } : {}),
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { system, messages } = splitSystemMessage(request.messages);

    const openaiTools = request.tools?.map(toOpenAITool);

    const response = await this.client.chat.completions.create({
      model: request.model || this.model,
      ...(system ? { messages: [{ role: 'system' as const, content: system }] } : {}),
      messages: [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        ...messages.flatMap((m) => toOpenAIMessages(m)),
      ],
      ...(openaiTools && openaiTools.length > 0 ? { tools: openaiTools } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(request.stopSequences ? { stop: [...request.stopSequences] } : {}),
    });

    const choice = response.choices[0];
    if (!choice) {
      throw new Error('OpenAI returned no choices');
    }
    const assistantMessage = choice.message;

    return {
      message: {
        role: 'assistant',
        content: fromOpenAIAssistantMessage(assistantMessage),
      },
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      stopReason: mapStopReason(choice.finish_reason),
      model: response.model,
    };
  }

  /**
   * Stream the model response as a sequence of ChatChunks. Maps
   * OpenAI's per-chunk Server-Sent Events to the provider-agnostic
   * ChatChunk shape.
   *
   * Each OpenAI chunk may carry:
   *   - delta.content         → 'text' chunk
   *   - delta.tool_calls[]    → 'tool_use_start' (first delta for a given index)
   *                            or 'tool_use_delta' (subsequent argument deltas)
   *   - finish_reason         → 'message_end' with stopReason
   *   - usage (if stream_options.include_usage is set)
   *                           → attached to the final 'message_end'
   *
   * We track which tool_call indices we've already emitted a
   * 'tool_use_start' for, so we don't repeat it on argument deltas.
   */
  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const { system, messages } = splitSystemMessage(request.messages);
    const openaiTools = request.tools?.map(toOpenAITool);

    const stream = await this.client.chat.completions.create({
      model: request.model || this.model,
      ...(system
        ? {
            messages: [
              { role: 'system' as const, content: system },
              ...messages.flatMap((m) => toOpenAIMessages(m)),
            ],
          }
        : { messages: messages.flatMap((m) => toOpenAIMessages(m)) }),
      ...(openaiTools && openaiTools.length > 0 ? { tools: openaiTools } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(request.stopSequences ? { stop: [...request.stopSequences] } : {}),
      stream: true,
      stream_options: { include_usage: true },
    });

    // Track which tool_call indices we've seen a 'start' for.
    const seenToolCallIndex = new Set<number>();
    let finalUsage: { inputTokens: number; outputTokens: number } | undefined;
    let finalStopReason: StopReason = 'end_turn';

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      // Usage-only chunk (sent after the final choice).
      if (chunk.usage) {
        finalUsage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
        };
        continue;
      }
      if (!choice) continue;

      const delta = choice.delta;

      if (delta.content) {
        yield { type: 'text', text: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!seenToolCallIndex.has(tc.index)) {
            seenToolCallIndex.add(tc.index);
            if (tc.id && tc.function?.name) {
              yield {
                type: 'tool_use_start',
                toolUse: { id: tc.id, name: tc.function.name },
              };
            }
          }
          if (tc.function?.arguments) {
            yield {
              type: 'tool_use_delta',
              toolUse: {
                id: tc.id ?? '',
                name: tc.function.name ?? '',
                inputDelta: tc.function.arguments,
              },
            };
          }
        }
      }

      if (choice.finish_reason) {
        finalStopReason = mapStopReason(choice.finish_reason);
      }
    }

    yield {
      type: 'message_end',
      stopReason: finalStopReason,
      ...(finalUsage ? { usage: finalUsage } : {}),
    };
  }
}

// ───────────────────────────────────────────────────────────────────
// Translation helpers
// ───────────────────────────────────────────────────────────────────

function splitSystemMessage(messages: readonly Message[]): {
  system: string | undefined;
  messages: Message[];
} {
  const systemParts: string[] = [];
  const rest: Message[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      const text = typeof m.content === 'string' ? m.content : extractTextFromBlocks(m.content);
      if (text) systemParts.push(text);
    } else {
      rest.push(m);
    }
  }
  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: rest,
  };
}

function extractTextFromBlocks(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function toOpenAITool(tool: ToolDefinition): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as unknown as Record<string, unknown>,
    },
  };
}

/**
 * Convert a Husk Message to one or more OpenAI ChatCompletionMessageParam.
 * The fan-out happens here for tool results: a single Husk user message
 * with N tool_result blocks becomes N OpenAI tool-role messages.
 */
function toOpenAIMessages(message: Message): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (message.role === 'system') {
    // Pre-split, but defensive.
    const text =
      typeof message.content === 'string'
        ? message.content
        : extractTextFromBlocks(message.content);
    return [{ role: 'system', content: text }];
  }

  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return [{ role: 'user', content: message.content }];
    }
    // ContentBlock[] may include tool_result blocks. Fan them out.
    const toolResults = message.content.filter((b) => b.type === 'tool_result');
    const textBlocks = message.content.filter((b) => b.type === 'text');

    const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (textBlocks.length > 0) {
      out.push({
        role: 'user',
        content: textBlocks.map((b) => (b as { text: string }).text).join('\n'),
      });
    }
    for (const tr of toolResults) {
      if (tr.type !== 'tool_result') continue;
      out.push({
        role: 'tool',
        tool_call_id: tr.toolUseId,
        content:
          typeof tr.content === 'string'
            ? tr.content
            : tr.content.map((b) => (b.type === 'text' ? b.text : JSON.stringify(b))).join('\n'),
      });
    }
    return out;
  }

  if (message.role === 'assistant') {
    if (typeof message.content === 'string') {
      return [{ role: 'assistant', content: message.content }];
    }
    const textParts: string[] = [];
    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
      }
    }
    const out: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
      role: 'assistant',
      content: textParts.length > 0 ? textParts.join('\n') : null,
    };
    if (toolCalls.length > 0) {
      out.tool_calls = toolCalls;
    }
    return [out];
  }

  // 'tool' role: pre-folded by the agent loop, but if one slips through,
  // convert it directly.
  if (message.role === 'tool') {
    const text =
      typeof message.content === 'string'
        ? message.content
        : extractTextFromBlocks(message.content);
    return [
      {
        role: 'tool',
        tool_call_id: message.toolCallId ?? message.name ?? 'unknown',
        content: text,
      },
    ];
  }

  return [];
}

function fromOpenAIAssistantMessage(
  msg: OpenAI.Chat.Completions.ChatCompletionMessage,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (msg.content) {
    blocks.push({ type: 'text', text: msg.content });
  }
  if (msg.tool_calls) {
    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(call.function.arguments);
      } catch {
        parsed = { _parseError: call.function.arguments };
      }
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: parsed,
      });
    }
  }
  return blocks;
}

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'stop_sequence';
    default:
      return 'error';
  }
}
