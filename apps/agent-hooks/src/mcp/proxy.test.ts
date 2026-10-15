// プラグイン同梱の MCP の中継(stdio → https://api.ikisatsu.dev/mcp)のテスト
import { afterEach, describe, expect, it } from "vitest";
import {
  makeSandbox,
  type RecordedRequest,
  type Sandbox,
  startServer,
  type TestServer,
} from "../testing/sandbox.ts";
import { forwardMcpMessage } from "./proxy.ts";

const FILE_TOKEN = "iks_fresh-token";
const STALE_TOKEN = "iks_stale-token";

let sandbox: Sandbox | undefined;
let server: TestServer | undefined;

afterEach(async () => {
  sandbox?.cleanup();
  await server?.close();
  sandbox = undefined;
  server = undefined;
});

/** FILE_TOKEN だけを通し、通知には 202、リクエストには受けた本文を result に入れて返すサーバ */
async function setup(fileToken: string | null = FILE_TOKEN, project: string | null = "proj-a") {
  sandbox = makeSandbox({ token: fileToken, project });
  server = await startServer((req: RecordedRequest) => {
    if (req.headers.authorization !== `Bearer ${FILE_TOKEN}`) {
      return { status: 401, json: { error: { code: "unauthorized", message: "x" } } };
    }
    const msg = JSON.parse(req.body) as { id?: unknown };
    if (msg.id === undefined) return { status: 202 };
    return { json: { jsonrpc: "2.0", id: msg.id, result: { echo: JSON.parse(req.body) } } };
  });
  return { sb: sandbox, srv: server };
}

interface RpcLine {
  id?: unknown;
  result?: unknown;
  error: { code: number; message: string };
}
const parse = (line: string | null) => JSON.parse(line ?? "null") as RpcLine;

describe("forwardMcpMessage", () => {
  it("リクエストを /mcp に Bearer 付きで送り、応答を 1 行の JSON で返す", async () => {
    const { sb, srv } = await setup();
    const line = await forwardMcpMessage(
      JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
      sb.deps(srv.url),
    );

    expect(srv.requests[0]?.path).toBe("/mcp");
    expect(srv.requests[0]?.method).toBe("POST");
    expect(srv.requests[0]?.headers.authorization).toBe(`Bearer ${FILE_TOKEN}`);
    expect(line).not.toContain("\n");
    expect(parse(line).id).toBe(7);
  });

  it("通知(202)には何も返さない", async () => {
    const { sb, srv } = await setup();
    const line = await forwardMcpMessage(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      sb.deps(srv.url),
    );
    expect(line).toBeNull();
  });

  it("tools/call で projectId が無ければ .ikisatsu.json の値を足す", async () => {
    const { sb, srv } = await setup();
    await forwardMcpMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_digests", arguments: {} },
      }),
      sb.deps(srv.url),
    );
    const sent = JSON.parse(srv.requests[0]?.body ?? "{}");
    expect(sent.params.arguments.projectId).toBe("proj-a");
  });

  it("projectId が渡されていれば上書きしない", async () => {
    const { sb, srv } = await setup();
    await forwardMcpMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_digests", arguments: { projectId: "other" } },
      }),
      sb.deps(srv.url),
    );
    expect(JSON.parse(srv.requests[0]?.body ?? "{}").params.arguments.projectId).toBe("other");
  });

  it("古い IKISATSU_TOKEN で 401 なら ~/.ikisatsu/token で 1 回だけ送り直す", async () => {
    const { sb, srv } = await setup();
    const line = await forwardMcpMessage(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      sb.deps(srv.url, { IKISATSU_TOKEN: STALE_TOKEN }),
    );
    expect(srv.requests.map((r) => r.headers.authorization)).toEqual([
      `Bearer ${STALE_TOKEN}`,
      `Bearer ${FILE_TOKEN}`,
    ]);
    expect(parse(line).result).toBeDefined();
  });

  it("トークンが無ければ送らず、ログインを促す JSON-RPC のエラーを返す", async () => {
    const { sb, srv } = await setup(null);
    const line = await forwardMcpMessage(
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
      sb.deps(srv.url),
    );
    expect(srv.requests).toHaveLength(0);
    expect(parse(line).id).toBe(3);
    expect(parse(line).error.message).toContain("ログイン");
  });

  it("401 のままならログインを促すエラーで、トークンを出さない", async () => {
    const { sb, srv } = await setup("iks_wrong");
    const line = await forwardMcpMessage(
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
      sb.deps(srv.url),
    );
    expect(parse(line).error.message).toContain("ログイン");
    expect(line).not.toContain("iks_wrong");
  });

  it("接続できなければ JSON-RPC のエラーを返す(例外を投げない)", async () => {
    const { sb } = await setup();
    const line = await forwardMcpMessage(
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
      { ...sb.deps("http://127.0.0.1:1"), timeoutMs: 2000 },
    );
    expect(parse(line).id).toBe(4);
    expect(parse(line).error).toBeDefined();
  });

  it("JSON として読めない行には -32700 を返す", async () => {
    const { sb, srv } = await setup();
    const line = await forwardMcpMessage("{broken", sb.deps(srv.url));
    expect(parse(line).error.code).toBe(-32700);
    expect(srv.requests).toHaveLength(0);
  });
});
