import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { TRANSCRIPT_LIMITS, type TranscriptEntry } from "@ikisatsu/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiBaseUrl, appBaseUrl, findProjectConfig } from "./config.ts";
import { runFailOpen } from "./fail-open.ts";
import { fitEntries } from "./fit-upload.ts";
import { parseHookInput, readStdin } from "./stdin.ts";
import { readToken, tokenFilePath, writeToken } from "./token.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ikisatsu-lib-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("config", () => {
  it("API / APP の URL は既定値と環境変数の上書きに対応し、末尾のスラッシュを落とす", () => {
    expect(apiBaseUrl({})).toBe("https://api.ikisatsu.dev");
    expect(appBaseUrl({})).toBe("https://app.ikisatsu.dev");
    expect(apiBaseUrl({ IKISATSU_API_URL: "http://localhost:8787/" })).toBe(
      "http://localhost:8787",
    );
    expect(appBaseUrl({ IKISATSU_APP_URL: " https://x.example//" })).toBe("https://x.example");
  });

  it("http / https 以外のスキームと不正な URL は拒否する", () => {
    expect(() => apiBaseUrl({ IKISATSU_API_URL: "file:///etc/passwd" })).toThrow();
    expect(() => apiBaseUrl({ IKISATSU_API_URL: "not a url" })).toThrow();
  });

  it("findProjectConfig: cwd から親へ探し、見つけたディレクトリを root にする", async () => {
    writeFileSync(join(dir, ".ikisatsu.json"), JSON.stringify({ projectId: "p.1_x-y" }));
    mkdirSync(join(dir, "a", "b"), { recursive: true });
    expect(await findProjectConfig(join(dir, "a", "b"))).toEqual({
      projectId: "p.1_x-y",
      root: dir,
    });
  });

  it("findProjectConfig: 近い方の設定を優先し、壊れた・不正なファイルは飛ばして親を探す", async () => {
    writeFileSync(join(dir, ".ikisatsu.json"), JSON.stringify({ projectId: "outer" }));
    mkdirSync(join(dir, "a", "b"), { recursive: true });
    writeFileSync(join(dir, "a", ".ikisatsu.json"), "{broken");
    expect((await findProjectConfig(join(dir, "a", "b")))?.projectId).toBe("outer");
    writeFileSync(join(dir, "a", ".ikisatsu.json"), JSON.stringify({ projectId: "inner" }));
    expect((await findProjectConfig(join(dir, "a", "b")))?.projectId).toBe("inner");
  });

  it("findProjectConfig: projectId が不正(空 / 型違い / `..` / オブジェクトでない)なら見つからない扱い", async () => {
    mkdirSync(join(dir, "x"));
    for (const content of [
      '{"projectId":""}',
      '{"projectId":1}',
      '{"projectId":".."}',
      '{"projectId":"a/b"}',
      "[]",
      "null",
    ]) {
      writeFileSync(join(dir, "x", ".ikisatsu.json"), content);
      // 一時ディレクトリの祖先に .ikisatsu.json があると null にならないので、直下の結果だけを見る
      const found = await findProjectConfig(join(dir, "x"));
      expect(found === null || found.root !== join(dir, "x")).toBe(true);
    }
  });
});

describe("token", () => {
  it("環境変数 → ファイルの順に読み、空白は落とし、どちらも無ければ null", async () => {
    expect(await readToken({}, dir)).toBeNull();
    await writeToken("iks_file", dir);
    expect(await readToken({}, dir)).toBe("iks_file");
    expect(await readToken({ IKISATSU_TOKEN: "  iks_env " }, dir)).toBe("iks_env");
    expect(await readToken({ IKISATSU_TOKEN: "   " }, dir)).toBe("iks_file");
  });

  it("空のトークンファイルは null", async () => {
    mkdirSync(join(dir, ".ikisatsu"));
    writeFileSync(tokenFilePath(dir), "\n");
    expect(await readToken({}, dir)).toBeNull();
  });

  it.skipIf(process.platform === "win32")(
    "writeToken: ディレクトリ 0700 / ファイル 0600(既存のゆるい権限も締める)",
    async () => {
      mkdirSync(join(dir, ".ikisatsu"), { mode: 0o755 });
      writeFileSync(tokenFilePath(dir), "old", { mode: 0o644 });
      const path = await writeToken("iks_new", dir);
      expect(statSync(join(dir, ".ikisatsu")).mode & 0o777).toBe(0o700);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(await readToken({}, dir)).toBe("iks_new");
    },
  );
});

describe("stdin", () => {
  it("readStdin は複数チャンクを連結する", async () => {
    expect(await readStdin(Readable.from([Buffer.from('{"a"'), ":1}"]))).toBe('{"a":1}');
  });

  it("parseHookInput は空・壊れた JSON・配列・null を null にする", () => {
    expect(parseHookInput('{"a":1}')).toEqual({ a: 1 });
    for (const raw of ["", "  ", "{bad", "[1]", "null", "1"])
      expect(parseHookInput(raw)).toBeNull();
  });
});

describe("runFailOpen", () => {
  it("正常終了でも例外でも exit 0。例外の中身は出力しない", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const codes: number[] = [];
    await runFailOpen(async () => {}, { exit: (c) => codes.push(c), deadlineMs: 5000 });
    await runFailOpen(
      async () => {
        throw new Error("SECRET-MESSAGE");
      },
      { exit: (c) => codes.push(c), deadlineMs: 5000 },
    );
    expect(codes).toEqual([0, 0]);
    expect(err).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(err.mock.calls)).not.toContain("SECRET-MESSAGE");
  });

  it("締め切りを過ぎたら、処理の完了を待たずに exit 0", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const codes: number[] = [];
    const pending = runFailOpen(() => new Promise<void>((r) => setTimeout(r, 300)), {
      exit: (c) => codes.push(c),
      deadlineMs: 20,
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(codes).toEqual([0]);
    await pending;
  });
});

describe("fitEntries", () => {
  const user = (text: string): TranscriptEntry => ({ kind: "user", text });

  it("上限内ならそのまま", () => {
    const entries = [user("a"), user("b")];
    expect(fitEntries(entries)).toEqual(entries);
  });

  it("件数の上限を超えたら古い方から落とす", () => {
    const entries = Array.from({ length: TRANSCRIPT_LIMITS.maxEntries + 3 }, (_, i) =>
      user(`m${i}`),
    );
    const out = fitEntries(entries);
    expect(out).toHaveLength(TRANSCRIPT_LIMITS.maxEntries);
    expect(out[0]).toEqual(user("m3"));
    expect(out.at(-1)).toEqual(user(`m${TRANSCRIPT_LIMITS.maxEntries + 2}`));
  });

  it("サイズの上限を超えたら古い方から落とす(新しい発言は残る)", () => {
    const big = "あ".repeat(TRANSCRIPT_LIMITS.maxTextChars);
    const entries = Array.from({ length: 200 }, (_, i) => user(`${i}:${big}`));
    const out = fitEntries(entries);
    const bytes = Buffer.byteLength(JSON.stringify(out), "utf-8");
    expect(bytes).toBeLessThan(TRANSCRIPT_LIMITS.maxBodyBytes);
    expect(out.length).toBeLessThan(200);
    expect(out.at(-1)).toEqual(entries.at(-1));
  });

  it("空は空", () => {
    expect(fitEntries([])).toEqual([]);
  });
});
