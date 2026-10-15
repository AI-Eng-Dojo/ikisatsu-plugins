// フックの共通の前提: 入力・.ikisatsu.json・トークンが揃っているときだけ動く。
// どれかが欠けたら null(= 何も送らない)。Claude Code / Codex のアダプタが共用する

import { isValidSessionId } from "@ikisatsu/core";
import { apiBaseUrl, findProjectConfig } from "./config.ts";
import { readTokenWithSource, type TokenSource } from "./token.ts";

export interface HookDeps {
  env: NodeJS.ProcessEnv;
  home: string;
  /** 入力に cwd が無いときの既定 */
  cwd: string;
  fetchImpl?: typeof fetch;
  /** HTTP のタイムアウトの上書き(テスト用。省略時は各フックの既定) */
  timeoutMs?: number;
}

export interface HookContext {
  token: string;
  /** 診断ログ用。トークンを環境変数とファイルのどちらから読んだか */
  tokenSource: TokenSource;
  apiUrl: string;
  projectId: string;
  /** .ikisatsu.json のあるディレクトリ */
  repoRoot: string;
  /** requireSessionId: false のときは空文字のことがある */
  sessionId: string;
  cwd: string;
}

export async function resolveHookContext(
  input: Record<string, unknown> | null,
  deps: HookDeps,
  options: { requireSessionId: boolean },
): Promise<HookContext | null> {
  if (input === null) return null;

  const rawSessionId = input.session_id;
  const sessionId =
    typeof rawSessionId === "string" && isValidSessionId(rawSessionId) ? rawSessionId : "";
  if (options.requireSessionId && sessionId === "") return null;

  const cwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : deps.cwd;
  const project = await findProjectConfig(cwd);
  if (project === null) return null;

  const token = await readTokenWithSource(deps.env, deps.home);
  if (token === null) return null;

  return {
    token: token.token,
    tokenSource: token.source,
    apiUrl: apiBaseUrl(deps.env),
    projectId: project.projectId,
    repoRoot: project.root,
    sessionId,
    cwd,
  };
}
