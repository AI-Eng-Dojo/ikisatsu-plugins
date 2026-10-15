// 長期の記憶のグラフの語彙。ツール非依存(サーバと手元のフックが共有する)

export const GRAPH_NODE_KINDS = [
  "decision",
  "person",
  "issue",
  "file",
  "concept",
  "rule",
  "other",
] as const;
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

export const GRAPH_EDGE_KINDS = [
  "decided",
  "relates_to",
  "produces",
  "supersedes",
  "is_a",
  "part_of",
  "depends_on",
  "constrains",
  "synonym",
  "other",
] as const;
export type GraphEdgeKind = (typeof GRAPH_EDGE_KINDS)[number];

export const GRAPH_NODE_LABELS: Record<GraphNodeKind, string> = {
  decision: "決定",
  person: "人",
  issue: "issue",
  file: "ファイル",
  concept: "概念",
  rule: "ルール",
  other: "その他",
};

export const GRAPH_EDGE_LABELS: Record<GraphEdgeKind, string> = {
  decided: "決めた",
  relates_to: "関係する",
  produces: "生む",
  supersedes: "覆す",
  is_a: "〜の一種",
  part_of: "〜の一部",
  depends_on: "依存する",
  constrains: "制約する",
  synonym: "同義",
  other: "その他",
};

export const GRAPH_LIMITS = {
  /** 節点の名前(決定の名前・概念・ルール名) */
  nameChars: 80,
  /** 決定の理由・概念の定義・ルールの本文 */
  descriptionChars: 400,
  /** other のラベル */
  labelChars: 40,
  maxDecisions: 20,
  maxConcepts: 40,
  maxRules: 30,
  maxOthers: 20,
  maxEdges: 150,
} as const;

/** 同一性のキー: NFKC → 前後の空白を除く → 連続空白を 1 つに → 小文字。空なら "" */
export function normalizeGraphKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
