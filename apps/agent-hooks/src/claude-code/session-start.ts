// SessionStart: チームの短期の記憶を additionalContext として注入する。
// 標準出力に書いてよいのはこの JSON 1 個だけ(0 件・失敗のときは何も出さない)

import { type HookDeps, resolveHookContext } from "../lib/hook-context.ts";
import { fetchInjectionText } from "../lib/injection.ts";

/** Claude Code の additionalContext の上限(10,000 字)に余裕を持たせる */
export const SESSION_START_MAX_CHARS = 8000;

export async function handleSessionStart(
  input: Record<string, unknown> | null,
  deps: HookDeps,
): Promise<void> {
  const ctx = await resolveHookContext(input, deps, { requireSessionId: false });
  if (ctx === null) return;

  const additionalContext = await fetchInjectionText(
    ctx,
    deps,
    SESSION_START_MAX_CHARS,
    "claude-code-session-start",
  );
  if (additionalContext === "") return;

  console.log(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }),
  );
}
