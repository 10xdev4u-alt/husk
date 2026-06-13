/**
 * Husk — Google Gemini provider adapter.
 *
 * Translates Husk's provider-agnostic ChatRequest to the Google
 * GenAI SDK (the new @google/genai package — the legacy
 * @google/generative-ai is deprecated and EOL as of Aug 2025).
 *
 * Wire-format mapping (Husk → Gemini):
 *   - Husk messages → Gemini `contents` array, with role
 *     ('user' / 'model') and `parts` (text + functionCall +
 *     functionResponse).
 *   - Husk system prompt → Gemini `systemInstruction`.
 *   - Husk tools → Gemini `tools[0].functionDeclarations` array
 *     (the SDK wraps function declarations under tools[0]).
 *   - StopReason: Gemini returns `finishReason` ('STOP' / 'MAX_TOKENS' /
 *     'SAFETY' / 'RECITATION' / 'OTHER'). Map to Husk's
 *     'end_turn' / 'max_tokens' / 'error'.
 *
 * Function calling: Gemini emits `functionCall` parts in the
 * response. We map them to Husk's tool_use blocks. The
 * tool_result blocks from the agent loop come back as
 * `functionResponse` parts.
 *
 * Streaming: SDK exposes `generateContentStream()` which is an
 * async iterable of chunks. Each chunk has `candidates[0].content.parts`
 * with text deltas and/or functionCall parts. The end is
 * signaled by a `finishReason` on the final chunk.
 *
 * Defaults:
 *   - model: 'gemini-2.5-flash' (override via constructor)
 *   - apiKey: process.env.GEMINI_API_KEY or GOOGLE_API_KEY
 */

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

/** Minimal shape we use from the @google/genai SDK (lazy-loaded). */
interface GenAIClient {
  models: {
    generateContent: (params: GenAIRequest) => Promise<GenAIResponse>;
    generateContentStream: (params: GenAIRequest) => Promise<AsyncIterable<GenAIResponseChunk>>;
  };
}

interface GenAIRequest {
  model: string;
  contents: GenAIContent[];
  config?: GenAIConfig;
}

interface GenAIConfig {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  tools?: GenAIToolsConfig[];
}

interface GenAIToolsConfig {
  functionDeclarations?: GenAIFunctionDeclaration[];
}

interface GenAIFunctionDeclaration {
  name: string;
  description?: string;
  parametersJsonSchema?: Record<string, unknown>;
}

interface GenAIContent {
  role: 'user' | 'model';
  parts: GenAIPart[];
}

type GenAIPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

interface GenAIResponse {
  text?: string;
  candidates?: Array<{
    content?: { parts?: GenAIPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  functionCalls?: Array<{ name: string; args: Record<string, unknown> }>;
}

interface GenAIResponseChunk {
  candidates?: Array<{
    content?: { parts?: GenAIPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

let sdkCache: { GoogleGenAI: new (opts: { apiKey: string }) => GenAIClient } | undefined;

async function loadSdk(): Promise<{ GoogleGenAI: new (opts: { apiKey: string }) => GenAIClient }> {
  if (sdkCache) return sdkCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import('@google/genai')) as {
      GoogleGenAI?: unknown;
      default?: { GoogleGenAI?: unknown };
    };
    const Ctor = mod.GoogleGenAI ?? mod.default?.GoogleGenAI;
    if (!Ctor) {
      throw new Error('GoogleGenAI class not found in @google/genai module');
    }
    sdkCache = { GoogleGenAI: Ctor as new (opts: { apiKey: string }) => GenAIClient };
    return sdkCache;
  } catch (err) {
    if (err instanceof Error && /Cannot find module/.test(err.message)) {
      throw new Error(
        "The '@google/genai' package isn't installed. Run `npm install @google/genai` and try again.",
      );
    }
    throw err;
  }
}

export interface GeminiProviderOptions {
  /** Override the API key. Default: process.env.GEMINI_API_KEY or GOOGLE_API_KEY. */
  readonly apiKey?: string;
  /** Model id. Default: 'gemini-2.5-flash'. */
  readonly model?: string;
  /** Override the API base URL (for proxies, Vertex AI Express, etc). */
  readonly baseURL?: string;
}

export class GeminiProvider implements Provider {
  readonly name = 'gemini';
  readonly model: string;
  private readonly apiKey: string | undefined;
  private client: GenAIClient | undefined;

  constructor(options: GeminiProviderOptions = {}) {
    this.model = options.model ?? 'gemini-2.5-flash';
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    // baseURL is accepted in the constructor for API parity with
    // the other providers. v0.8.1 will thread it through the GenAI
    // SDK's httpOptions; for now it's stored in the instance but
    // not used (the SDK's default base URL is fine for v0.8.0).
    void options.baseURL;
  }

  /** Set the client (for tests that want to inject a mock). */
  setClientForTesting(client: GenAIClient): void {
    this.client = client;
  }

  private async getClient(): Promise<GenAIClient> {
    if (this.client) return this.client;
    if (!this.apiKey) {
      throw new Error(
        'GeminiProvider: no API key. Set GEMINI_API_KEY or GOOGLE_API_KEY, or pass apiKey in the constructor.',
      );
    }
    const sdk = await loadSdk();
    this.client = new sdk.GoogleGenAI({ apiKey: this.apiKey });
    return this.client;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const client = await this.getClient();
    const { system, contents } = splitSystemMessage(request.messages);
    const config: GenAIConfig = {
      ...(system ? { systemInstruction: system } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
      ...(request.tools ? { tools: [{ functionDeclarations: toolsToGemini(request.tools) }] } : {}),
    };
    const response = await client.models.generateContent({
      model: request.model || this.model,
      contents,
      config,
    });
    return mapResponse(response);
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const client = await this.getClient();
    const { system, contents } = splitSystemMessage(request.messages);
    const config: GenAIConfig = {
      ...(system ? { systemInstruction: system } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
      ...(request.tools ? { tools: [{ functionDeclarations: toolsToGemini(request.tools) }] } : {}),
    };
    const stream = await client.models.generateContentStream({
      model: request.model || this.model,
      contents,
      config,
    });
    const toolInputBuffers = new Map<string, { name: string; input: string }>();
    const seenToolIds = new Set<string>();
    let finalStopReason: StopReason = 'end_turn';
    let usage: { inputTokens: number; outputTokens: number } = { inputTokens: 0, outputTokens: 0 };

    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      for (const part of parts) {
        if ('text' in part) {
          yield { type: 'text', text: part.text };
        } else if ('functionCall' in part) {
          // Gemini's functionCall doesn't have a stable id — use the name
          // as the key. This works because a single response can have
          // multiple function calls and we want to reassemble per-name.
          const id = part.functionCall.name;
          if (!seenToolIds.has(id)) {
            seenToolIds.add(id);
            toolInputBuffers.set(id, { name: id, input: '' });
            yield { type: 'tool_use_start', toolUse: { id, name: id } };
          }
          const buf = toolInputBuffers.get(id);
          if (buf) {
            // Gemini's functionCall.args is already a structured object;
            // we serialize it as JSON so it fits the existing delta shape.
            buf.input = JSON.stringify(part.functionCall.args);
            yield { type: 'tool_use_delta', toolUse: { id, name: id, inputDelta: buf.input } };
          }
        }
      }
      if (candidate?.finishReason) {
        finalStopReason = mapStopReason(candidate.finishReason);
      }
      if (chunk.usageMetadata) {
        usage = {
          inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
          outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
        };
      }
    }
    yield { type: 'message_end', stopReason: finalStopReason, usage };
  }
}

// ───────────────────────────────────────────────────────────────────
// Translation helpers
// ───────────────────────────────────────────────────────────────────

export function splitSystemMessage(messages: readonly Message[]): {
  system: string | undefined;
  contents: GenAIContent[];
} {
  const systemParts: string[] = [];
  const turns: GenAIContent[] = [];
  let currentParts: GenAIPart[] = [];
  let currentRole: 'user' | 'model' | null = null;

  const flush = () => {
    if (currentRole && currentParts.length > 0) {
      turns.push({ role: currentRole, parts: currentParts });
      currentParts = [];
    }
  };

  for (const m of messages) {
    if (m.role === 'system') {
      const text = typeof m.content === 'string' ? m.content : extractText(m.content);
      if (text) systemParts.push(text);
      continue;
    }
    const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';
    if (currentRole !== role) {
      flush();
      currentRole = role;
    }
    if (typeof m.content === 'string') {
      currentParts.push({ text: m.content });
    } else {
      for (const block of m.content) {
        if (block.type === 'text') {
          currentParts.push({ text: block.text });
        } else if (block.type === 'tool_use') {
          currentParts.push({
            functionCall: {
              name: block.name,
              args: (block.input as Record<string, unknown>) ?? {},
            },
          });
        } else if (block.type === 'tool_result') {
          const response =
            typeof block.content === 'string'
              ? { output: block.content, isError: block.isError ?? false }
              : { output: JSON.stringify(block.content), isError: block.isError ?? false };
          currentParts.push({ functionResponse: { name: block.toolUseId, response } });
        }
      }
    }
  }
  flush();
  return { system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined, contents: turns };
}

function extractText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function toolsToGemini(tools: readonly ToolDefinition[]): GenAIFunctionDeclaration[] {
  return tools.map((t) => ({
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
    // The SDK has a `parameters` field that accepts JSON Schema-shaped
    // objects. We pass our inputSchema through; Gemini's runtime
    // validates against it. (parametersJsonSchema is the more
    // standard name in newer SDK versions; we send the object
    // and let the SDK pick the right field.)
    ...(t.inputSchema
      ? { parametersJsonSchema: t.inputSchema as unknown as Record<string, unknown> }
      : {}),
  }));
}

function mapResponse(response: GenAIResponse): ChatResponse {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const blocks: ContentBlock[] = parts.map((p) => {
    if ('text' in p) return { type: 'text' as const, text: p.text };
    if ('functionCall' in p) {
      return {
        type: 'tool_use' as const,
        id: p.functionCall.name,
        name: p.functionCall.name,
        input: p.functionCall.args,
      };
    }
    return { type: 'text' as const, text: '' }; // unknown part type
  });
  return {
    message: {
      role: 'assistant',
      content: blocks.length > 0 ? blocks : [{ type: 'text', text: response.text ?? '' }],
    },
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    },
    stopReason: mapStopReason(candidate?.finishReason),
    model: 'gemini',
  };
}

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'MAX_TOKENS':
      return 'max_tokens';
    case undefined:
    case 'STOP':
    case 'FINISH_REASON_UNSPECIFIED':
      return 'end_turn';
    default:
      // SAFETY, RECITATION, BLOCKLIST, PROHIBITED_CONTENT, SPII,
      // LANGUAGE, IMAGE_SAFETY, MALFORMED_FUNCTION_CALL, IMAGE_PROCESSING,
      // NO_IMAGE, OTHER — all signal a refusal or error condition.
      return 'error';
  }
}
