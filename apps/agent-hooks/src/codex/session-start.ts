// Codex の SessionStart: チームの短期の記憶を additionalContext として注入する。
// 標準出力に書いてよいのはこの JSON 1 個だけ(0 件・失敗のときは何も出さない)

import { type HookDeps, resolveHookContext } from "../lib/hook-context.ts";
import { fetchInjectionText } from "../lib/injection.ts";

/**
 * Codex の additionalContext の上限(既定 約 2,500 トークン)を超えないための字数。
 * hooks.json 側で additionalContextLimit も 5000 に上げてある
 */
export const CODEX_SESSION_START_MAX_CHARS = 4000;

export async function handleSessionStart(
  input: Record<string, unknown> | null,
  deps: HookDeps,
): Promise<void> {
  const ctx = await resolveHookContext(input, deps, { requireSessionId: false });
  if (ctx === null) return;

  const additionalContext = await fetchInjectionText(
    ctx,
    deps,
    CODEX_SESSION_START_MAX_CHARS,
    "codex-session-start",
  );
  if (additionalContext === "") return;

  console.log(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }),
  );
}
