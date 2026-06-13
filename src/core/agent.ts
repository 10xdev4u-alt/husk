/**
 * Husk — the agent loop.
 *
 * This is the heartbeat of the harness. The loop is small but every
 * line matters:
 *
 *   1. Compose the conversation (examples + memory + new input)
 *   2. Call the model
 *   3. Decide what to do based on stopReason
 *   4. If tool_use, execute tools and feed results back, then loop
 *   5. If end_turn, return the final output
 *
 * Design choices worth knowing:
 *
 * - Tools are executed in parallel within a single iteration. The
 *   model can request multiple tools in one turn; we honor that and
 *   feed all results back at once. Most agent frameworks get this wrong
 *   by serializing tool calls.
 *
 * - A faulty tool does not crash the loop. The error becomes a
 *   tool_result with isError=true, the model sees it, and can either
 *   retry with corrected input or report back to the user. This is
 *   how a real assistant would behave.
 *
 * - The loop is bounded by maxIterations. Default 25 is enough for
 *   most agent tasks without running away on infinite loops.
 *
 * - The system prompt is rebuilt on every iteration from the steering
 *   config. Cheap, and means hot-reloading rules works.
 */

import { AgentEventEmitter, ConsoleLogger, type Logger } from './events.js';
import { buildExampleMessages, buildSystemPrompt } from './steering.js';
import type {
  AgentConfig,
  AgentResult,
  AgentStreamEvent,
  ContentBlock,
  JSONSchema,
  Message,
  TextBlock,
  ToolDefinition,
  ToolResult,
  ToolUseBlock,
} from './types.js';

// ───────────────────────────────────────────────────────────────────
// Defaults
// ───────────────────────────────────────────────────────────────────

const DEFAULTS = {
  maxIterations: 25,
  temperature: 0,
  sessionId: 'default',
} as const;

// ───────────────────────────────────────────────────────────────────
// Agent class
// ───────────────────────────────────────────────────────────────────

export class Agent {
  readonly events: AgentEventEmitter;
  readonly provider: AgentConfig['model'];
  readonly tools: readonly ToolDefinition[];
  readonly steering: AgentConfig['steering'];
  readonly maxIterations: number;
  readonly temperature: number;
  readonly maxTokens: number | undefined;
  readonly signal: AbortSignal | undefined;
  readonly sessionId: string;
  readonly memory: AgentConfig['memory'];
  readonly logger: Logger;
  readonly onApprovalRequest: AgentConfig['onApprovalRequest'];

  constructor(config: AgentConfig) {
    this.events = new AgentEventEmitter();
    this.provider = config.model;
    this.tools = config.tools ?? [];
    this.steering = config.steering;
    this.maxIterations = config.maxIterations ?? DEFAULTS.maxIterations;
    this.temperature = config.temperature ?? DEFAULTS.temperature;
    this.maxTokens = config.maxTokens;
    this.signal = config.signal;
    this.sessionId = config.sessionId ?? DEFAULTS.sessionId;
    this.memory = config.memory;
    this.logger = new ConsoleLogger();
    this.onApprovalRequest = config.onApprovalRequest;
  }

  /**
   * Subscribe to a specific event type. Returns an unsubscribe fn.
   */
  on: AgentEventEmitter['on'] = (type, handler) => this.events.on(type, handler);

  /**
   * Subscribe to all events. Returns an unsubscribe fn.
   */
  onAny: AgentEventEmitter['onAny'] = (handler) => this.events.onAny(handler);

  /**
   * Run the agent loop to completion on the given input.
   * Returns the final result with output text, full message history,
   * token usage, and duration.
   */
  async run(input: string): Promise<AgentResult> {
    const start = Date.now();

    // Default the logger to a no-op if the user replaced it via
    // subclassing or wants silence. (Future: accept logger in config.)
    this.signal?.throwIfAborted();

    await this.events.emit({ type: 'agent:start', input, sessionId: this.sessionId });

    // ── Compose initial message history ────────────────────────
    const messages: Message[] = [];

    if (this.steering?.examples) {
      messages.push(...buildExampleMessages(this.steering.examples));
    }

    if (this.memory) {
      const stored = await this.memory.read(this.sessionId);
      messages.push(...stored);
    }

    const userMessage: Message = { role: 'user', content: input };
    messages.push(userMessage);
    await this.recordMessage(userMessage);

    const system = this.steering ? buildSystemPrompt(this.steering) : undefined;
    const tools = this.tools.length > 0 ? this.tools : undefined;

    // ── The loop ───────────────────────────────────────────────
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let iterations = 0;
    let finalOutput = '';
    let hitMaxIterations = false;

    while (iterations < this.maxIterations) {
      this.signal?.throwIfAborted();
      iterations += 1;
      await this.events.emit({ type: 'agent:iteration', iteration: iterations });

      // ── Call the model ───────────────────────────────────────
      const request = {
        model: this.provider.model,
        messages,
        ...(tools ? { tools } : {}),
        ...(system ? { system } : {}),
        temperature: this.temperature,
        ...(this.maxTokens ? { maxTokens: this.maxTokens } : {}),
      };
      await this.events.emit({ type: 'provider:request', request });

      const t0 = Date.now();
      const response = await this.provider.chat(request);
      const durationMs = Date.now() - t0;
      await this.events.emit({ type: 'provider:response', response, durationMs });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      await this.recordMessage(response.message);

      // ── Branch on stop reason ────────────────────────────────
      switch (response.stopReason) {
        case 'end_turn':
        case 'stop_sequence': {
          finalOutput = extractText(response.message);
          break;
        }

        case 'max_tokens': {
          finalOutput = extractText(response.message);
          this.logger.warn('Model hit max_tokens; output may be truncated', {
            outputTokens: response.usage.outputTokens,
          });
          break;
        }

        case 'tool_use': {
          const toolUses = extractToolUses(response.message);
          if (toolUses.length === 0) {
            // Defensive: model said tool_use but emitted no tool_use block.
            // Treat as end of turn.
            finalOutput = extractText(response.message);
            break;
          }

          // Execute all requested tools in parallel.
          const results = await Promise.all(
            toolUses.map(async (tu) => {
              await this.events.emit({
                type: 'tool:call',
                id: tu.id,
                name: tu.name,
                input: tu.input,
              });
              const ts = Date.now();
              const result = await this.executeTool(tu.name, tu.input);
              const dur = Date.now() - ts;
              await this.events.emit({
                type: 'tool:result',
                id: tu.id,
                name: tu.name,
                result,
                durationMs: dur,
              });
              return { tu, result };
            }),
          );

          // Build a single user-role message containing all tool results.
          // This matches Anthropic's native format; the OpenAI adapter
          // converts it to multiple tool-role messages.
          const toolMessage: Message = {
            role: 'user',
            content: results.map(
              ({ tu, result }): ContentBlock => ({
                type: 'tool_result',
                toolUseId: tu.id,
                content: result.output,
                ...(result.isError ? { isError: true } : {}),
              }),
            ),
          };
          await this.recordMessage(toolMessage);

          // Continue the loop — model sees the tool results on next iter.
          continue;
        }

        case 'error': {
          throw new Error(`Provider returned error stop reason: ${extractText(response.message)}`);
        }
      }

      // If we got here with finalOutput set, the loop is done.
      if (finalOutput !== '' || response.stopReason !== 'tool_use') {
        break;
      }
    }

    if (iterations >= this.maxIterations && finalOutput === '') {
      hitMaxIterations = true;
      this.logger.warn(`Agent hit max iterations (${this.maxIterations}) without end_turn`, {
        sessionId: this.sessionId,
      });
      const last = messages[messages.length - 1];
      if (last) finalOutput = extractText(last);
    }

    const durationMs = Date.now() - start;
    const result: AgentResult = {
      output: finalOutput,
      messages,
      iterations,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      },
      durationMs,
    };

    await this.events.emit({
      type: 'agent:end',
      output: finalOutput,
      iterations,
      durationMs,
    });
    if (hitMaxIterations) {
      this.logger.warn('Agent ended without clean termination', { hitMaxIterations: true });
    }
    return result;
  }

  /**
   * Streaming version of run(). Yields `AgentStreamEvent`s as the
   * agent loop progresses — text deltas as they arrive, tool calls
   * as they're discovered, tool results after execution, and a final
   * 'done' event with the output and usage.
   *
   * The agent loop is the same as run(): the same memory, the same
   * tools, the same iteration cap. We just route the provider call
   * through `provider.stream()` instead of `provider.chat()` and
   * yield chunks instead of returning a single response.
   *
   * Requires the provider to implement `stream?` — falls back to a
   * `provider.chat()`-based simulation if it doesn't (yields a
   * single 'text' event with the complete response). This keeps
   * streamRun() usable with custom providers that only implement chat.
   */
  async *streamRun(input: string): AsyncIterable<AgentStreamEvent> {
    if (!this.provider.stream) {
      // Fallback for providers that only implement chat(). Run the
      // full loop synchronously, then yield the final output as a
      // single text event followed by a done event. Less interactive
      // but at least functional.
      const result = await this.run(input);
      yield { type: 'text', text: result.output };
      yield {
        type: 'done',
        output: result.output,
        usage: result.usage,
        iterations: result.iterations,
      };
      return;
    }

    this.signal?.throwIfAborted();
    await this.events.emit({ type: 'agent:start', input, sessionId: this.sessionId });

    // ── Compose initial message history ─────────────────
    const messages: Message[] = [];
    if (this.steering?.examples) {
      messages.push(...buildExampleMessages(this.steering.examples));
    }
    if (this.memory) {
      const stored = await this.memory.read(this.sessionId);
      messages.push(...stored);
    }
    const userMessage: Message = { role: 'user', content: input };
    messages.push(userMessage);
    await this.recordMessage(userMessage);

    const system = this.steering ? buildSystemPrompt(this.steering) : undefined;
    const tools = this.tools.length > 0 ? this.tools : undefined;

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let iterations = 0;

    while (iterations < this.maxIterations) {
      this.signal?.throwIfAborted();
      iterations += 1;
      await this.events.emit({ type: 'agent:iteration', iteration: iterations });

      const request = {
        model: this.provider.model,
        messages,
        ...(tools ? { tools } : {}),
        ...(system ? { system } : {}),
        temperature: this.temperature,
        ...(this.maxTokens ? { maxTokens: this.maxTokens } : {}),
      };
      await this.events.emit({ type: 'provider:request', request });

      // Stream the response. Buffer tool_use deltas so we can execute
      // tools only after their JSON input is complete.
      const toolInputBuffers = new Map<string, string>();
      const toolNames = new Map<string, string>();
      let streamedText = '';
      let finalStopReason: import('./types.js').StopReason = 'end_turn';
      let usage: { inputTokens: number; outputTokens: number } = {
        inputTokens: 0,
        outputTokens: 0,
      };

      for await (const chunk of this.provider.stream(request)) {
        if (chunk.type === 'text' && chunk.text) {
          streamedText += chunk.text;
          yield { type: 'text', text: chunk.text };
        } else if (chunk.type === 'tool_use_start' && chunk.toolUse) {
          toolInputBuffers.set(chunk.toolUse.id, '');
          toolNames.set(chunk.toolUse.id, chunk.toolUse.name);
          yield { type: 'tool_call_start', id: chunk.toolUse.id, name: chunk.toolUse.name };
        } else if (
          chunk.type === 'tool_use_delta' &&
          chunk.toolUse?.inputDelta &&
          chunk.toolUse.id
        ) {
          const current = toolInputBuffers.get(chunk.toolUse.id) ?? '';
          toolInputBuffers.set(chunk.toolUse.id, current + chunk.toolUse.inputDelta);
          yield {
            type: 'tool_call_delta',
            id: chunk.toolUse.id,
            inputDelta: chunk.toolUse.inputDelta,
          };
        } else if (chunk.type === 'message_end') {
          if (chunk.stopReason) finalStopReason = chunk.stopReason;
          if (chunk.usage) usage = chunk.usage;
        }
      }

      totalInputTokens += usage.inputTokens;
      totalOutputTokens += usage.outputTokens;

      // Build the assistant message from what we streamed.
      const assistantMessage: Message = {
        role: 'assistant',
        content: [
          ...(streamedText ? [{ type: 'text' as const, text: streamedText }] : []),
          ...Array.from(toolInputBuffers.entries()).map(([id, inputDelta]) => ({
            type: 'tool_use' as const,
            id,
            name: toolNames.get(id) ?? '',
            input: parseToolInput(inputDelta),
          })),
        ],
      };
      await this.recordMessage(assistantMessage);

      if (finalStopReason === 'tool_use') {
        // Execute the buffered tool calls in parallel. We can't yield
        // inside Promise.all (it would need an async generator, not a
        // Promise), so we collect results first, then yield the
        // tool_result events sequentially.
        const assistantContent = assistantMessage.content;
        const contentArray = typeof assistantContent === 'string' ? [] : assistantContent;
        const toolUses = contentArray.filter((b): b is ToolUseBlock => b.type === 'tool_use');
        const results = await Promise.all(
          toolUses.map(async (tu) => {
            await this.events.emit({
              type: 'tool:call',
              id: tu.id,
              name: tu.name,
              input: tu.input,
            });
            const ts = Date.now();
            const result = await this.executeTool(tu.name, tu.input);
            const dur = Date.now() - ts;
            await this.events.emit({
              type: 'tool:result',
              id: tu.id,
              name: tu.name,
              result,
              durationMs: dur,
            });
            return { tu, result };
          }),
        );
        for (const { tu, result } of results) {
          yield { type: 'tool_result', id: tu.id, name: tu.name, result };
        }
        const toolMessage: Message = {
          role: 'user',
          content: results.map(
            ({ tu, result }): ContentBlock => ({
              type: 'tool_result',
              toolUseId: tu.id,
              content: result.output,
              ...(result.isError ? { isError: true } : {}),
            }),
          ),
        };
        await this.recordMessage(toolMessage);
        continue;
      }

      // Natural end. Yield the done event.
      yield {
        type: 'done',
        output: streamedText,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        iterations,
      };
      await this.events.emit({
        type: 'agent:end',
        output: streamedText,
        iterations,
        durationMs: 0,
      });
      return;
    }

    // Hit maxIterations.
    this.logger.warn(`streamRun hit max iterations (${this.maxIterations})`, {
      sessionId: this.sessionId,
    });
    yield {
      type: 'error',
      message: `Hit maxIterations (${this.maxIterations}) without end_turn`,
    };
  }

  // ── Internals ────────────────────────────────────────────────

  private async recordMessage(message: Message): Promise<void> {
    await this.events.emit({ type: 'agent:message', message });
    if (this.memory) {
      await this.memory.append(this.sessionId, message);
    }
  }

  private async executeTool(name: string, input: unknown): Promise<ToolResult> {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) {
      return {
        output: `Error: tool '${name}' is not registered. Available tools: ${this.tools
          .map((t) => t.name)
          .join(', ')}`,
        isError: true,
      };
    }

    const validation = validateInput(input, tool.inputSchema);
    if (!validation.valid) {
      return {
        output: `Error: invalid input for tool '${name}': ${validation.error}`,
        isError: true,
      };
    }

    // Run the tool's custom validation rules (if any) before
    // executing. Rules can be a single ValidationRule or an array.
    if (tool.validate) {
      const { normalizeRules } = await import('../tools/validation.js');
      const rules = normalizeRules(tool.validate);
      const ctx = {
        toolName: name,
        cwd: process.cwd(),
        input,
        env: process.env,
      };
      for (const rule of rules) {
        const error = rule.check(input, ctx);
        if (error !== null) {
          return {
            output: `Error: tool '${name}' blocked by validation rule '${rule.name}': ${error}`,
            isError: true,
          };
        }
      }
    }

    // Approval gate. If the tool requires approval and the caller
    // didn't wire onApprovalRequest, block by default — the safe
    // choice. If they did wire it, the callback decides.
    if (tool.requireApproval) {
      if (!this.onApprovalRequest) {
        return {
          output: `Error: tool '${name}' requires approval, but no onApprovalRequest callback is configured on the Agent. Either set requireApproval: false on the tool, or wire onApprovalRequest in AgentConfig.`,
          isError: true,
        };
      }
      const reason = `${name} wants to run with: ${JSON.stringify(input).slice(0, 200)}`;
      const result = await this.onApprovalRequest({ toolName: name, input, reason });
      if (!result.approved) {
        return {
          output: `Error: tool '${name}' was not approved. ${result.reason ?? 'User denied the request.'}`,
          isError: true,
        };
      }
    }

    try {
      return await tool.execute(input, { signal: this.signal, logger: this.logger });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Error executing tool '${name}': ${message}`, isError: true };
    }
  }
}

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

function extractText(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function extractToolUses(message: Message): ToolUseBlock[] {
  if (typeof message.content === 'string') return [];
  return message.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
}

/**
 * Minimal schema validator. We check that input is an object and that
 * all required fields are present. We do NOT do deep type checking —
 * the provider's own JSON Schema validator handles that, and a bad
 * tool call from the model is a model problem, not a harness problem.
 */
function validateInput(input: unknown, schema: JSONSchema): { valid: boolean; error?: string } {
  if (typeof input !== 'object' || input === null) {
    return { valid: false, error: 'Input must be an object' };
  }
  if (schema.required) {
    for (const key of schema.required) {
      if (!(key in (input as Record<string, unknown>))) {
        return { valid: false, error: `Missing required field: ${key}` };
      }
    }
  }
  return { valid: true };
}

/**
 * Parse the accumulated JSON-string input for a streamed tool call.
 * Tool input arrives as a series of partial JSON fragments that
 * concatenate into a complete JSON object. We try to parse, and
 * fall back to the raw string on parse error (the schema validator
 * downstream will surface the issue to the model).
 */
function parseToolInput(accumulated: string): Record<string, unknown> {
  if (!accumulated) return {};
  try {
    const parsed = JSON.parse(accumulated);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { _raw: accumulated };
  }
}
