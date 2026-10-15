// src/login/login.ts
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { homedir } from "node:os";

// ../../packages/core/src/transcript.ts
var TRANSCRIPT_LIMITS = {
  maxEntries: 5e3,
  maxTextChars: 2e4,
  maxBodyBytes: 5 * 1024 * 1024
};

// src/lib/config.ts
var DEFAULT_API_URL = "https://api.ikisatsu.dev";
var DEFAULT_APP_URL = "https://app.ikisatsu.dev";
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
function appBaseUrl(env) {
  return baseUrl(env.IKISATSU_APP_URL, DEFAULT_APP_URL);
}

// src/lib/diag-log.ts
import { appendFile, chmod as chmod2, mkdir as mkdir2, rename as rename2, stat } from "node:fs/promises";
import { join as join2 } from "node:path";

// src/lib/token.ts
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
function tokenDir(home) {
  return join(home, ".ikisatsu");
}
function tokenFilePath(home) {
  return join(tokenDir(home), "token");
}
async function writeToken(token, home) {
  const dir = tokenDir(home);
  await mkdir(dir, { recursive: true, mode: 448 });
  await chmod(dir, 448);
  const path = tokenFilePath(home);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${token}
`, { mode: 384 });
  await chmod(tmp, 384);
  await rename(tmp, path);
  return path;
}

// src/lib/diag-log.ts
var MAX_LOG_BYTES = 512 * 1024;
function logDir(home) {
  return join2(tokenDir(home), "logs");
}
function httpErrorLogPath(home) {
  return join2(logDir(home), "http-errors.log");
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

// src/login/login.ts
var LOGIN_TIMEOUT_MS = 5 * 60 * 1e3;
var EXCHANGE_TIMEOUT_MS = 15e3;
var LoginError = class extends Error {
};
function isExchangeResult(v) {
  if (typeof v !== "object" || v === null) return false;
  const r = v;
  const member = r.member;
  const team = r.team;
  return typeof r.token === "string" && r.token !== "" && typeof member?.email === "string" && typeof team?.name === "string";
}
function statesMatch(expected, actual) {
  if (actual === null) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}
function page(res, status, title, message) {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("connection", "close");
  res.end(
    `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ikisatsu</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${message}</p></body></html>`
  );
}
async function exchange(apiUrl, code, fetchImpl) {
  let res;
  try {
    res = await request({
      method: "POST",
      url: `${apiUrl}/v1/cli/exchange`,
      body: { code },
      timeoutMs: EXCHANGE_TIMEOUT_MS,
      fetchImpl
    });
  } catch {
    throw new LoginError(
      "API \u306B\u63A5\u7D9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u3092\u78BA\u8A8D\u3057\u3066\u3001\u3082\u3046\u4E00\u5EA6\u8A66\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
    );
  }
  if (res.status === 400) {
    throw new LoginError(
      "\u30ED\u30B0\u30A4\u30F3\u30B3\u30FC\u30C9\u304C\u7121\u52B9\u304B\u3001\u671F\u9650\u5207\u308C\u3067\u3059\u3002\u3082\u3046\u4E00\u5EA6\u30ED\u30B0\u30A4\u30F3\u3092\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
    );
  }
  if (!res.ok || !isExchangeResult(res.json)) {
    throw new LoginError(
      `\u30C8\u30FC\u30AF\u30F3\u306E\u767A\u884C\u306B\u5931\u6557\u3057\u307E\u3057\u305F(HTTP ${res.status})\u3002\u3057\u3070\u3089\u304F\u3057\u3066\u304B\u3089\u3082\u3046\u4E00\u5EA6\u8A66\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    );
  }
  return res.json;
}
async function runLogin(deps) {
  let appUrl;
  let apiUrl;
  try {
    appUrl = appBaseUrl(deps.env);
    apiUrl = apiBaseUrl(deps.env);
  } catch {
    deps.printError(
      "IKISATSU_APP_URL / IKISATSU_API_URL \u304C\u4E0D\u6B63\u3067\u3059(http \u304B https \u306E URL \u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044)\u3002"
    );
    return 1;
  }
  const state = randomBytes(24).toString("base64url");
  let handled = false;
  let settle = () => {
  };
  const done = new Promise((resolve) => {
    settle = resolve;
  });
  const handle = async (req, res, port) => {
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
      page(res, 400, "\u30ED\u30B0\u30A4\u30F3\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F", "\u4E0D\u6B63\u306A\u30EA\u30AF\u30A8\u30B9\u30C8\u3067\u3059\u3002");
      return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (req.method !== "GET" || url.pathname !== "/callback") {
      page(res, 404, "\u898B\u3064\u304B\u308A\u307E\u305B\u3093", "\u3053\u306E\u30DA\u30FC\u30B8\u306F\u3042\u308A\u307E\u305B\u3093\u3002");
      return;
    }
    const code = url.searchParams.get("code");
    if (!statesMatch(state, url.searchParams.get("state")) || !code) {
      page(
        res,
        400,
        "\u30ED\u30B0\u30A4\u30F3\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F",
        "\u78BA\u8A8D\u30B3\u30FC\u30C9\u304C\u4E00\u81F4\u3057\u307E\u305B\u3093\u3002\u30BF\u30FC\u30DF\u30CA\u30EB\u306E\u6848\u5185\u304B\u3089\u3001\u3082\u3046\u4E00\u5EA6\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
      );
      return;
    }
    if (handled) {
      page(res, 400, "\u30ED\u30B0\u30A4\u30F3\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F", "\u3053\u306E\u30B3\u30FC\u30C9\u306F\u4F7F\u7528\u6E08\u307F\u3067\u3059\u3002");
      return;
    }
    handled = true;
    try {
      const result = await exchange(apiUrl, code, deps.fetchImpl);
      await writeToken(result.token, deps.home);
      res.once("finish", () => settle(result));
      page(
        res,
        200,
        "\u30ED\u30B0\u30A4\u30F3\u3057\u307E\u3057\u305F",
        "\u3053\u306E\u30BF\u30D6\u306F\u9589\u3058\u3066\u5927\u4E08\u592B\u3067\u3059\u3002\u30BF\u30FC\u30DF\u30CA\u30EB\u306B\u623B\u3063\u3066\u304F\u3060\u3055\u3044\u3002"
      );
    } catch (e) {
      const error = e instanceof LoginError ? e : new LoginError(
        "\u30C8\u30FC\u30AF\u30F3\u3092\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F(~/.ikisatsu \u306E\u6A29\u9650\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044)\u3002"
      );
      res.once("finish", () => settle(error));
      page(res, 500, "\u30ED\u30B0\u30A4\u30F3\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F", "\u30BF\u30FC\u30DF\u30CA\u30EB\u306E\u8868\u793A\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    }
  };
  const server = createServer((req, res) => {
    const port = server.address().port;
    handle(req, res, port).catch(() => {
      page(res, 500, "\u30ED\u30B0\u30A4\u30F3\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F", "\u5185\u90E8\u30A8\u30E9\u30FC\u3067\u3059\u3002");
      settle(new LoginError("\u30ED\u30B0\u30A4\u30F3\u306E\u51E6\u7406\u4E2D\u306B\u30A8\u30E9\u30FC\u304C\u8D77\u304D\u307E\u3057\u305F\u3002"));
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch {
    deps.printError("\u30ED\u30FC\u30AB\u30EB\u306E\u5F85\u3061\u53D7\u3051\u3092\u958B\u59CB\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
    return 1;
  }
  const timer = setTimeout(
    () => settle(
      new LoginError(
        "\u6642\u9593\u5207\u308C\u3067\u3059(5 \u5206\u4EE5\u5185\u306B\u30D6\u30E9\u30A6\u30B6\u3067\u5B8C\u4E86\u3057\u3066\u304F\u3060\u3055\u3044)\u3002\u3082\u3046\u4E00\u5EA6\u30ED\u30B0\u30A4\u30F3\u3092\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
      )
    ),
    deps.timeoutMs
  );
  try {
    const { port } = server.address();
    const loginUrl = `${appUrl}/cli/login?port=${port}&state=${state}`;
    deps.print("\u30D6\u30E9\u30A6\u30B6\u3067 ikisatsu \u306B\u30ED\u30B0\u30A4\u30F3\u3057\u307E\u3059\u3002");
    deps.print(`\u958B\u304B\u306A\u3044\u5834\u5408\u306F\u3001\u6B21\u306E URL \u3092\u30D6\u30E9\u30A6\u30B6\u3067\u958B\u3044\u3066\u304F\u3060\u3055\u3044:
${loginUrl}`);
    void deps.openBrowser(loginUrl).catch(() => false);
    const result = await done;
    if (result instanceof LoginError) {
      deps.printError(result.message);
      return 1;
    }
    deps.print(`\u30ED\u30B0\u30A4\u30F3\u3057\u307E\u3057\u305F: ${result.member.email}(\u30C1\u30FC\u30E0: ${result.team.name})`);
    return 0;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    server.close();
  }
}
function openBrowserWith(spawnImpl, platform, url) {
  const [command, args] = platform === "darwin" ? ["open", [url]] : platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
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
function defaultLoginDeps() {
  return {
    env: process.env,
    home: homedir(),
    openBrowser: (url) => openBrowserWith(spawn, process.platform, url),
    timeoutMs: LOGIN_TIMEOUT_MS,
    print: (message) => console.log(message),
    printError: (message) => console.error(message)
  };
}

// src/entries/login.ts
process.exit(await runLogin(defaultLoginDeps()));
