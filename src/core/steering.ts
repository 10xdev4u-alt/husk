/**
 * Husk — steering prompt builder.
 *
 * "Steering" is the config that shapes agent behavior: system prompt,
 * rules, and few-shot examples. The builder takes a SteeringConfig
 * and produces the artifacts the agent loop needs:
 *   - buildSystemPrompt() → the string to send as the system message
 *   - buildExamples() → the user/assistant message pairs to seed history
 *
 * Why a separate module? Two reasons:
 * 1. The agent loop stays focused on the loop logic, not prompt assembly.
 * 2. Steering is the most-likely-to-be-customized piece; users can
 *    subclass or replace the builder without touching the agent.
 */

import type { Example, Message, SteeringConfig } from './types.js';

// ───────────────────────────────────────────────────────────────────
// System prompt builder
// ───────────────────────────────────────────────────────────────────

/**
 * Combine systemPrompt + rules into a single system prompt string.
 * Rules are numbered for explicit citation ("see rule 3") and
 * appended after a header so models parse them as a separate list.
 */
export function buildSystemPrompt(steering: SteeringConfig): string | undefined {
  const parts: string[] = [];

  if (steering.systemPrompt && steering.systemPrompt.trim().length > 0) {
    parts.push(steering.systemPrompt.trim());
  }

  if (steering.rules && steering.rules.length > 0) {
    const numbered = steering.rules.map((rule, i) => `${i + 1}. ${rule}`).join('\n');
    parts.push(`## Rules\n${numbered}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

// ───────────────────────────────────────────────────────────────────
// Example seeder
// ───────────────────────────────────────────────────────────────────

/**
 * Convert few-shot examples into a sequence of user/assistant message
 * pairs that get prepended to the conversation history. The model
 * sees these as if they had happened earlier in the conversation,
 * which is how few-shot prompting works mechanically.
 *
 * Examples are emitted in order; the first user message of an example
 * comes right after the previous example's assistant message (or right
 * after the system prompt for the first example).
 */
export function buildExampleMessages(examples: readonly Example[]): readonly Message[] {
  const messages: Message[] = [];
  for (const ex of examples) {
    messages.push({ role: 'user', content: ex.user });
    messages.push({ role: 'assistant', content: ex.assistant });
  }
  return messages;
}
