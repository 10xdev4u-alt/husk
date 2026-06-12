/**
 * Husk — Anthropic Claude provider adapter.
 *
 * Translates Husk's provider-agnostic ChatRequest to the Anthropic
 * Messages API format and back. This is the only file in the project
 * that knows what Anthropic's wire format looks like.
 *
 * Wire-format mapping (Husk → Anthropic):
 *   - MessageRole 'assistant' + ToolUseBlock   → assistant message with tool_use blocks
 *   - MessageRole 'user' + ToolResultBlock[]   → user message with tool_result blocks
 *   - ToolDefinition (Husk JSON Schema)        → Anthropic input_schema (passes through)
 *   - StopReason 'end_turn' / 'tool_use' / 'max_tokens' / 'stop_sequence'
 *                                                → returned as-is from stop_reason
 *
 * Defaults:
 *   - model: 'claude-opus-4-6' (override via constructor)
 *   - max_tokens: 8192 (Anthropic requires this on every request)
 *   - apiKey: process.env.ANTHROPIC_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatRequest,
  ChatResponse,
  ContentBlock,
  Message,
  Provider,
  StopReason,
  ToolDefinition,
} from '../core/types.js';

export interface AnthropicProviderOptions {
  /** Override the API key. Default: process.env.ANTHROPIC_API_KEY. */
  readonly apiKey?: string;
  /** Model id. Default: 'claude-opus-4-6'. */
  readonly model?: string;
  /** Override the API base URL (for proxies, self-hosted, etc). */
  readonly baseURL?: string;
  /** Default max_tokens for requests. Anthropic requires this. Default: 8192. */
  readonly maxTokens?: number;
}

export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;
  private readonly defaultMaxTokens: number;

  constructor(options: AnthropicProviderOptions = {}) {
    this.model = options.model ?? 'claude-opus-4-6';
    this.client = new Anthropic({
      apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
    this.defaultMaxTokens = options.maxTokens ?? 8192;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { system, messages } = splitSystemMessage(request.messages);

    const anthropicTools = request.tools?.map(toHuskToolToAnthropic);

    const response = await this.client.messages.create({
      model: request.model || this.model,
      ...(system ? { system } : {}),
      messages: messages.map(toAnthropicMessage),
      ...(anthropicTools && anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.stopSequences ? { stop_sequences: [...request.stopSequences] } : {}),
    });

    return {
      message: {
        role: 'assistant',
        content: response.content.map(fromAnthropicBlock),
      },
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: mapStopReason(response.stop_reason),
      model: response.model,
    };
  }
}

// ───────────────────────────────────────────────────────────────────
// Translation helpers
// ───────────────────────────────────────────────────────────────────

/**
 * Anthropic takes the system prompt as a top-level field, not as a
 * message. Pull any system messages out and concatenate them.
 */
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

function toHuskToolToAnthropic(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  };
}

function toAnthropicMessage(message: Message): Anthropic.MessageParam {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return { role: 'user', content: message.content };
    }
    // ContentBlock[] may contain tool_result blocks (from the agent loop)
    return {
      role: 'user',
      content: message.content.map((block) => {
        if (block.type === 'text') {
          return { type: 'text' as const, text: block.text };
        }
        if (block.type === 'tool_result') {
          return {
            type: 'tool_result' as const,
            tool_use_id: block.toolUseId,
            content:
              typeof block.content === 'string'
                ? block.content
                : block.content.map((b) => {
                    if (b.type === 'text') return { type: 'text' as const, text: b.text };
                    // For non-text content in tool results, serialize as JSON.
                    return { type: 'text' as const, text: JSON.stringify(b) };
                  }),
            ...(block.isError ? { is_error: true } : {}),
          };
        }
        // Defensive: forward text blocks from assistant messages that
        // happen to land on a user role (shouldn't happen in normal flow).
        if (block.type === 'tool_use') {
          return {
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          };
        }
        return { type: 'text' as const, text: '' };
      }),
    };
  }

  if (message.role === 'assistant') {
    if (typeof message.content === 'string') {
      return { role: 'assistant', content: message.content };
    }
    return {
      role: 'assistant',
      content: message.content.map((block) => {
        if (block.type === 'text') {
          return { type: 'text' as const, text: block.text };
        }
        if (block.type === 'tool_use') {
          return {
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          };
        }
        // tool_result on an assistant message is invalid; skip defensively.
        return { type: 'text' as const, text: '' };
      }),
    };
  }

  // 'tool' and 'system' roles are pre-processed (system → split out,
  // tool → folded into user-role tool_result blocks). This branch is
  // unreachable in normal flow.
  return { role: 'user', content: '' };
}

function fromAnthropicBlock(block: Anthropic.ContentBlock): ContentBlock {
  if (block.type === 'text') {
    return { type: 'text', text: block.text };
  }
  if (block.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: block.input,
    };
  }
  // Unknown block types become empty text — better than throwing,
  // and surfaces in the conversation as a blank rather than a crash.
  return { type: 'text', text: '' };
}

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    default:
      return 'error';
  }
}
