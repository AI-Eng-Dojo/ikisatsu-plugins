import { EventEmitter } from "node:events";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeSandbox, type Sandbox, startServer, type TestServer } from "../testing/sandbox.ts";
import { defaultLoginDeps, type LoginDeps, openBrowserWith, runLogin } from "./login.ts";

let sandbox: Sandbox | undefined;
let api: TestServer | undefined;

afterEach(async () => {
  sandbox?.cleanup();
  await api?.close();
  sandbox = undefined;
  api = undefined;
});

const exchangeOk = {
  token: "iks_SECRET-TOKEN-VALUE",
  expiresAt: "2026-12-28T00:00:00.000Z",
  member: { email: "niida@example.com", displayName: "Niida" },
  team: { id: "t1", name: "Dojo" },
};

interface Harness {
  deps: LoginDeps;
  out: string[];
  err: string[];
  /** ブラウザが開いた URL */
  opened: string[];
  /** ブラウザ側の動き(onOpen)の完了待ち */
  pending: Promise<unknown>[];
}

function harness(
  home: string,
  apiUrl: string,
  onOpen: (url: URL) => Promise<void> | void,
  extra: Partial<LoginDeps> = {},
): Harness {
  const h: Harness = {
    out: [],
    err: [],
    opened: [],
    pending: [],
    deps: undefined as unknown as LoginDeps,
  };
  h.deps = {
    env: { IKISATSU_API_URL: apiUrl, IKISATSU_APP_URL: "https://app.example.test" },
    home,
    openBrowser: async (url) => {
      h.opened.push(url);
      // ブラウザが開いた後、アプリが 127.0.0.1 へリダイレクトしてくる動きを再現する
      h.pending.push(Promise.resolve(onOpen(new URL(url))));
      return true;
    },
    timeoutMs: 5000,
    print: (m) => h.out.push(m),
    printError: (m) => h.err.push(m),
    ...extra,
  };
  return h;
}

function callback(loginUrl: URL, params: Record<string, string>): Promise<Response> {
  const port = loginUrl.searchParams.get("port");
  const q = new URLSearchParams(params).toString();
  return fetch(`http://127.0.0.1:${port}/callback?${q}`);
}

describe("runLogin: 成功", () => {
  it("state が一致し exchange に成功したら、トークンを 0600 で保存し、email とチーム名だけを表示する", async () => {
    sandbox = makeSandbox({ token: null });
    api = await startServer(() => ({ json: exchangeOk }));
    let page = "";
    const h = harness(sandbox.home, api.url, async (u) => {
      const res = await callback(u, { code: "CODE123", state: u.searchParams.get("state") ?? "" });
      page = await res.text();
    });

    const code = await runLogin(h.deps);
    await Promise.all(h.pending);

    expect(code).toBe(0);
    // ブラウザで開く URL
    const opened = new URL(h.opened[0] ?? "");
    expect(opened.origin + opened.pathname).toBe("https://app.example.test/cli/login");
    expect(Number(opened.searchParams.get("port"))).toBeGreaterThanOrEqual(1024);
    expect(opened.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    // exchange の呼び出し
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]).toMatchObject({ method: "POST", path: "/v1/cli/exchange" });
    expect(JSON.parse(api.requests[0]?.body ?? "")).toEqual({ code: "CODE123" });
    // 保存
    const tokenPath = join(sandbox.home, ".ikisatsu", "token");
    expect(readFileSync(tokenPath, "utf-8").trim()).toBe("iks_SECRET-TOKEN-VALUE");
    if (process.platform !== "win32") {
      expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
      expect(statSync(join(sandbox.home, ".ikisatsu")).mode & 0o777).toBe(0o700);
    }
    // 表示: email とチーム名は出す。トークンはどこにも出さない
    const shown = [...h.out, ...h.err].join("\n");
    expect(shown).toContain("niida@example.com");
    expect(shown).toContain("Dojo");
    expect(shown).not.toContain("SECRET-TOKEN-VALUE");
    expect(page).toContain("閉じて");
    expect(page).not.toContain("SECRET-TOKEN-VALUE");
    // URL も案内している(ブラウザが開けない場合のため)
    expect(h.out.join("\n")).toContain(h.opened[0] ?? "x");
  });

  it("ブラウザが開けなくても(openBrowser が false / 例外)URL を表示して待ち続けられる", async () => {
    sandbox = makeSandbox({ token: null });
    api = await startServer(() => ({ json: exchangeOk }));
    let opener: URL | undefined;
    const h = harness(sandbox.home, api.url, () => {});
    h.deps.openBrowser = async (url) => {
      opener = new URL(url);
      throw new Error("no browser");
    };
    const running = runLogin(h.deps);
    await new Promise((r) => setTimeout(r, 100));
    expect(opener).toBeDefined();
    if (opener)
      await callback(opener, { code: "C", state: opener.searchParams.get("state") ?? "" });
    expect(await running).toBe(0);
  });
});

describe("runLogin: 拒否・失敗", () => {
  it("state が不一致のコールバックは拒否し、exchange を呼ばず、その後の正しいコールバックで完了できる", async () => {
    sandbox = makeSandbox({ token: null });
    api = await startServer(() => ({ json: exchangeOk }));
    const statuses: number[] = [];
    const h = harness(sandbox.home, api.url, async (u) => {
      statuses.push(
        (await callback(u, { code: "EVIL", state: "wrong-state-value-xxxxxxxx" })).status,
      );
      statuses.push((await callback(u, { code: "EVIL" })).status);
      statuses.push((await callback(u, { state: u.searchParams.get("state") ?? "" })).status);
      expect(api?.requests).toHaveLength(0);
      statuses.push(
        (await callback(u, { code: "GOOD", state: u.searchParams.get("state") ?? "" })).status,
      );
    });

    expect(await runLogin(h.deps)).toBe(0);
    await Promise.all(h.pending);
    expect(statuses).toEqual([400, 400, 400, 200]);
    expect(api.requests).toHaveLength(1);
    expect(JSON.parse(api.requests[0]?.body ?? "")).toEqual({ code: "GOOD" });
  });

  it("state 不一致だけでは、トークンファイルは作られない", async () => {
    sandbox = makeSandbox({ token: null });
    api = await startServer(() => ({ json: exchangeOk }));
    const h = harness(
      sandbox.home,
      api.url,
      async (u) => {
        await callback(u, { code: "EVIL", state: "wrong-state-value-xxxxxxxx" });
      },
      { timeoutMs: 300 },
    );

    expect(await runLogin(h.deps)).toBe(1);
    expect(() => statSync(join(sandbox?.home ?? "", ".ikisatsu", "token"))).toThrow();
    expect(h.err.join("\n")).toContain("時間切れ");
  });

  it("/callback 以外のパス・Host が違うリクエストは相手にしない", async () => {
    sandbox = makeSandbox({ token: null });
    api = await startServer(() => ({ json: exchangeOk }));
    const seen: number[] = [];
    const h = harness(sandbox.home, api.url, async (u) => {
      const port = u.searchParams.get("port");
      seen.push((await fetch(`http://127.0.0.1:${port}/`)).status);
      seen.push((await fetch(`http://127.0.0.1:${port}/callback`, { method: "POST" })).status);
      // Host ヘッダを偽る(node:http で送る)
      const { request } = await import("node:http");
      await new Promise<void>((resolve) => {
        const r = request(
          {
            host: "127.0.0.1",
            port: Number(port),
            path: `/callback?code=X&state=${u.searchParams.get("state")}`,
            headers: { host: "evil.example" },
          },
          (res) => {
            seen.push(res.statusCode ?? 0);
            res.resume();
            resolve();
          },
        );
        r.end();
      });
      expect(api?.requests).toHaveLength(0);
      await callback(u, { code: "OK", state: u.searchParams.get("state") ?? "" });
    });
    expect(await runLogin(h.deps)).toBe(0);
    await Promise.all(h.pending);
    expect(seen).toEqual([404, 404, 400]);
  });

  it("exchange が 400(無効 / 期限切れ / 使用済み)なら exit 1 で、トークンは保存されない", async () => {
    sandbox = makeSandbox({ token: null });
    api = await startServer(() => ({
      status: 400,
      json: { error: { code: "invalid_code", message: "x" } },
    }));
    const h = harness(sandbox.home, api.url, async (u) => {
      await callback(u, { code: "OLD", state: u.searchParams.get("state") ?? "" });
    });
    expect(await runLogin(h.deps)).toBe(1);
    expect(h.err.join("\n")).toContain("無効か、期限切れ");
    expect(() => statSync(join(sandbox?.home ?? "", ".ikisatsu", "token"))).toThrow();
  });

  it("exchange が 500 / 不正な応答なら exit 1", async () => {
    for (const reply of [
      { status: 500 },
      { json: { token: "" } },
      { json: { token: "t", member: {}, team: {} } },
      { json: [] },
    ]) {
      sandbox = makeSandbox({ token: null });
      const home = sandbox.home;
      api = await startServer(() => reply);
      const h = harness(sandbox.home, api.url, async (u) => {
        await callback(u, { code: "C", state: u.searchParams.get("state") ?? "" });
      });
      expect(await runLogin(h.deps)).toBe(1);
      expect(h.err.join("\n")).toContain("失敗しました");
      expect(() => statSync(join(home, ".ikisatsu", "token"))).toThrow();
      sandbox.cleanup();
      await api.close();
    }
    sandbox = undefined;
    api = undefined;
  });

  it("API に接続できなければ exit 1(メッセージにトークンや URL のクエリを含めない)", async () => {
    sandbox = makeSandbox({ token: null });
    const h = harness(sandbox.home, "http://127.0.0.1:1", async (u) => {
      await callback(u, { code: "C", state: u.searchParams.get("state") ?? "" });
    });
    expect(await runLogin(h.deps)).toBe(1);
    expect(h.err.join("\n")).toContain("接続できませんでした");
  });

  it("コールバックが来ないまま時間切れなら exit 1", async () => {
    sandbox = makeSandbox({ token: null });
    api = await startServer();
    const h = harness(sandbox.home, api.url, () => {}, { timeoutMs: 100 });
    expect(await runLogin(h.deps)).toBe(1);
    expect(h.err.join("\n")).toContain("時間切れ");
  });

  it("トークンを保存できなければ exit 1(HOME 配下に書けない)", async () => {
    sandbox = makeSandbox({ token: null });
    api = await startServer(() => ({ json: exchangeOk }));
    // ~/.ikisatsu をファイルにしておき、ディレクトリを作れないようにする
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(sandbox.home, ".ikisatsu"), "x");
    const h = harness(sandbox.home, api.url, async (u) => {
      await callback(u, { code: "C", state: u.searchParams.get("state") ?? "" });
    });
    expect(await runLogin(h.deps)).toBe(1);
    expect(h.err.join("\n")).toContain("保存できませんでした");
    expect(h.err.join("\n")).not.toContain("SECRET-TOKEN-VALUE");
  });

  it("同じコードでの 2 回目のコールバックは使用済みとして拒否する", async () => {
    sandbox = makeSandbox({ token: null });
    api = await startServer(() => ({ json: exchangeOk }));
    let second = 0;
    const h = harness(sandbox.home, api.url, async (u) => {
      const p = { code: "C", state: u.searchParams.get("state") ?? "" };
      await callback(u, p);
      second = (await callback(u, p).catch(() => new Response(null, { status: 599 }))).status;
    });
    expect(await runLogin(h.deps)).toBe(0);
    await Promise.all(h.pending);
    // 完了後はサーバが閉じるため 2 回目は接続できない(599)か使用済み(400)のどちらか(接続できないときは 599 の代用)。exchange は 1 回だけ
    expect([599, 400]).toContain(second);
    expect(api.requests).toHaveLength(1);
  });

  it("IKISATSU_APP_URL / IKISATSU_API_URL が不正なら exit 1", async () => {
    sandbox = makeSandbox({ token: null });
    const h = harness(sandbox.home, "ftp://x", () => {});
    expect(await runLogin(h.deps)).toBe(1);
    expect(h.err.join("\n")).toContain("不正");
    expect(h.opened).toHaveLength(0);
  });
});

describe("openBrowserWith", () => {
  function fakeSpawn(event: "spawn" | "error" | "throw") {
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    const impl = ((cmd: string, args: readonly string[]) => {
      calls.push({ cmd, args });
      if (event === "throw") throw new Error("boom");
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = () => {};
      queueMicrotask(() => child.emit(event));
      return child;
    }) as unknown as Parameters<typeof openBrowserWith>[0];
    return { impl, calls };
  }
  const url = "https://app.example.test/cli/login?port=1&state=abc";

  it("OS ごとのコマンドで開く", async () => {
    for (const [platform, cmd] of [
      ["darwin", "open"],
      ["linux", "xdg-open"],
      ["win32", "rundll32"],
    ] as const) {
      const { impl, calls } = fakeSpawn("spawn");
      expect(await openBrowserWith(impl, platform, url)).toBe(true);
      expect(calls[0]?.cmd).toBe(cmd);
      expect(calls[0]?.args).toContain(url);
    }
  });

  it("起動に失敗したら false(例外にしない)", async () => {
    expect(await openBrowserWith(fakeSpawn("error").impl, "linux", url)).toBe(false);
    expect(await openBrowserWith(fakeSpawn("throw").impl, "linux", url)).toBe(false);
  });
});

describe("defaultLoginDeps", () => {
  it("本物の環境を参照する(ブラウザは開かない)", () => {
    const d = defaultLoginDeps();
    expect(d.timeoutMs).toBe(5 * 60 * 1000);
    expect(d.env).toBe(process.env);
  });
});
