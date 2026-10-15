// ブラウザログイン(gh auth login 型)。フックではなく人が実行する CLI なので fail-open ではない。
// 失敗したら分かるメッセージを出して exit 1。表示してよいのは email とチーム名だけ(トークンは出さない)
//
// 流れ: 127.0.0.1 の空きポートで待ち受け → ランダムな state → app の /cli/login をブラウザで開く
//   → /callback で state を照合 → POST /v1/cli/exchange {code} → ~/.ikisatsu/token に保存

import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { apiBaseUrl, appBaseUrl } from "../lib/config.ts";
import { request } from "../lib/http.ts";
import { writeToken } from "../lib/token.ts";

export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const EXCHANGE_TIMEOUT_MS = 15_000;

export interface LoginDeps {
  env: NodeJS.ProcessEnv;
  home: string;
  fetchImpl?: typeof fetch;
  /** ブラウザを開く。開けなければ false(URL は常に表示しているので、続行できる) */
  openBrowser: (url: string) => Promise<boolean>;
  timeoutMs: number;
  print: (message: string) => void;
  printError: (message: string) => void;
}

interface ExchangeResult {
  token: string;
  member: { email: string };
  team: { name: string };
}

class LoginError extends Error {}

function isExchangeResult(v: unknown): v is ExchangeResult {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const member = r.member as Record<string, unknown> | null | undefined;
  const team = r.team as Record<string, unknown> | null | undefined;
  return (
    typeof r.token === "string" &&
    r.token !== "" &&
    typeof member?.email === "string" &&
    typeof team?.name === "string"
  );
}

function statesMatch(expected: string, actual: string | null): boolean {
  if (actual === null) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

function page(res: ServerResponse, status: number, title: string, message: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("connection", "close");
  res.end(
    `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ikisatsu</title>` +
      `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${message}</p></body></html>`,
  );
}

async function exchange(
  apiUrl: string,
  code: string,
  fetchImpl: typeof fetch | undefined,
): Promise<ExchangeResult> {
  let res: Awaited<ReturnType<typeof request>>;
  try {
    res = await request({
      method: "POST",
      url: `${apiUrl}/v1/cli/exchange`,
      body: { code },
      timeoutMs: EXCHANGE_TIMEOUT_MS,
      fetchImpl,
    });
  } catch {
    throw new LoginError(
      "API に接続できませんでした。ネットワークを確認して、もう一度試してください。",
    );
  }
  if (res.status === 400) {
    throw new LoginError(
      "ログインコードが無効か、期限切れです。もう一度ログインを実行してください。",
    );
  }
  if (!res.ok || !isExchangeResult(res.json)) {
    throw new LoginError(
      `トークンの発行に失敗しました(HTTP ${res.status})。しばらくしてからもう一度試してください。`,
    );
  }
  return res.json;
}

export async function runLogin(deps: LoginDeps): Promise<number> {
  let appUrl: string;
  let apiUrl: string;
  try {
    appUrl = appBaseUrl(deps.env);
    apiUrl = apiBaseUrl(deps.env);
  } catch {
    deps.printError(
      "IKISATSU_APP_URL / IKISATSU_API_URL が不正です(http か https の URL を指定してください)。",
    );
    return 1;
  }

  const state = randomBytes(24).toString("base64url");
  let handled = false;
  let settle: (result: ExchangeResult | LoginError) => void = () => {};
  const done = new Promise<ExchangeResult | LoginError>((resolve) => {
    settle = resolve;
  });

  const handle = async (req: IncomingMessage, res: ServerResponse, port: number): Promise<void> => {
    // DNS リバインディング対策: Host が待ち受けのアドレスでなければ相手にしない
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
      page(res, 400, "ログインできませんでした", "不正なリクエストです。");
      return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (req.method !== "GET" || url.pathname !== "/callback") {
      page(res, 404, "見つかりません", "このページはありません。");
      return;
    }
    const code = url.searchParams.get("code");
    if (!statesMatch(state, url.searchParams.get("state")) || !code) {
      // 不一致は拒否するだけで、ログインの待機は続ける(他のページからの邪魔で失敗させない)
      page(
        res,
        400,
        "ログインできませんでした",
        "確認コードが一致しません。ターミナルの案内から、もう一度やり直してください。",
      );
      return;
    }
    if (handled) {
      page(res, 400, "ログインできませんでした", "このコードは使用済みです。");
      return;
    }
    handled = true;

    try {
      const result = await exchange(apiUrl, code, deps.fetchImpl);
      await writeToken(result.token, deps.home);
      // ブラウザへの応答を送り終えてから完了させる(待ち受けを閉じて応答を切らないため)
      res.once("finish", () => settle(result));
      page(
        res,
        200,
        "ログインしました",
        "このタブは閉じて大丈夫です。ターミナルに戻ってください。",
      );
    } catch (e) {
      const error =
        e instanceof LoginError
          ? e
          : new LoginError(
              "トークンを保存できませんでした(~/.ikisatsu の権限を確認してください)。",
            );
      res.once("finish", () => settle(error));
      page(res, 500, "ログインできませんでした", "ターミナルの表示を確認してください。");
    }
  };

  const server = createServer((req, res) => {
    const port = (server.address() as AddressInfo).port;
    handle(req, res, port).catch(() => {
      page(res, 500, "ログインできませんでした", "内部エラーです。");
      settle(new LoginError("ログインの処理中にエラーが起きました。"));
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch {
    deps.printError("ローカルの待ち受けを開始できませんでした。");
    return 1;
  }

  const timer = setTimeout(
    () =>
      settle(
        new LoginError(
          "時間切れです(5 分以内にブラウザで完了してください)。もう一度ログインを実行してください。",
        ),
      ),
    deps.timeoutMs,
  );

  try {
    const { port } = server.address() as AddressInfo;
    const loginUrl = `${appUrl}/cli/login?port=${port}&state=${state}`;
    deps.print("ブラウザで ikisatsu にログインします。");
    deps.print(`開かない場合は、次の URL をブラウザで開いてください:\n${loginUrl}`);
    void deps.openBrowser(loginUrl).catch(() => false);

    const result = await done;
    if (result instanceof LoginError) {
      deps.printError(result.message);
      return 1;
    }
    deps.print(`ログインしました: ${result.member.email}(チーム: ${result.team.name})`);
    return 0;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    server.close();
  }
}

type SpawnLike = typeof spawn;

/** OS のブラウザ起動コマンドを呼ぶ。Windows は URL の `&` を cmd に解釈させないよう rundll32 を使う */
export function openBrowserWith(
  spawnImpl: SpawnLike,
  platform: NodeJS.Platform,
  url: string,
): Promise<boolean> {
  const [command, args]: [string, string[]] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      const child = spawnImpl(command, args, { stdio: "ignore", detached: true });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

export function defaultLoginDeps(): LoginDeps {
  return {
    env: process.env,
    home: homedir(),
    openBrowser: (url) => openBrowserWith(spawn, process.platform, url),
    timeoutMs: LOGIN_TIMEOUT_MS,
    print: (message) => console.log(message),
    printError: (message) => console.error(message),
  };
}
