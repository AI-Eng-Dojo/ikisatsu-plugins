// 要約の合図(POST /v1/sessions/:sessionId/end)。本文は送らない。Claude Code / Codex の SessionEnd が共用する

import { authedRequest } from "./authed-request.ts";
import type { HookContext, HookDeps } from "./hook-context.ts";

export const SESSION_END_TIMEOUT_MS = 5_000;

export async function signalSessionEnd(
  ctx: HookContext,
  deps: HookDeps,
  hook: string,
): Promise<void> {
  await authedRequest(ctx, deps, hook, {
    method: "POST",
    url: `${ctx.apiUrl}/v1/sessions/${ctx.sessionId}/end`,
    timeoutMs: deps.timeoutMs ?? SESSION_END_TIMEOUT_MS,
  });
}
