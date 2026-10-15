// 長期の記憶の画面の共有型。サーバ(図用 JSON を作る)と図のクライアントの両方が使う。
// ランタイム非依存の型と定数だけ。キー・セッション ID・member ID は、型にそもそもフィールドを作らない
import type { GraphEdgeKind, GraphNodeKind } from "./graph.ts";

/** 図に描く節点の種類(other は描かない) */
export type DrawnNodeKind = Exclude<GraphNodeKind, "other">;
export type DrawnEdgeKind = Exclude<GraphEdgeKind, "other">;
export const DRAWN_NODE_KINDS: readonly DrawnNodeKind[] = [
  "decision",
  "rule",
  "concept",
  "person",
  "issue",
  "file",
];

/** 表示用 ID の形(0006)。URL の検証とクライアントの検証に使う */
export const DISPLAY_ID_PATTERN = /^[0-9a-f]{32}$/;

/** パネルに出す本文の先頭の長さ(コードポイント) */
export const GRAPH_EXCERPT_CHARS = 120;

export interface GraphJsonNode {
  /** 表示用 ID */
  id: string;
  kind: DrawnNodeKind;
  name: string;
  /** 本文の先頭(GRAPH_EXCERPT_CHARS まで。切ったら末尾に「…」) */
  excerpt: string;
  superseded: boolean;
  /** いま注入されるもの。判定できなかったときは false で、injectionAvailable が false */
  injected: boolean;
  /** 描く辺(両端が描く節点の辺)の本数 */
  degree: number;
}

export interface GraphJsonEdge {
  /** 表示用 ID */
  source: string;
  /** 表示用 ID */
  target: string;
  kind: DrawnEdgeKind;
}

export interface GraphJson {
  nodes: GraphJsonNode[];
  edges: GraphJsonEdge[];
  /** 読む件数の上限に達した(一部しか描けていない) */
  truncated: boolean;
  /** 注入中の印を判定できた */
  injectionAvailable: boolean;
}
