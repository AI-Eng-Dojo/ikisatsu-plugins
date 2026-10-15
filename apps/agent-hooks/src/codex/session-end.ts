// Codex の SessionEnd: 最後の会話を送り直してから、要約の合図を送る(#82)。
// Codex は SessionEnd の前に rollout を書き出すので、最後のターンの Stop で取りこぼした分もここで拾える。
// 送り直しが失敗しても合図は送る(サーバにある分で要約する)

import { type HookDeps, resolveHookContext } from "../lib/hook-context.ts";
import { signalSessionEnd } from "../lib/session-end-signal.ts";
import { uploadCodexTranscript } from "./stop.ts";

const HOOK = "codex-session-end";

export async function handleCodexSessionEnd(
  input: Record<string, unknown> | null,
  deps: HookDeps,
): Promise<void> {
  const ctx = await resolveHookContext(input, deps, { requireSessionId: true });
  if (ctx === null || input === null) return;
  try {
    await uploadCodexTranscript(input, ctx, deps, HOOK);
  } catch {
    // 接続できない・タイムアウト。失敗は http-errors.log に残っている。合図は試みる
  }
  await signalSessionEnd(ctx, deps, HOOK);
}
