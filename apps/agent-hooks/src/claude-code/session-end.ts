// SessionEnd: 要約の合図(POST /v1/sessions/:sessionId/end)。本文は送らない

import { type HookDeps, resolveHookContext } from "../lib/hook-context.ts";
import { signalSessionEnd } from "../lib/session-end-signal.ts";

export { SESSION_END_TIMEOUT_MS } from "../lib/session-end-signal.ts";

export async function handleSessionEnd(
  input: Record<string, unknown> | null,
  deps: HookDeps,
): Promise<void> {
  const ctx = await resolveHookContext(input, deps, { requireSessionId: true });
  if (ctx === null) return;
  await signalSessionEnd(ctx, deps, "claude-code-session-end");
}
