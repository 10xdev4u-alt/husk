/**
 * Husk — provider tests.
 *
 * These tests verify the public surface of each provider (defaults,
 * configuration, identity) WITHOUT making any network calls. The
 * actual wire-format translation is covered by the OpenAI/Anthropic
 * SDK's own tests; we just verify Husk's adapters are wired correctly.
 *
 * For end-to-end tests with real API calls, see tests/e2e/ (intentionally
 * out of scope for v0.2.0; belongs in CI with a proper secrets store).
 */

import { describe, expect, test } from 'bun:test';
import {
  AnthropicProvider,
  OllamaProvider,
  OpenAIProvider,
} from '../src/index.js';

describe('AnthropicProvider', () => {
  test('has correct identity', () => {
    const p = new AnthropicProvider();
    expect(p.name).toBe('anthropic');
    expect(p.model).toBe('claude-opus-4-6');
  });

  test('respects model override', () => {
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5' });
    expect(p.model).toBe('claude-sonnet-4-5');
  });

  test('respects baseURL override', () => {
    // We can't easily inspect the baseURL on the SDK instance, but
    // constructing without throwing is a sanity check.
    expect(() => new AnthropicProvider({ baseURL: 'https://proxy.example.com' })).not.toThrow();
  });
});

describe('OpenAIProvider', () => {
  test('has correct identity', () => {
    const p = new OpenAIProvider();
    expect(p.name).toBe('openai');
    expect(p.model).toBe('gpt-5');
  });

  test('respects model override', () => {
    const p = new OpenAIProvider({ model: 'gpt-5-mini' });
    expect(p.model).toBe('gpt-5-mini');
  });
});

describe('OllamaProvider', () => {
  test('has correct identity', () => {
    const p = new OllamaProvider();
    expect(p.name).toBe('ollama');
    expect(p.model).toBe('llama3.2');
  });

  test('respects model override', () => {
    const p = new OllamaProvider({ model: 'deepseek-r1:1.5b' });
    expect(p.model).toBe('deepseek-r1:1.5b');
  });

  test('respects baseURL override', () => {
    expect(
      () => new OllamaProvider({ baseURL: 'http://gpu-server.local:11434/v1' }),
    ).not.toThrow();
  });

  test('implements the Provider interface', () => {
    const p = new OllamaProvider();
    expect(typeof p.chat).toBe('function');
  });
});
