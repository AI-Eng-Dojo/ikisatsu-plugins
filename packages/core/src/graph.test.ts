import { describe, expect, it } from "vitest";
import {
  GRAPH_EDGE_KINDS,
  GRAPH_EDGE_LABELS,
  GRAPH_NODE_KINDS,
  GRAPH_NODE_LABELS,
  normalizeGraphKey,
} from "./graph.ts";

describe("normalizeGraphKey", () => {
  it("全角英数を半角にそろえる", () => {
    expect(normalizeGraphKey("ＡＢＣ１２３")).toBe("abc123");
  });
  it("連続する空白(全角を含む)を 1 つにし、前後を除く", () => {
    expect(normalizeGraphKey("  foo \t\n  bar　baz  ")).toBe("foo bar baz");
  });
  it("大文字を小文字にする", () => {
    expect(normalizeGraphKey("Short-Term Memory")).toBe("short-term memory");
  });
  it("空文字・空白だけなら空文字を返す", () => {
    expect(normalizeGraphKey("")).toBe("");
    expect(normalizeGraphKey("  　 ")).toBe("");
  });
  it("日本語はそのまま残る", () => {
    expect(normalizeGraphKey(" 長期の記憶 ")).toBe("長期の記憶");
  });
});

describe("グラフの語彙", () => {
  it("すべての種類に日本語ラベルがある", () => {
    for (const k of GRAPH_NODE_KINDS) expect(GRAPH_NODE_LABELS[k]).not.toBe("");
    for (const k of GRAPH_EDGE_KINDS) expect(GRAPH_EDGE_LABELS[k]).not.toBe("");
  });
});
