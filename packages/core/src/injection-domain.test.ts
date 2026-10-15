import { describe, expect, it } from "vitest";
import { type Digest, formatDigestsForInjection } from "./digest.ts";
import {
  DOMAIN_INJECTION_SHARE,
  formatDomainBlock,
  formatInjection,
  type InjectionDecision,
  type InjectionDomain,
  type InjectionRule,
} from "./injection-domain.ts";

const digest: Digest = {
  memberId: "m1",
  displayName: "太郎",
  headline: "認証の実装中",
  body: "### タスクの全体像\nログインを作る",
  updatedAt: "2026-10-06T05:05:00.000Z",
  isMine: true,
};
const rule = (i: number, statement = `本文${i}`): InjectionRule => ({
  name: `ルール${i}`,
  statement,
});
const decision = (i: number, over: Partial<InjectionDecision> = {}): InjectionDecision => ({
  name: `決定${i}`,
  rationale: `理由${i}`,
  decidedAt: `2026-10-0${i}T12:00:00.000Z`,
  displayName: "花子",
  ...over,
});
const domain = (rules: InjectionRule[], decisions: InjectionDecision[]): InjectionDomain => ({
  rules,
  decisions,
});
const BIG = Number.MAX_SAFE_INTEGER;
// 短期の記憶の人ごとの見出し(injection-preview.ts の PERSON_HEADING と同じ形)
const PERSON_HEADING = /^### .+ 更新(?:・[^)]+)?\)— /gm;

describe("formatDomainBlock", () => {
  it("ルールは全件、決定は渡した順で出る", () => {
    const text = formatDomainBlock(domain([rule(1), rule(2)], [decision(3), decision(2)]), BIG);
    expect(text).toContain("## ikisatsu: このプロジェクトのルールと最近の決定(長期の記憶)");
    expect(text).toContain("### ルール\n- ルール1: 本文1\n- ルール2: 本文2");
    expect(text).toContain(
      "### 最近の決定\n- 2026-10-03 決定3(花子)— 理由3\n- 2026-10-02 決定2(花子)— 理由2",
    );
  });

  it("決めた人が分からない決定は「メンバー」と書く", () => {
    const text = formatDomainBlock(domain([], [decision(1, { displayName: null })]), BIG);
    expect(text).toContain("(メンバー)");
    expect(text).not.toContain("### ルール");
  });

  it("日時が解釈できなければ原文のまま出す", () => {
    const text = formatDomainBlock(domain([], [decision(1, { decidedAt: "いつか" })]), BIG);
    expect(text).toContain("- いつか 決定1");
  });

  it("ルールも決定も 0 件なら空文字", () => {
    expect(formatDomainBlock(domain([], []), BIG)).toBe("");
  });

  it("上限の大きさに収まる", () => {
    const d = domain(
      Array.from({ length: 10 }, (_, i) => rule(i, "あ".repeat(50))),
      [decision(1), decision(2)],
    );
    const full = formatDomainBlock(d, BIG);
    for (const max of [full.length, full.length - 1, 400, 250]) {
      expect(formatDomainBlock(d, max).length).toBeLessThanOrEqual(max);
    }
  });

  it("溢れると決定を古いものから先に落とす", () => {
    const d = domain([rule(1)], [decision(3), decision(2), decision(1)]);
    const full = formatDomainBlock(d, BIG);
    const text = formatDomainBlock(d, full.length - 1);
    expect(text).toContain("決定3");
    expect(text).toContain("決定2");
    expect(text).not.toContain("決定1");
    expect(text).toContain("- ルール1: 本文1");
    expect(text).not.toContain("他");
  });

  it("決定をすべて落としてもまだ溢れるなら、ルールを後ろ(新しいもの)から落として「他 N 件」を足す", () => {
    const long = "あ".repeat(100);
    const d = domain([rule(1, long), rule(2, long), rule(3, long)], [decision(1)]);
    const withoutDecisions = formatDomainBlock(domain(d.rules, []), BIG);
    const text = formatDomainBlock(d, withoutDecisions.length - 1);
    expect(text).not.toContain("### 最近の決定");
    expect(text).toContain("- ルール1: ");
    expect(text).not.toContain("- ルール3:");
    expect(text).toMatch(/- \(他 \d+ 件のルールはチームの記憶のページにある\)$/);
    expect(text.length).toBeLessThanOrEqual(withoutDecisions.length - 1);
  });

  it("ルールを 1 件も入れられないときは、見出しと「他 N 件」だけが出る", () => {
    const d = domain([rule(1, "あ".repeat(300))], []);
    const text = formatDomainBlock(d, 200);
    expect(text).toContain("### ルール\n- (他 1 件のルールはチームの記憶のページにある)");
  });

  it("見出しすら入らなければ空文字", () => {
    expect(formatDomainBlock(domain([rule(1)], [decision(1)]), 10)).toBe("");
  });

  it("決定だけのときは「### ルール」を出さない", () => {
    expect(formatDomainBlock(domain([], [decision(1)]), BIG)).not.toContain("### ルール");
  });
});

describe("formatInjection", () => {
  it("domain が無い・null・空なら formatDigestsForInjection と完全に同じ文字列", () => {
    const expected = formatDigestsForInjection([digest], { maxChars: 8000 });
    expect(formatInjection([digest], undefined, { maxChars: 8000 })).toBe(expected);
    expect(formatInjection([digest], null, { maxChars: 8000 })).toBe(expected);
    expect(formatInjection([digest], domain([], []), { maxChars: 8000 })).toBe(expected);
  });

  it("短期の記憶の後ろに、ルールと決定が別の節として付く", () => {
    const text = formatInjection([digest], domain([rule(1)], [decision(1)]), { maxChars: 8000 });
    const digestsText = formatDigestsForInjection([digest], { maxChars: 8000 });
    expect(
      text.startsWith(`${digestsText}\n\n## ikisatsu: このプロジェクトのルールと最近の決定`),
    ).toBe(true);
    expect(text).toContain("- ルール1: 本文1");
  });

  it("digests が 0 件なら、ルールと決定の欄だけが出る", () => {
    const text = formatInjection([], domain([rule(1)], [decision(1)]), { maxChars: 8000 });
    expect(text.startsWith("## ikisatsu: このプロジェクトのルールと最近の決定")).toBe(true);
    expect(text).not.toContain("チームの短期の記憶");
  });

  it("digests も domain も空なら空文字", () => {
    expect(formatInjection([], domain([], []), { maxChars: 8000 })).toBe("");
  });

  it("ルールと決定の欄は上限の 4 割以内で、全体も上限に収まる", () => {
    const d = domain(
      Array.from({ length: 40 }, (_, i) => rule(i, "あ".repeat(60))),
      [decision(1), decision(2)],
    );
    const max = 4000;
    const block = formatDomainBlock(d, Math.floor(max * DOMAIN_INJECTION_SHARE));
    expect(block.length).toBeLessThanOrEqual(1600);
    const text = formatInjection([digest], d, { maxChars: max });
    expect(text.length).toBeLessThanOrEqual(max);
    expect(text).toContain("他");
  });

  it("使わなかった分は短期の記憶に回る(ルールが少なければ、短期の記憶が 6 割より多く使える)", () => {
    const longDigest = { ...digest, body: "い".repeat(1500) };
    const text = formatInjection([longDigest], domain([rule(1)], []), { maxChars: 2000 });
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toContain("い".repeat(1500));
  });

  it("短期の記憶が入らないほど小さい上限でも、全体は上限を超えない", () => {
    const text = formatInjection([digest], domain([rule(1)], []), { maxChars: 150 });
    expect(text.length).toBeLessThanOrEqual(150);
  });

  it("ルールと決定の見出しは、人数を数える正規表現に当たらない", () => {
    const text = formatInjection([], domain([rule(1)], [decision(1)]), { maxChars: 8000 });
    expect(text.match(PERSON_HEADING)).toBeNull();
    const withDigest = formatInjection([digest], domain([rule(1)], [decision(1)]), {
      maxChars: 8000,
    });
    expect(withDigest.match(PERSON_HEADING)).toHaveLength(1);
  });
});
