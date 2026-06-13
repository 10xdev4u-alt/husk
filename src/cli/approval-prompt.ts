/**
 * Husk — default CLI approval prompt.
 *
 * Built-in readline-based implementation of the onApprovalRequest
 * callback. Used by `husk run` when the user doesn't supply their
 * own. Exported so library users can compose it with their own
 * UIs (e.g. a GUI prompt that falls back to readline in CI).
 *
 * Usage:
 *
 *   const agent = new Agent({
 *     model: provider,
 *     tools: [bashTool, writeTool],
 *     onApprovalRequest: defaultCliApprovalPrompt(),
 *   });
 *
 * The prompt writes a short description + first 200 chars of the
 * input to stderr, then reads y/N from stdin. Empty answer
 * (just Enter) defaults to NO — the safe choice. Type 'y' (case
 * insensitive) to approve.
 */

import type { ApprovalRequest, ApprovalResult } from '../core/types.js';

/**
 * Build a default CLI approval prompt. Returns a function that
 * prompts the user on stderr/stdin and resolves to an
 * ApprovalResult.
 *
 * In non-TTY contexts (CI, AI agents) the prompt cannot block
 * for input, so it auto-denies and logs a warning. The caller
 * can detect this and use a different policy in non-interactive
 * mode.
 */
export function defaultCliApprovalPrompt(): (request: ApprovalRequest) => Promise<ApprovalResult> {
  return async (request: ApprovalRequest): Promise<ApprovalResult> => {
    if (!process.stdin.isTTY) {
      // eslint-disable-next-line no-console
      console.error(
        `[approval] non-TTY context — auto-denying tool '${request.toolName}'. Wire a custom onApprovalRequest for non-interactive flows.`,
      );
      return {
        approved: false,
        reason:
          'Approval prompt requires a TTY. Pass an explicit onApprovalRequest or run in a terminal.',
      };
    }

    const { createInterface } = await import('node:readline/promises');
    const { stdin, stdout } = process;
    const rl = createInterface({ input: stdin, output: stdout });

    // eslint-disable-next-line no-console
    console.error(`\n[approval] Tool '${request.toolName}' requires approval`);
    // eslint-disable-next-line no-console
    console.error(`  ${request.reason}`);
    try {
      const answer = await rl.question('  Approve? [y/N] ');
      const trimmed = answer.trim().toLowerCase();
      rl.close();
      return { approved: trimmed === 'y' || trimmed === 'yes' };
    } catch (err) {
      rl.close();
      const message = err instanceof Error ? err.message : String(err);
      return { approved: false, reason: `Approval prompt failed: ${message}` };
    }
  };
}
