// フックの API 呼び出し(Bearer 付き)。環境変数のトークンで 401 になったら、~/.ikisatsu/token を読み直して 1 回だけ送り直す。
// 長生きする Codex のプロセスに古い IKISATSU_TOKEN が残り、ログインし直しても効かなかったため(#103)

import type { HookContext, HookDeps } from "./hook-context.ts";
import { type HttpResult, type RequestOptions, request } from "./http.ts";
import { readTokenWithSource } from "./token.ts";

export type AuthedRequestOptions = Omit<RequestOptions, "token" | "diagnostics" | "fetchImpl">;

export async function authedRequest(
  ctx: HookContext,
  deps: HookDeps,
  hook: string,
  options: AuthedRequestOptions,
): Promise<HttpResult> {
  const first = await request({
    ...options,
    token: ctx.token,
    fetchImpl: deps.fetchImpl,
    diagnostics: { home: deps.home, hook, tokenSource: ctx.tokenSource },
  });
  if (first.status !== 401 || ctx.tokenSource !== "env") return first;

  // 環境変数を外してファイルだけを読む。同じ値なら送り直しても同じ 401 なので送らない
  const fromFile = await readTokenWithSource({}, deps.home);
  if (fromFile === null || fromFile.token === ctx.token) return first;
  return request({
    ...options,
    token: fromFile.token,
    fetchImpl: deps.fetchImpl,
    diagnostics: { home: deps.home, hook, tokenSource: fromFile.source },
  });
}
