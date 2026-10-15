// ../../packages/core/src/digest.ts
var TITLE = "## ikisatsu: \u3053\u306E\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u306E\u4F5C\u696D\u72B6\u6CC1(\u30C1\u30FC\u30E0\u306E\u77ED\u671F\u306E\u8A18\u61B6)";
var INTRO = "\u4EE5\u4E0B\u306F\u5404\u30E1\u30F3\u30D0\u30FC\u306E\u76F4\u8FD1\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u30AF\u30E9\u30A6\u30C9\u3067\u8981\u7D04\u3057\u305F\u3082\u306E\u3002\u4F5C\u696D\u3092\u518D\u958B\u3059\u308B\u3068\u304D\u306F\u3001\u307E\u305A\u81EA\u5206\u306E\u5206\u3092\u8AAD\u3080\u3053\u3068\u3002";
function formatWhen(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return `${t.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
function headingLine(d) {
  const name = d.isMine ? "\u3042\u306A\u305F" : d.displayName ?? "\u30E1\u30F3\u30D0\u30FC";
  const tool = d.toolLabel ? `\u30FB${d.toolLabel}` : "";
  return `### ${name}(${formatWhen(d.updatedAt)} \u66F4\u65B0${tool})\u2014 ${d.headline}`;
}
function section(d, withBody) {
  return withBody && d.body !== "" ? `${headingLine(d)}
${d.body}` : headingLine(d);
}
function assemble(sections) {
  return [TITLE, INTRO, "", sections.join("\n\n")].join("\n");
}
function order(digests) {
  const byNewest = (a, b) => a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
  return [
    ...digests.filter((d) => d.isMine).sort(byNewest),
    ...digests.filter((d) => !d.isMine).sort(byNewest)
  ];
}
function formatDigestsForInjection(digests, options) {
  const ordered = order(digests);
  if (ordered.length === 0) return "";
  const withBody = ordered.map(() => true);
  const build = (count2) => assemble(ordered.slice(0, count2).map((d, i) => section(d, withBody[i] === true)));
  let count = ordered.length;
  let text = build(count);
  if (text.length <= options.maxChars) return text;
  for (let i = ordered.length - 1; i >= 0; i--) {
    withBody[i] = false;
    text = build(count);
    if (text.length <= options.maxChars) return text;
  }
  while (count > 1) {
    count--;
    text = build(count);
    if (text.length <= options.maxChars) return text;
  }
  return "";
}

// ../../packages/core/src/injection-domain.ts
var DOMAIN_INJECTION_SHARE = 0.4;
var TITLE2 = "## ikisatsu: \u3053\u306E\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u306E\u30EB\u30FC\u30EB\u3068\u6700\u8FD1\u306E\u6C7A\u5B9A(\u9577\u671F\u306E\u8A18\u61B6)";
var INTRO2 = "\u30C1\u30FC\u30E0\u306E\u4F1A\u8A71\u304B\u3089\u53D6\u308A\u51FA\u3057\u305F\u3082\u306E\u3002\u30EB\u30FC\u30EB\u306F\u5B88\u308B\u3053\u3068\u3002\u8986\u3055\u308C\u305F\u3082\u306E\u306F\u9664\u3044\u3066\u3042\u308B\u3002";
function formatDay(iso) {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : t.toISOString().slice(0, 10);
}
var ruleLine = (r) => `- ${r.name}: ${r.statement}`;
var decisionLine = (d) => `- ${formatDay(d.decidedAt)} ${d.name}(${d.displayName ?? "\u30E1\u30F3\u30D0\u30FC"})\u2014 ${d.rationale}`;
function formatDomainBlock(domain, maxChars) {
  const { rules, decisions } = domain;
  if (rules.length === 0 && decisions.length === 0) return "";
  const build = (ruleCount, decisionCount) => {
    const lines = [TITLE2, INTRO2];
    const omitted = rules.length - ruleCount;
    if (ruleCount > 0 || omitted > 0) {
      lines.push("### \u30EB\u30FC\u30EB", ...rules.slice(0, ruleCount).map(ruleLine));
      if (omitted > 0) lines.push(`- (\u4ED6 ${omitted} \u4EF6\u306E\u30EB\u30FC\u30EB\u306F\u30C1\u30FC\u30E0\u306E\u8A18\u61B6\u306E\u30DA\u30FC\u30B8\u306B\u3042\u308B)`);
    }
    if (decisionCount > 0) {
      lines.push("### \u6700\u8FD1\u306E\u6C7A\u5B9A", ...decisions.slice(0, decisionCount).map(decisionLine));
    }
    return lines.join("\n");
  };
  for (let d = decisions.length; d >= 0; d--) {
    const text = build(rules.length, d);
    if (text.length <= maxChars) return text;
  }
  for (let r = rules.length - 1; r >= 0; r--) {
    const text = build(r, 0);
    if (text.length <= maxChars) return text;
  }
  return "";
}
function formatInjection(digests, domain, options) {
  if (!domain) return formatDigestsForInjection(digests, options);
  const block = formatDomainBlock(domain, Math.floor(options.maxChars * DOMAIN_INJECTION_SHARE));
  if (block === "") return formatDigestsForInjection(digests, options);
  const rest = options.maxChars - block.length - 2;
  const digestsText = formatDigestsForInjection(digests, { ...options, maxChars: rest });
  return digestsText === "" ? block : `${digestsText}

${block}`;
}

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

// src/lib/injection.ts
var SESSION_START_TIMEOUT_MS = 5e3;
var MAX_NOTICE_CHARS = 300;
function isDigest(v) {
  if (typeof v !== "object" || v === null) return false;
  const d = v;
  return typeof d.headline === "string" && typeof d.body === "string" && typeof d.updatedAt === "string" && typeof d.isMine === "boolean" && (d.displayName === null || typeof d.displayName === "string");
}
function isRecord(v) {
  return typeof v === "object" && v !== null;
}
function isInjectionDomain(v) {
  if (!isRecord(v) || !Array.isArray(v.rules) || !Array.isArray(v.decisions)) return false;
  const rulesOk = v.rules.every(
    (r) => isRecord(r) && typeof r.name === "string" && typeof r.statement === "string"
  );
  const decisionsOk = v.decisions.every(
    (d) => isRecord(d) && typeof d.name === "string" && typeof d.rationale === "string" && typeof d.decidedAt === "string" && (d.displayName === null || typeof d.displayName === "string")
  );
  return rulesOk && decisionsOk;
}
async function fetchInjectionText(ctx, deps, maxChars, hook) {
  const res = await authedRequest(ctx, deps, hook, {
    method: "GET",
    url: `${ctx.apiUrl}/v1/digests?projectId=${encodeURIComponent(ctx.projectId)}`,
    timeoutMs: deps.timeoutMs ?? SESSION_START_TIMEOUT_MS
  });
  if (!res.ok) return "";
  const json = res.json;
  const digests = json?.digests;
  if (!Array.isArray(digests)) return "";
  const domain = isInjectionDomain(json?.domain) ? json.domain : null;
  const notice = typeof json?.notice === "string" ? [...json.notice.trim()].slice(0, MAX_NOTICE_CHARS).join("") : "";
  if (notice === "") return formatInjection(digests.filter(isDigest), domain, { maxChars });
  const rest = formatInjection(digests.filter(isDigest), domain, {
    maxChars: maxChars - notice.length - 2
  });
  return rest === "" ? notice : `${notice}

${rest}`;
}

// src/claude-code/session-start.ts
var SESSION_START_MAX_CHARS = 8e3;
async function handleSessionStart(input, deps) {
  const ctx = await resolveHookContext(input, deps, { requireSessionId: false });
  if (ctx === null) return;
  const additionalContext = await fetchInjectionText(
    ctx,
    deps,
    SESSION_START_MAX_CHARS,
    "claude-code-session-start"
  );
  if (additionalContext === "") return;
  console.log(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } })
  );
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

// src/entries/claude-code-session-start.ts
await runHookEntry(handleSessionStart);
