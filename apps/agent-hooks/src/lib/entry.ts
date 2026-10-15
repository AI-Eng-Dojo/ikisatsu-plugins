// エントリポイント(src/entries/*.ts)の共通の型: stdin の JSON を読み、fail-open で包んでハンドラを呼ぶ

import { homedir } from "node:os";
import { runFailOpen } from "./fail-open.ts";
import type { HookDeps } from "./hook-context.ts";
import { parseHookInput, readStdin } from "./stdin.ts";

export function defaultHookDeps(): HookDeps {
  return { env: process.env, home: homedir(), cwd: process.cwd() };
}

export type HookHandler = (input: Record<string, unknown> | null, deps: HookDeps) => Promise<void>;

/** フックのエントリポイント。例外・タイムアウトがあっても exit 0 で終わる */
export async function runHookEntry(handler: HookHandler): Promise<void> {
  await runFailOpen(async () => {
    const input = parseHookInput(await readStdin());
    await handler(input, defaultHookDeps());
  });
}
