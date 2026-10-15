// ../../packages/core/src/transcript.ts
var TRANSCRIPT_LIMITS = {
  maxEntries: 5e3,
  maxTextChars: 2e4,
  maxBodyBytes: 5 * 1024 * 1024
};
var SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
var PROJECT_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
function isValidSessionId(value) {
  return SESSION_ID_PATTERN.test(value);
}
function isValidProjectId(value) {
  return PROJECT_ID_PATTERN.test(value) && value !== "." && value !== "..";
}

// src/lib/config.ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

// src/lib/hook-context.ts
async function resolveHookContext(input, deps, options) {
  if (input === null) return null;
  const rawSessionId = input.session_id;
  const sessionId = typeof rawSessionId === "string" && isValidSessionId(rawSessionId) ? rawSessionId : "";
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
    cwd
  };
}

// src/lib/diag-log.ts
import { appendFile, chmod as chmod2, mkdir as mkdir2, rename as rename2, stat } from "node:fs/promises";
import { join as join3 } from "node:path";
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

// src/lib/authed-request.ts
async function authedRequest(ctx, deps, hook, options) {
  const first = await request({
    ...options,
    token: ctx.token,
    fetchImpl: deps.fetchImpl,
    diagnostics: { home: deps.home, hook, tokenSource: ctx.tokenSource }
  });
  if (first.status !== 401 || ctx.tokenSource !== "env") return first;
  const fromFile = await readTokenWithSource({}, deps.home);
  if (fromFile === null || fromFile.token === ctx.token) return first;
  return request({
    ...options,
    token: fromFile.token,
    fetchImpl: deps.fetchImpl,
    diagnostics: { home: deps.home, hook, tokenSource: fromFile.source }
  });
}

// src/lib/session-end-signal.ts
var SESSION_END_TIMEOUT_MS = 5e3;
async function signalSessionEnd(ctx, deps, hook) {
  await authedRequest(ctx, deps, hook, {
    method: "POST",
    url: `${ctx.apiUrl}/v1/sessions/${ctx.sessionId}/end`,
    timeoutMs: deps.timeoutMs ?? SESSION_END_TIMEOUT_MS
  });
}

// src/claude-code/session-end.ts
async function handleSessionEnd(input, deps) {
  const ctx = await resolveHookContext(input, deps, { requireSessionId: true });
  if (ctx === null) return;
  await signalSessionEnd(ctx, deps, "claude-code-session-end");
}

// src/lib/entry.ts
import { homedir } from "node:os";

// src/lib/fail-open.ts
var defaultDeps = { exit: (code) => process.exit(code), deadlineMs: 2e4 };
async function runFailOpen(main, deps = defaultDeps) {
  const timer = setTimeout(() => {
    console.error("ikisatsu: \u6642\u9593\u5207\u308C\u306E\u305F\u3081\u4E2D\u65AD\u3057\u307E\u3057\u305F(\u30BB\u30C3\u30B7\u30E7\u30F3\u306B\u306F\u5F71\u97FF\u3057\u307E\u305B\u3093)");
    deps.exit(0);
  }, deps.deadlineMs);
  timer.unref();
  try {
    await main();
  } catch {
    console.error("ikisatsu: \u51E6\u7406\u306B\u5931\u6557\u3057\u307E\u3057\u305F(\u30BB\u30C3\u30B7\u30E7\u30F3\u306B\u306F\u5F71\u97FF\u3057\u307E\u305B\u3093)");
  }
  clearTimeout(timer);
  deps.exit(0);
}

// src/lib/stdin.ts
async function readStdin(stream = process.stdin) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf-8");
}
function parseHookInput(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// src/lib/entry.ts
function defaultHookDeps() {
  return { env: process.env, home: homedir(), cwd: process.cwd() };
}
async function runHookEntry(handler) {
  await runFailOpen(async () => {
    const input = parseHookInput(await readStdin());
    await handler(input, defaultHookDeps());
  });
}

// src/entries/claude-code-session-end.ts
await runHookEntry(handleSessionEnd);
