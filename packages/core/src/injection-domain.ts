// SessionStart の注入に足す、長期の記憶(ルールと最近の決定)の型と文面の組み立て。純関数のみ

import { type Digest, type FormatOptions, formatDigestsForInjection } from "./digest.ts";

export interface InjectionRule {
  name: string;
  statement: string;
}

export interface InjectionDecision {
  name: string;
  rationale: string;
  /** ISO 8601 */
  decidedAt: string;
  displayName: string | null;
}

export interface InjectionDomain {
  /** 覆されていないルール。古い順(後ろほど新しい) */
  rules: InjectionRule[];
  /** 覆されていない決定。新しい順(後ろほど古い) */
  decisions: InjectionDecision[];
}

/** ルールと決定の欄に使ってよい上限の割合。残りと、使わなかった分は短期の記憶へ回す */
export const DOMAIN_INJECTION_SHARE = 0.4;

const TITLE = "## ikisatsu: このプロジェクトのルールと最近の決定(長期の記憶)";
const INTRO = "チームの会話から取り出したもの。ルールは守ること。覆されたものは除いてある。";

function formatDay(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : t.toISOString().slice(0, 10);
}

const ruleLine = (r: InjectionRule) => `- ${r.name}: ${r.statement}`;
const decisionLine = (d: InjectionDecision) =>
  `- ${formatDay(d.decidedAt)} ${d.name}(${d.displayName ?? "メンバー"})— ${d.rationale}`;

/**
 * ルールと最近の決定の欄。0 件、または見出しすら maxChars に入らないときは空文字。
 * 溢れたら、まず決定を古いものから落とし、次にルールを後ろ(新しいもの)から落として「他 N 件」の 1 行を足す。
 * 見出しは「### ルール」「### 最近の決定」(短期の記憶の人ごとの見出しの形と区別する)
 */
export function formatDomainBlock(domain: InjectionDomain, maxChars: number): string {
  const { rules, decisions } = domain;
  if (rules.length === 0 && decisions.length === 0) return "";

  const build = (ruleCount: number, decisionCount: number): string => {
    const lines = [TITLE, INTRO];
    const omitted = rules.length - ruleCount;
    if (ruleCount > 0 || omitted > 0) {
      lines.push("### ルール", ...rules.slice(0, ruleCount).map(ruleLine));
      if (omitted > 0) lines.push(`- (他 ${omitted} 件のルールはチームの記憶のページにある)`);
    }
    if (decisionCount > 0) {
      lines.push("### 最近の決定", ...decisions.slice(0, decisionCount).map(decisionLine));
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

/**
 * 短期の記憶の文面の後ろに、ルールと最近の決定の欄を別の節として足す。
 * domain が無い・空のときは formatDigestsForInjection と完全に同じ文字列
 */
export function formatInjection(
  digests: readonly Digest[],
  domain: InjectionDomain | null | undefined,
  options: FormatOptions,
): string {
  if (!domain) return formatDigestsForInjection(digests, options);
  const block = formatDomainBlock(domain, Math.floor(options.maxChars * DOMAIN_INJECTION_SHARE));
  if (block === "") return formatDigestsForInjection(digests, options);
  const rest = options.maxChars - block.length - 2;
  const digestsText = formatDigestsForInjection(digests, { ...options, maxChars: rest });
  return digestsText === "" ? block : `${digestsText}\n\n${block}`;
}
