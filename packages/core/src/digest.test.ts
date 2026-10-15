import { describe, expect, it } from "vitest";
import { DIGEST_LIMITS, type Digest, formatDigestsForInjection } from "./digest.ts";

function digest(over: Partial<Digest> = {}): Digest {
  return {
    memberId: "m1",
    displayName: "Niida",
    headline: "認証を実装中",
    body: "### タスクの全体像\n本文",
    updatedAt: "2026-09-29T14:05:00.000Z",
    isMine: false,
    ...over,
  };
}

const BIG = { maxChars: 100_000 };

describe("DIGEST_LIMITS", () => {
  it("設計書どおりの上限", () => {
    expect(DIGEST_LIMITS).toEqual({ headlineChars: 120, bodyChars: 1500 });
  });
});

describe("formatDigestsForInjection", () => {
  it("0 件なら空文字(フックは何も出力しない)", () => {
    expect(formatDigestsForInjection([], BIG)).toBe("");
  });

  it("見出し・説明・各人の節を設計書の書式で組み立てる(日時は UTC)", () => {
    const out = formatDigestsForInjection([digest({ isMine: true })], BIG);
    expect(out).toBe(
      [
        "## ikisatsu: このプロジェクトの作業状況(チームの短期の記憶)",
        "以下は各メンバーの直近のセッションをクラウドで要約したもの。作業を再開するときは、まず自分の分を読むこと。",
        "",
        "### あなた(2026-09-29 14:05 UTC 更新)— 認証を実装中",
        "### タスクの全体像\n本文",
      ].join("\n"),
    );
  });

  it("要約の元のツール名(toolLabel)があれば、更新日時の後ろに出す(C8)", () => {
    const out = formatDigestsForInjection([digest({ isMine: true, toolLabel: "Codex" })], BIG);
    expect(out).toContain("### あなた(2026-09-29 14:05 UTC 更新・Codex)— 認証を実装中");
  });

  it("toolLabel が null / 無いときは今までどおり", () => {
    const out = formatDigestsForInjection([digest({ toolLabel: null })], BIG);
    expect(out).toContain("### Niida(2026-09-29 14:05 UTC 更新)— 認証を実装中");
  });

  it("他人は表示名で出す。表示名が null なら「メンバー」", () => {
    const out = formatDigestsForInjection(
      [
        digest({ displayName: "Shingaki", memberId: "a" }),
        digest({ displayName: null, memberId: "b" }),
      ],
      BIG,
    );
    expect(out).toContain("### Shingaki(");
    expect(out).toContain("### メンバー(");
  });

  it("自分の分を先頭に、残りは新しい順", () => {
    const out = formatDigestsForInjection(
      [
        digest({ displayName: "古い", updatedAt: "2026-09-01T00:00:00.000Z", headline: "h-old" }),
        digest({ displayName: "自分", isMine: true, updatedAt: "2026-08-01T00:00:00.000Z" }),
        digest({ displayName: "新しい", updatedAt: "2026-09-20T00:00:00.000Z", headline: "h-new" }),
      ],
      BIG,
    );
    const order = [out.indexOf("### あなた"), out.indexOf("### 新しい"), out.indexOf("### 古い")];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("入力の配列を破壊しない", () => {
    const input = [
      digest({ updatedAt: "2026-09-01T00:00:00.000Z" }),
      digest({ updatedAt: "2026-09-20T00:00:00.000Z" }),
    ];
    const copy = JSON.parse(JSON.stringify(input));
    formatDigestsForInjection(input, BIG);
    expect(input).toEqual(copy);
  });

  it("解釈できない日時は原文のまま出す", () => {
    const out = formatDigestsForInjection([digest({ updatedAt: "不明" })], BIG);
    expect(out).toContain("(不明 更新)");
  });

  it("now は受け取れる(出力は変わらない)", () => {
    const a = formatDigestsForInjection([digest()], BIG);
    const b = formatDigestsForInjection([digest()], { ...BIG, now: new Date("2030-01-01") });
    expect(b).toBe(a);
  });

  describe("maxChars を超えるとき", () => {
    const mine = digest({
      isMine: true,
      displayName: "自分",
      headline: "mine-h",
      body: "mine-body-".repeat(10),
      updatedAt: "2026-09-29T00:00:00.000Z",
    });
    const mid = digest({
      displayName: "中",
      headline: "mid-h",
      body: "mid-body-".repeat(10),
      updatedAt: "2026-09-28T00:00:00.000Z",
    });
    const old = digest({
      displayName: "古",
      headline: "old-h",
      body: "old-body-".repeat(10),
      updatedAt: "2026-09-27T00:00:00.000Z",
    });
    const all = [old, mid, mine];
    const full = formatDigestsForInjection(all, BIG);

    it("収まるならそのまま", () => {
      expect(formatDigestsForInjection(all, { maxChars: full.length })).toBe(full);
    });

    it("1 文字でも溢れたら、いちばん古い人の本文から落とす(headline は残す)", () => {
      const out = formatDigestsForInjection(all, { maxChars: full.length - 1 });
      expect(out).toContain("old-h");
      expect(out).not.toContain("old-body-");
      expect(out).toContain("mid-body-");
      expect(out).toContain("mine-body-");
      expect(out.length).toBeLessThanOrEqual(full.length - 1);
    });

    it("それでも溢れたら次に古い人の本文も落とす。自分の本文は最後まで残す", () => {
      const noOld = formatDigestsForInjection(all, { maxChars: full.length - 1 });
      const out = formatDigestsForInjection(all, { maxChars: noOld.length - 1 });
      expect(out).not.toContain("mid-body-");
      expect(out).toContain("mid-h");
      expect(out).toContain("mine-body-");
    });

    it("本文を全員分落としても溢れるなら、古い人から丸ごと落とす", () => {
      const headOnly = formatDigestsForInjection(
        all.map((d) => ({ ...d, body: "" })),
        BIG,
      );
      const out = formatDigestsForInjection(all, { maxChars: headOnly.length - 1 });
      expect(out).not.toContain("old-h");
      expect(out).toContain("mid-h");
      expect(out).toContain("mine-h");
      expect(out).not.toContain("body-");
      expect(out.length).toBeLessThanOrEqual(headOnly.length - 1);
    });

    it("1 人分の見出しすら入らないなら空文字", () => {
      expect(formatDigestsForInjection(all, { maxChars: 10 })).toBe("");
    });

    it("自分の分が最後まで残る", () => {
      const out = formatDigestsForInjection(all, { maxChars: 200 });
      expect(out === "" || out.includes("### あなた")).toBe(true);
      expect(out.length).toBeLessThanOrEqual(200);
    });
  });
});
