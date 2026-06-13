/**
 * Husk — Ollama provider adapter.
 *
 * Wraps Ollama's OpenAI-compatible Chat Completions API. Because Ollama
 * exposes the exact same wire format as OpenAI, we can reuse the OpenAI
 * adapter internally — only the default model name, base URL, and the
 * provider 'name' field differ.
 *
 * Why this exists: local models (llama3.2, deepseek-r1, qwen2.5, etc.)
 * are a first-class use case. Privacy, cost, and offline-ability all
 * matter. Ollama is the dominant local-model runtime and uses the
 * OpenAI API surface, so the adapter is a thin shell.
 *
 * Defaults:
 *   - model: 'llama3.2' (override via constructor)
 *   - baseURL: 'http://localhost:11434/v1' (override for remote Ollama)
 *   - apiKey: 'ollama' (Ollama ignores the value but the OpenAI SDK
 *     requires a non-empty string)
 *
 * Usage:
 *   const agent = new Agent({ model: new OllamaProvider() });
 *   const result = await agent.run('Explain quantum entanglement');
 *
 * For a list of models: `ollama list` (in your terminal).
 */

import { OpenAIProvider } from './openai.js';
import type { Provider } from '../core/types.js';

export interface OllamaProviderOptions {
  /** Model id (run `ollama list` to see what's pulled locally). Default: 'llama3.2'. */
  readonly model?: string;
  /** Ollama server URL. Default: 'http://localhost:11434/v1'. */
  readonly baseURL?: string;
  /** API key — Ollama ignores this but the OpenAI SDK requires it. Default: 'ollama'. */
  readonly apiKey?: string;
}

const DEFAULT_BASE_URL = 'http://localhost:11434/v1';
const DEFAULT_MODEL = 'llama3.2';
const PLACEHOLDER_API_KEY = 'ollama';

export class OllamaProvider implements Provider {
  readonly name = 'ollama';
  readonly model: string;
  private readonly inner: OpenAIProvider;

  constructor(options: OllamaProviderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    // Delegate to OpenAIProvider — Ollama's API is wire-compatible.
    this.inner = new OpenAIProvider({
      apiKey: options.apiKey ?? PLACEHOLDER_API_KEY,
      model: this.model,
      baseURL: options.baseURL ?? DEFAULT_BASE_URL,
    });
  }

  chat(request: Parameters<Provider['chat']>[0]): ReturnType<Provider['chat']> {
    // Strip the 'model' field from the request — Ollama's API expects the
    // model on the request, but we've already configured it on the
    // instance. Passing through means the inner OpenAI provider uses
    // request.model OR falls back to its own. Either way it's correct.
    return this.inner.chat(request);
  }
}
