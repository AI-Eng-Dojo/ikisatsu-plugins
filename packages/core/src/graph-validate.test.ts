import { describe, expect, it } from "vitest";
import { GRAPH_LIMITS } from "./graph.ts";
import {
  type GraphCandidates,
  type GraphDraft,
  type ValidatedGraph,
  validateGraphDraft,
} from "./graph-validate.ts";

const emptyDraft: GraphDraft = { decisions: [], concepts: [], rules: [], others: [], edges: [] };
const baseCandidates: GraphCandidates = {
  files: ["apps/server/migrations/0005_graph.sql", "src/a b.ts"],
  issues: ["#89"],
  concepts: [
    { key: "短期の記憶", name: "短期の記憶", aliases: [{ key: "digest", name: "digest" }] },
    { key: "チーム", name: "チーム", aliases: [] },
  ],
  rules: [{ key: "生の会話は本人だけが読める", name: "生の会話は本人だけが読める" }],
  decisions: [
    { ref: "D1", key: "old-sess:機械的な節点はフックが作る", name: "機械的な節点はフックが作る" },
  ],
  sender: { key: "member-1", name: "けい" },
};
const OPTS = { decisionKeyPrefix: "sess-1" };

const draft = (p: Partial<GraphDraft>): GraphDraft => ({ ...emptyDraft, ...p });
const edge = (
  kind: GraphDraft["edges"][number]["kind"],
  from: GraphDraft["edges"][number]["from"],
  to: GraphDraft["edges"][number]["to"],
  label = "",
): GraphDraft["edges"][number] => ({ kind, from, to, label });
const dec = (name: string) => ({ kind: "decision" as const, name });
const con = (name: string) => ({ kind: "concept" as const, name });
const rul = (name: string) => ({ kind: "rule" as const, name });
const iss = (name: string) => ({ kind: "issue" as const, name });
const fil = (name: string) => ({ kind: "file" as const, name });

const run = (d: GraphDraft, c: Partial<GraphCandidates> = {}): ValidatedGraph =>
  validateGraphDraft(d, { ...baseCandidates, ...c }, OPTS);

describe("validateGraphDraft: 節点", () => {
  it("名前・本文・ラベルは前後の空白を除き、字数で切る(コードポイント単位)", () => {
    const longName = `  ${"あ".repeat(GRAPH_LIMITS.nameChars + 5)}  `;
    const longBody = "😀".repeat(GRAPH_LIMITS.descriptionChars + 3);
    const out = run(
      draft({
        decisions: [{ name: longName, rationale: longBody }],
        others: [{ label: "い".repeat(50), name: "x", description: "" }],
      }),
    );
    expect([...(out.decisions[0]?.name ?? "")]).toHaveLength(GRAPH_LIMITS.nameChars);
    expect([...(out.decisions[0]?.description ?? "")]).toHaveLength(GRAPH_LIMITS.descriptionChars);
    expect([...(out.others[0]?.label ?? "")]).toHaveLength(GRAPH_LIMITS.labelChars);
  });

  it("キーが空になる節点は捨て、dropped.nodes に数える", () => {
    const out = run(
      draft({
        decisions: [{ name: "  ", rationale: "r" }],
        concepts: [{ name: "", definition: "d" }],
        rules: [{ name: " ", statement: "s", scope: "project", reason: "" }],
        others: [
          { label: "", name: "x", description: "" },
          { label: "x", name: "", description: "" },
        ],
      }),
    );
    expect(out.decisions).toEqual([]);
    expect(out.concepts).toEqual([]);
    expect(out.rules).toEqual([]);
    expect(out.others).toEqual([]);
    expect(out.dropped.nodes).toBe(5);
  });

  it("同じ種類で同じキーの節点は、最初のものだけを使う(数えない)", () => {
    const out = run(
      draft({
        decisions: [
          { name: "ＡＢ を決める", rationale: "1" },
          { name: "ab を決める", rationale: "2" },
        ],
        concepts: [
          { name: "Foo", definition: "first" },
          { name: "foo", definition: "second" },
        ],
        rules: [
          { name: "R", statement: "first", scope: "project", reason: "" },
          { name: "r", statement: "second", scope: "project", reason: "" },
        ],
        others: [
          { label: "L", name: "N", description: "first" },
          { label: "l", name: "n", description: "second" },
        ],
      }),
    );
    expect(out.decisions.map((d) => d.description)).toEqual(["1"]);
    expect(out.concepts.map((c) => c.description)).toEqual(["first"]);
    expect(out.rules.map((r) => r.description)).toEqual(["first"]);
    expect(out.others.map((o) => o.description)).toEqual(["first"]);
    expect(out.dropped.nodes).toBe(0);
  });

  it("件数の上限を超えた節点は捨て、dropped.nodes に数える", () => {
    const limits = {
      ...GRAPH_LIMITS,
      maxDecisions: 1,
      maxConcepts: 1,
      maxRules: 1,
      maxOthers: 1,
    };
    const out = validateGraphDraft(
      draft({
        decisions: [
          { name: "d1", rationale: "" },
          { name: "d2", rationale: "" },
        ],
        concepts: [
          { name: "c1", definition: "" },
          { name: "c2", definition: "" },
        ],
        rules: [
          { name: "r1", statement: "", scope: "project", reason: "" },
          { name: "r2", statement: "", scope: "project", reason: "" },
        ],
        others: [
          { label: "l", name: "o1", description: "" },
          { label: "l", name: "o2", description: "" },
        ],
      }),
      baseCandidates,
      { ...OPTS, limits },
    );
    expect(out.decisions).toHaveLength(1);
    expect(out.concepts).toHaveLength(1);
    expect(out.rules).toHaveLength(1);
    expect(out.others).toHaveLength(1);
    expect(out.dropped.nodes).toBe(4);
  });

  it("決定のキーは「セッション ID:正規化した名前」、本文は rationale", () => {
    const out = run(draft({ decisions: [{ name: " Ｘ を使う ", rationale: "理由" }] }));
    expect(out.decisions).toEqual([
      { key: "sess-1:x を使う", name: "Ｘ を使う", description: "理由" },
    ]);
  });

  it("other のキーは「ラベル:名前」(正規化)", () => {
    const out = run(
      draft({ others: [{ label: "マイルストーン", name: "２周目", description: "d" }] }),
    );
    expect(out.others[0]?.key).toBe("マイルストーン:2周目");
  });
});

describe("validateGraphDraft: 個人のルール(S15)", () => {
  const personal = {
    name: "毎朝 main を pull する",
    statement: "s",
    scope: "personal" as const,
    reason: "個人の習慣",
  };

  it("personal のルールは捨てて数える。project のルールは残る", () => {
    const out = run(
      draft({
        rules: [personal, { name: "チームのルール", statement: "s", scope: "project", reason: "" }],
      }),
    );
    expect(out.rules.map((r) => r.name)).toEqual(["チームのルール"]);
    expect(out.dropped.personalRules).toBe(1);
  });

  it("個人のルールを端に持つ辺は、既存のルールと同じキーでも捨てる", () => {
    const out = run(
      draft({
        rules: [{ ...personal, name: "生の会話は本人だけが読める" }],
        edges: [edge("constrains", rul("生の会話は本人だけが読める"), con("チーム"))],
      }),
    );
    expect(out.edges).toEqual([]);
    expect(out.dropped.edges).toBe(1);
    expect(out.dropped.personalRules).toBe(1);
  });

  it("個人のルールを to に持つ辺(覆す)も捨てる", () => {
    const out = run(
      draft({
        rules: [personal, { name: "新ルール", statement: "s", scope: "project", reason: "" }],
        edges: [edge("supersedes", rul("新ルール"), rul(personal.name))],
      }),
    );
    expect(out.edges).toEqual([]);
    expect(out.dropped.edges).toBe(1);
  });
});

describe("validateGraphDraft: 辺の両端の解決(S17)", () => {
  it("決定(from)は draft の決定だけ。既存の決定の名前を from に書いても捨てる", () => {
    const out = run(
      draft({
        decisions: [{ name: "新しい決定", rationale: "" }],
        edges: [
          edge("relates_to", dec("機械的な節点はフックが作る"), iss("#89")),
          edge("relates_to", dec("新しい決定"), iss("#89")),
        ],
      }),
    );
    expect(out.edges.filter((e) => e.kind === "relates_to")).toHaveLength(1);
    expect(out.dropped.edges).toBe(1);
  });

  it("決定(to)は draft の決定か D 番号。既存の決定の名前を直接書いたものは解決しない", () => {
    const out = run(
      draft({
        decisions: [
          { name: "新しい決定", rationale: "" },
          { name: "別の決定", rationale: "" },
        ],
        edges: [
          edge("supersedes", dec("新しい決定"), dec("D1")),
          edge("supersedes", dec("新しい決定"), dec("機械的な節点はフックが作る")),
          edge("supersedes", dec("新しい決定"), dec("D9")),
          edge("supersedes", dec("別の決定"), dec("新しい決定")),
        ],
      }),
    );
    const sup = out.edges.filter((e) => e.kind === "supersedes");
    expect(sup).toHaveLength(2);
    expect(sup[0]).toMatchObject({
      toKind: "decision",
      toKey: "old-sess:機械的な節点はフックが作る",
      toName: "機械的な節点はフックが作る",
    });
    expect(out.dropped.edges).toBe(2);
  });

  it("概念は draft か既存。別名は正の概念に読み替え、toName は正の名前になる", () => {
    const out = run(
      draft({
        decisions: [{ name: "d", rationale: "" }],
        concepts: [{ name: "新概念", definition: "" }],
        edges: [
          edge("relates_to", dec("d"), con("DIGEST")),
          edge("relates_to", dec("d"), con("チーム")),
          edge("relates_to", dec("d"), con("新概念")),
          edge("relates_to", dec("d"), con("存在しない")),
        ],
      }),
    );
    const rel = out.edges.filter((e) => e.kind === "relates_to");
    expect(rel.map((e) => [e.toKey, e.toName])).toEqual([
      ["短期の記憶", "短期の記憶"],
      ["チーム", "チーム"],
      ["新概念", "新概念"],
    ]);
    expect(out.dropped.edges).toBe(1);
  });

  it("synonym の from だけは読み替えない(別名の節点そのもの)。to は正に読み替える", () => {
    const out = run(
      draft({
        concepts: [
          { name: "ダイジェスト", definition: "" },
          { name: "digest", definition: "" },
        ],
        edges: [
          edge("synonym", con("ダイジェスト"), con("digest")),
          edge("synonym", con("digest"), con("短期の記憶")),
        ],
      }),
    );
    const syn = out.edges.filter((e) => e.kind === "synonym");
    expect(syn.map((e) => [e.fromKey, e.toKey])).toEqual([
      ["ダイジェスト", "短期の記憶"],
      ["digest", "短期の記憶"],
    ]);
  });

  it("synonym の from に既存の別名・正の名前が書かれても節点そのものを指す", () => {
    const out = run(
      draft({
        edges: [
          edge("synonym", con("digest"), con("チーム")),
          edge("synonym", con("チーム"), con("短期の記憶")),
        ],
      }),
    );
    expect(out.edges.map((e) => e.fromKey)).toEqual(["digest", "チーム"]);
  });

  it("ルールは draft の project ルールか既存のルール", () => {
    const out = run(
      draft({
        decisions: [{ name: "d", rationale: "" }],
        rules: [{ name: "新ルール", statement: "s", scope: "project", reason: "" }],
        edges: [
          edge("produces", dec("d"), rul("新ルール")),
          edge("produces", dec("d"), rul("生の会話は本人だけが読める")),
          edge("produces", dec("d"), rul("無いルール")),
        ],
      }),
    );
    expect(out.edges.filter((e) => e.kind === "produces")).toHaveLength(2);
    expect(out.dropped.edges).toBe(1);
  });

  it("issue は #N に正規化して候補にあるものだけ。mechanical に入る", () => {
    const out = run(
      draft({
        decisions: [{ name: "d", rationale: "" }],
        edges: [
          edge("relates_to", dec("d"), iss("89")),
          edge("relates_to", dec("d"), iss("#0089")),
          edge("relates_to", dec("d"), iss("#123")),
          edge("relates_to", dec("d"), iss("abc")),
        ],
      }),
    );
    expect(out.edges.filter((e) => e.kind === "relates_to")).toHaveLength(1);
    expect(out.mechanical).toEqual([{ kind: "issue", key: "#89", name: "#89" }]);
    expect(out.dropped.edges).toBe(2);
  });

  it("file は前後の空白と先頭の ./ を除いて、候補に完全一致するものだけ", () => {
    const out = run(
      draft({
        decisions: [{ name: "d", rationale: "" }],
        edges: [
          edge("relates_to", dec("d"), fil(" ./apps/server/migrations/0005_graph.sql ")),
          edge("relates_to", dec("d"), fil("apps/server/migrations/0005_GRAPH.sql")),
          edge("relates_to", dec("d"), fil("apps/server/src/secret.ts")),
        ],
      }),
    );
    expect(out.edges.filter((e) => e.kind === "relates_to")).toHaveLength(1);
    expect(out.mechanical).toEqual([
      {
        kind: "file",
        key: "apps/server/migrations/0005_graph.sql",
        name: "apps/server/migrations/0005_graph.sql",
      },
    ]);
    expect(out.dropped.edges).toBe(2);
  });

  it("mechanical は最終的に残った辺の先だけ(重複しない)", () => {
    const out = run(
      draft({
        decisions: [
          { name: "d", rationale: "" },
          { name: "e", rationale: "" },
        ],
        edges: [
          edge("relates_to", dec("d"), iss("#89")),
          edge("relates_to", dec("e"), iss("#89")),
          edge("relates_to", dec("d"), fil("secret.ts")),
        ],
      }),
    );
    expect(out.mechanical).toEqual([{ kind: "issue", key: "#89", name: "#89" }]);
  });

  it("知らない端の種類・知らない辺の種類は捨てる", () => {
    const bad = draft({
      decisions: [{ name: "d", rationale: "" }],
      edges: [
        {
          kind: "relates_to",
          from: { kind: "person" as never, name: "x" },
          to: iss("#89"),
          label: "",
        },
        { kind: "nonsense" as never, from: dec("d"), to: iss("#89"), label: "" },
        { kind: "decided" as never, from: dec("d"), to: iss("#89"), label: "" },
      ],
    });
    const out = run(bad);
    expect(out.edges.filter((e) => e.kind !== "decided" || e.fromKind !== "person")).toEqual([]);
    expect(out.dropped.edges).toBe(3);
  });
});

describe("validateGraphDraft: 長い名前を指す辺", () => {
  it("nameChars を超える名前の節点を指す辺は、切り詰め後の節点に解決される", () => {
    const longName = "あ".repeat(GRAPH_LIMITS.nameChars + 1);
    const out = run(
      draft({
        decisions: [{ name: longName, rationale: "" }],
        concepts: [{ name: longName, definition: "" }],
        rules: [{ name: longName, statement: "", scope: "project", reason: "" }],
        edges: [
          edge("relates_to", dec(longName), con(longName)),
          edge("produces", dec(longName), rul(longName)),
          edge("constrains", rul(longName), con(longName)),
        ],
      }),
    );
    expect(out.edges.filter((e) => e.kind !== "decided")).toHaveLength(3);
    expect(out.dropped.edges).toBe(0);
  });
});

describe("validateGraphDraft: 辺の向きの表(S18)", () => {
  const draftWithAll = (): GraphDraft =>
    draft({
      decisions: [
        { name: "d1", rationale: "" },
        { name: "d2", rationale: "" },
      ],
      concepts: [
        { name: "c1", definition: "" },
        { name: "c2", definition: "" },
      ],
      rules: [
        { name: "r1", statement: "", scope: "project", reason: "" },
        { name: "r2", statement: "", scope: "project", reason: "" },
      ],
    });
  const kinds = (d: GraphDraft) => run(d).edges.filter((e) => e.kind !== "decided");

  it("表のとおりの向きは通る", () => {
    const d = draftWithAll();
    d.edges = [
      edge("relates_to", dec("d1"), con("c1")),
      edge("relates_to", dec("d1"), iss("#89")),
      edge("relates_to", dec("d1"), fil("src/a b.ts")),
      edge("produces", dec("d1"), rul("r1")),
      edge("supersedes", dec("d1"), dec("d2")),
      edge("supersedes", rul("r1"), rul("r2")),
      edge("is_a", con("c1"), con("c2")),
      edge("part_of", con("c1"), con("c2")),
      edge("depends_on", con("c1"), con("c2")),
      edge("synonym", con("c1"), con("c2")),
      edge("constrains", rul("r1"), con("c1")),
      edge("other", dec("d1"), con("c1"), "動機"),
      edge("other", con("c1"), rul("r1"), "例外"),
    ];
    expect(kinds(d)).toHaveLength(13);
  });

  it("表に無い向きは捨てる", () => {
    const d = draftWithAll();
    d.edges = [
      edge("relates_to", con("c1"), dec("d1")),
      edge("relates_to", dec("d1"), rul("r1")),
      edge("produces", dec("d1"), con("c1")),
      edge("produces", rul("r1"), dec("d1")),
      edge("supersedes", dec("d1"), rul("r1")),
      edge("supersedes", con("c1"), con("c2")),
      edge("is_a", dec("d1"), con("c1")),
      edge("depends_on", con("c1"), rul("r1")),
      edge("constrains", con("c1"), rul("r1")),
      edge("constrains", rul("r1"), dec("d1")),
      edge("synonym", rul("r1"), con("c1")),
      edge("part_of", con("c1"), iss("#89")),
    ];
    const out = run(d);
    expect(out.edges.filter((e) => e.kind !== "decided")).toEqual([]);
    expect(out.dropped.edges).toBe(12);
  });

  it("自分自身へ向かう辺は捨てる", () => {
    const d = draftWithAll();
    d.edges = [edge("is_a", con("c1"), con("c1")), edge("supersedes", dec("d1"), dec("d1"))];
    expect(kinds(d)).toEqual([]);
    expect(run(d).dropped.edges).toBe(2);
  });

  it("other でラベルが空の辺は捨てる。other 以外のラベルは空にする", () => {
    const d = draftWithAll();
    d.edges = [
      edge("other", dec("d1"), con("c1"), "  "),
      edge("is_a", con("c1"), con("c2"), "余計なラベル"),
    ];
    const out = kinds(d);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "is_a", label: "" });
  });

  it("other のラベルは字数で切る", () => {
    const d = draftWithAll();
    d.edges = [edge("other", dec("d1"), con("c1"), "あ".repeat(60))];
    expect([...(kinds(d)[0]?.label ?? "")]).toHaveLength(GRAPH_LIMITS.labelChars);
  });
});

describe("validateGraphDraft: 重複と上限", () => {
  it("同じ辺は 1 本にする(捨てた数には数えない)", () => {
    const d = draft({
      concepts: [
        { name: "c1", definition: "" },
        { name: "c2", definition: "" },
      ],
      edges: [edge("is_a", con("c1"), con("c2")), edge("is_a", con("C1"), con("c2"))],
    });
    const out = run(d);
    expect(out.edges).toHaveLength(1);
    expect(out.dropped.edges).toBe(0);
  });

  it("ラベルの違う other は別の辺", () => {
    const d = draft({
      concepts: [
        { name: "c1", definition: "" },
        { name: "c2", definition: "" },
      ],
      edges: [edge("other", con("c1"), con("c2"), "a"), edge("other", con("c1"), con("c2"), "b")],
    });
    expect(run(d).edges).toHaveLength(2);
  });

  it("maxEdges を超えた分は捨てて数える。decided の辺は上限に数えない", () => {
    const limits = { ...GRAPH_LIMITS, maxEdges: 2 };
    const d = draft({
      decisions: [
        { name: "d1", rationale: "" },
        { name: "d2", rationale: "" },
        { name: "d3", rationale: "" },
      ],
      concepts: [
        { name: "c1", definition: "" },
        { name: "c2", definition: "" },
        { name: "c3", definition: "" },
        { name: "c4", definition: "" },
      ],
      edges: [
        edge("is_a", con("c1"), con("c2")),
        edge("is_a", con("c2"), con("c3")),
        edge("is_a", con("c3"), con("c4")),
        edge("is_a", con("c4"), con("c1")),
      ],
    });
    const out = validateGraphDraft(d, baseCandidates, { ...OPTS, limits });
    expect(out.edges.filter((e) => e.kind === "is_a")).toHaveLength(2);
    expect(out.edges.filter((e) => e.kind === "decided")).toHaveLength(3);
    expect(out.dropped.edges).toBe(2);
  });
});

describe("validateGraphDraft: 決めた(人 → 決定)", () => {
  it("sender があり決定が 1 件以上あれば、person と decided の辺を足す", () => {
    const out = run(
      draft({
        decisions: [
          { name: "a", rationale: "" },
          { name: "b", rationale: "" },
        ],
      }),
    );
    expect(out.person).toEqual({ key: "member-1", name: "けい" });
    expect(out.edges).toEqual([
      {
        kind: "decided",
        fromKind: "person",
        fromKey: "member-1",
        toKind: "decision",
        toKey: "sess-1:a",
        toName: "a",
        label: "",
      },
      {
        kind: "decided",
        fromKind: "person",
        fromKey: "member-1",
        toKind: "decision",
        toKey: "sess-1:b",
        toName: "b",
        label: "",
      },
    ]);
  });

  it("決定が無ければ person も作らない", () => {
    const out = run(draft({ concepts: [{ name: "c", definition: "" }] }));
    expect(out.person).toBeNull();
    expect(out.edges).toEqual([]);
  });

  it("sender が null なら person も decided も無い", () => {
    const out = run(draft({ decisions: [{ name: "a", rationale: "" }] }), { sender: null });
    expect(out.person).toBeNull();
    expect(out.edges).toEqual([]);
  });
});

describe("validateGraphDraft: 既定の上限と空の入力", () => {
  it("limits を省略すると GRAPH_LIMITS を使う", () => {
    const many = Array.from({ length: GRAPH_LIMITS.maxDecisions + 3 }, (_, i) => ({
      name: `決定${i}`,
      rationale: "",
    }));
    const out = run(draft({ decisions: many }));
    expect(out.decisions).toHaveLength(GRAPH_LIMITS.maxDecisions);
    expect(out.dropped.nodes).toBe(3);
  });

  it("何も無い下書きは何も作らない", () => {
    const out = run(emptyDraft);
    expect(out).toMatchObject({
      person: null,
      mechanical: [],
      decisions: [],
      concepts: [],
      rules: [],
      others: [],
      edges: [],
      dropped: { edges: 0, personalRules: 0, nodes: 0 },
    });
  });
});
