// src/entries/mcp.ts
import { homedir } from "node:os";

// src/mcp/proxy.ts
import { createInterface } from "node:readline";

// src/lib/config.ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// ../../packages/core/src/transcript.ts
var TRANSCRIPT_LIMITS = {
  maxEntries: 5e3,
  maxTextChars: 2e4,
  maxBodyBytes: 5 * 1024 * 1024
};
var PROJECT_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
function isValidProjectId(value) {
  return PROJECT_ID_PATTERN.test(value) && value !== "." && value !== "..";
}

// src/lib/config.ts
var DEFAULT_API_URL = "https://api.ikisatsu.dev";
function baseUrl(value, fallback) {
  const raw = value?.trim() || fallback;
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("URL \u306E\u30B9\u30AD\u30FC\u30E0\u306F http \u304B https \u306E\u307F");
  }
  return raw.replace(/\/+$/, "");
}
function apiBaseUrl(env) {
  return baseUrl(env.IKISATSU_API_URL, DEFAULT_API_URL);
}
async function readProjectId(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const id = parsed.projectId;
    return typeof id === "string" && isValidProjectId(id) ? id : null;
  } catch {
    return null;
  }
}
async function findProjectConfig(startDir) {
  let dir = startDir;
  for (; ; ) {
    const projectId = await readProjectId(join(dir, ".ikisatsu.json"));
    if (projectId !== null) return { projectId, root: dir };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// src/lib/diag-log.ts
import { appendFile, chmod as chmod2, mkdir as mkdir2, rename as rename2, stat } from "node:fs/promises";
import { join as join3 } from "node:path";

// src/lib/token.ts
import { chmod, mkdir, readFile as readFile2, rename, writeFile } from "node:fs/promises";
import { join as join2 } from "node:path";
function tokenDir(home) {
  return join2(home, ".ikisatsu");
}
function tokenFilePath(home) {
  return join2(tokenDir(home), "token");
}
async function readTokenWithSource(env, home) {
  const fromEnv = env.IKISATSU_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: "env" };
  try {
    const fromFile = (await readFile2(tokenFilePath(home), "utf-8")).trim();
    return fromFile === "" ? null : { token: fromFile, source: "file" };
  } catch {
    return null;
  }
}

// src/lib/diag-log.ts
var MAX_LOG_BYTES = 512 * 1024;
function logDir(home) {
  return join3(tokenDir(home), "logs");
}
function httpErrorLogPath(home) {
  return join3(logDir(home), "http-errors.log");
}
async function appendHttpFailure(home, line) {
  await appendLine(home, httpErrorLogPath(home), line);
}
async function appendLine(home, path, line) {
  try {
    const dir = logDir(home);
    await mkdir2(dir, { recursive: true, mode: 448 });
    await chmod2(dir, 448);
    try {
      if ((await stat(path)).size > MAX_LOG_BYTES) await rename2(path, `${path}.1`);
    } catch {
    }
    await appendFile(path, `${JSON.stringify(line)}
`, { mode: 384 });
    await chmod2(path, 384);
  } catch {
  }
}

// src/lib/http.ts
var USER_AGENT = "ikisatsu-hooks";
var BODY_HEAD_CHARS = 300;
function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}
function isControl(ch) {
  const code = ch.codePointAt(0) ?? 0;
  return code < 32 || code === 127 || code === 8232 || code === 8233;
}
function bodyHead(text) {
  return Array.from(text.slice(0, BODY_HEAD_CHARS), (ch) => isControl(ch) ? " " : ch).join("");
}
async function request(options) {
  const doFetch = options.fetchImpl ?? fetch;
  const headers = { "user-agent": USER_AGENT };
  if (options.token !== void 0) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== void 0) headers["content-type"] = "application/json";
  const { diagnostics } = options;
  let res;
  try {
    res = await doFetch(options.url, {
      method: options.method,
      headers,
      body: options.body === void 0 ? void 0 : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs)
    });
  } catch (err) {
    if (diagnostics) {
      const e = err instanceof Error ? err : void 0;
      const cause = e?.cause ?? void 0;
      await appendHttpFailure(diagnostics.home, {
        at: (/* @__PURE__ */ new Date()).toISOString(),
        hook: diagnostics.hook,
        method: options.method,
        path: pathOf(options.url),
        tokenSource: diagnostics.tokenSource,
        error: e?.name ?? "UnknownError",
        code: typeof cause?.code === "string" ? cause.code : void 0
      });
    }
    throw err;
  }
  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = void 0;
  }
  if (!res.ok && diagnostics) {
    await appendHttpFailure(diagnostics.home, {
      at: (/* @__PURE__ */ new Date()).toISOString(),
      hook: diagnostics.hook,
      method: options.method,
      path: pathOf(options.url),
      tokenSource: diagnostics.tokenSource,
      status: res.status,
      cfRay: res.headers.get("cf-ray"),
      server: res.headers.get("server"),
      cfMitigated: res.headers.get("cf-mitigated"),
      contentType: res.headers.get("content-type"),
      bodyHead: bodyHead(text)
    });
  }
  return { status: res.status, ok: res.ok, json };
}

// src/mcp/proxy.ts
var DEFAULT_TIMEOUT_MS = 3e4;
var HOOK = "mcp";
var LOGIN_MESSAGE = "ikisatsu \u306B\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u3044\u306A\u3044\u304B\u3001\u30C8\u30FC\u30AF\u30F3\u304C\u7121\u52B9\u3067\u3059\u3002\u300Cikisatsu \u306B\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u300D\u3068\u983C\u3093\u3067\u30ED\u30B0\u30A4\u30F3\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044";
var rpcError = (id, code, message) => JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
function asRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;
}
async function withDefaultProjectId(msg, cwd) {
  if (msg.method !== "tools/call") return msg;
  const params = asRecord(msg.params) ?? {};
  const args = asRecord(params.arguments) ?? {};
  if (typeof args.projectId === "string") return msg;
  const project = await findProjectConfig(cwd);
  if (project === null) return msg;
  return { ...msg, params: { ...params, arguments: { ...args, projectId: project.projectId } } };
}
async function forwardMcpMessage(line, deps) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return rpcError(null, -32700, "JSON \u3068\u3057\u3066\u8AAD\u3081\u307E\u305B\u3093");
  }
  const msg = asRecord(parsed);
  if (msg === null) return rpcError(null, -32600, "JSON-RPC \u306E\u30E1\u30C3\u30BB\u30FC\u30B8\u3067\u306F\u3042\u308A\u307E\u305B\u3093");
  const rawId = msg.id;
  const isNotification = rawId === void 0 || rawId === null;
  const id = typeof rawId === "string" || typeof rawId === "number" ? rawId : null;
  const reply = (text) => isNotification ? null : text;
  const token = await readTokenWithSource(deps.env, deps.home);
  if (token === null) return reply(rpcError(id, -32001, LOGIN_MESSAGE));
  const body = await withDefaultProjectId(msg, deps.cwd);
  const url = `${apiBaseUrl(deps.env)}/mcp`;
  const send = (t, source) => request({
    method: "POST",
    url,
    token: t,
    body,
    timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    fetchImpl: deps.fetchImpl,
    diagnostics: { home: deps.home, hook: HOOK, tokenSource: source }
  });
  let res;
  try {
    res = await send(token.token, token.source);
    if (res.status === 401 && token.source === "env") {
      const fromFile = await readTokenWithSource({}, deps.home);
      if (fromFile !== null && fromFile.token !== token.token) {
        res = await send(fromFile.token, fromFile.source);
      }
    }
  } catch {
    return reply(rpcError(id, -32002, "ikisatsu \u306E API \u306B\u63A5\u7D9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F"));
  }
  if (res.status === 202) return null;
  if (res.status === 401) return reply(rpcError(id, -32001, LOGIN_MESSAGE));
  if (asRecord(res.json)?.jsonrpc === "2.0") return reply(JSON.stringify(res.json));
  return reply(rpcError(id, -32003, `ikisatsu \u306E API \u304C\u30A8\u30E9\u30FC\u3092\u8FD4\u3057\u307E\u3057\u305F(HTTP ${res.status})`));
}
async function runMcpProxy(deps) {
  const pending = /* @__PURE__ */ new Set();
  const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of rl) {
    if (line.trim() === "") continue;
    const p = forwardMcpMessage(line, deps).then((out) => {
      if (out !== null) process.stdout.write(`${out}
`);
    }).catch(() => {
    }).finally(() => pending.delete(p));
    pending.add(p);
  }
  await Promise.all(pending);
}

// src/entries/mcp.ts
await runMcpProxy({ env: process.env, home: homedir(), cwd: process.cwd() });
