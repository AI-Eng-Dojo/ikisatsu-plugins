// 短期の記憶(セッションの要約)の型と、セッション開始時に注入する文面の組み立て。純関数のみ

export interface Digest {
  memberId: string;
  displayName: string | null;
  /** 先頭 1〜2 行: 今やっていること / 詰まっていること */
  headline: string;
  /** タスクの全体像 / 経緯 / 次の一手(Markdown) */
  body: string;
  /** ISO 8601 */
  updatedAt: string;
  isMine: boolean;
  /** 要約の元になったセッションのツールの表示名(サーバが付ける)。記録が無ければ null / 省略 */
  toolLabel?: string | null;
}

export const DIGEST_LIMITS = { headlineChars: 120, bodyChars: 1500 } as const;

export interface FormatOptions {
  /** 出力の最大文字数。超えるときは古い人から本文 → 人ごとの順に落とす */
  maxChars: number;
  /** 将来の相対表示用に受け取る。現状の出力には影響しない */
  now?: Date;
}

const TITLE = "## ikisatsu: このプロジェクトの作業状況(チームの短期の記憶)";
const INTRO =
  "以下は各メンバーの直近のセッションをクラウドで要約したもの。作業を再開するときは、まず自分の分を読むこと。";

/** ISO 8601 を `YYYY-MM-DD HH:mm UTC` に。解釈できなければ原文のまま */
function formatWhen(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return `${t.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function headingLine(d: Digest): string {
  const name = d.isMine ? "あなた" : (d.displayName ?? "メンバー");
  const tool = d.toolLabel ? `・${d.toolLabel}` : "";
  return `### ${name}(${formatWhen(d.updatedAt)} 更新${tool})— ${d.headline}`;
}

function section(d: Digest, withBody: boolean): string {
  return withBody && d.body !== "" ? `${headingLine(d)}\n${d.body}` : headingLine(d);
}

function assemble(sections: string[]): string {
  return [TITLE, INTRO, "", sections.join("\n\n")].join("\n");
}

/** 自分の分を先頭に、残りは updatedAt の新しい順。 */
function order(digests: readonly Digest[]): Digest[] {
  const byNewest = (a: Digest, b: Digest) =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
  return [
    ...digests.filter((d) => d.isMine).sort(byNewest),
    ...digests.filter((d) => !d.isMine).sort(byNewest),
  ];
}

/**
 * 0 件、または 1 人分の見出しすら maxChars に入らないときは空文字(呼び出し側は何も出力しない)。
 * 溢れたら、古い人(並びの後ろ)から本文を落とし(headline は残す)、それでも溢れたら古い人から丸ごと落とす。
 */
export function formatDigestsForInjection(
  digests: readonly Digest[],
  options: FormatOptions,
): string {
  const ordered = order(digests);
  if (ordered.length === 0) return "";

  const withBody = ordered.map(() => true);
  const build = (count: number) =>
    assemble(ordered.slice(0, count).map((d, i) => section(d, withBody[i] === true)));

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
