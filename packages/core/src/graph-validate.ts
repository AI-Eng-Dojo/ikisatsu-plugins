// AI が出した長期の記憶の下書きを、候補と向きの表に照らして確かめる純関数(#90、S15 / S17 / S18)。
// 候補に無い先の辺と、個人のルールはここで捨てる。ツール非依存・ランタイム非依存
import {
  GRAPH_EDGE_KINDS,
  GRAPH_LIMITS,
  type GraphEdgeKind,
  type GraphNodeKind,
  normalizeGraphKey,
} from "./graph.ts";

export type GraphDraftEdgeKind = Exclude<GraphEdgeKind, "decided">;

export interface GraphDraft {
  decisions: Array<{ name: string; rationale: string }>;
  concepts: Array<{ name: string; definition: string }>;
  rules: Array<{
    name: string;
    statement: string;
    scope: "project" | "personal";
    reason: string;
  }>;
  others: Array<{ label: string; name: string; description: string }>;
  edges: Array<{
    kind: GraphDraftEdgeKind;
    from: { kind: "decision" | "concept" | "rule"; name: string };
    to: { kind: "decision" | "issue" | "file" | "concept" | "rule"; name: string };
    label: string;
  }>;
}

export interface GraphCandidates {
  files: readonly string[];
  issues: readonly string[];
  concepts: readonly {
    key: string;
    name: string;
    aliases: readonly { key: string; name: string }[];
  }[];
  rules: readonly { key: string; name: string }[];
  /** 覆す先にだけ使える */
  decisions: readonly { ref: string; key: string; name: string }[];
  /** key = memberId */
  sender: { key: string; name: string } | null;
}

export interface ValidatedGraph {
  person: { key: string; name: string } | null;
  mechanical: Array<{ kind: "issue" | "file"; key: string; name: string }>;
  decisions: Array<{ key: string; name: string; description: string }>;
  concepts: Array<{ key: string; name: string; description: string }>;
  rules: Array<{ key: string; name: string; description: string }>;
  others: Array<{ key: string; label: string; name: string; description: string }>;
  edges: Array<{
    kind: GraphEdgeKind;
    fromKind: GraphNodeKind;
    fromKey: string;
    toKind: GraphNodeKind;
    toKey: string;
    toName: string;
    label: string;
  }>;
  dropped: { edges: number; personalRules: number; nodes: number };
}

interface Ref {
  kind: GraphNodeKind;
  key: string;
  name: string;
}
type ValidEdge = ValidatedGraph["edges"][number];

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  const chars = [...trimmed];
  return chars.length <= max ? trimmed : chars.slice(0, max).join("");
}

/** 辺の向きの表(S18)。DB の CHECK・プロンプトと同じもの */
function isAllowedDirection(kind: string, from: GraphNodeKind, to: GraphNodeKind): boolean {
  switch (kind) {
    case "relates_to":
      return from === "decision" && (to === "issue" || to === "file" || to === "concept");
    case "produces":
      return from === "decision" && to === "rule";
    case "supersedes":
      return (from === "decision" && to === "decision") || (from === "rule" && to === "rule");
    case "is_a":
    case "part_of":
    case "depends_on":
    case "synonym":
      return from === "concept" && to === "concept";
    case "constrains":
      return from === "rule" && to === "concept";
    case "other":
      return from !== "other" && to !== "other";
    default:
      return false;
  }
}

function normalizeIssue(name: string): string | null {
  const m = /^#?0*(\d{1,6})$/.exec(name.trim());
  return m ? `#${m[1]}` : null;
}

function normalizeFilePath(name: string): string {
  return name.trim().replace(/^\.\//, "");
}

export function validateGraphDraft(
  draft: GraphDraft,
  candidates: GraphCandidates,
  options: { decisionKeyPrefix: string; limits?: { [K in keyof typeof GRAPH_LIMITS]: number } },
): ValidatedGraph {
  const limits = options.limits ?? GRAPH_LIMITS;
  const dropped = { edges: 0, personalRules: 0, nodes: 0 };

  // --- 節点(規則 1〜4, 10) ---
  const decisions: ValidatedGraph["decisions"] = [];
  const decisionByKey = new Map<string, { key: string; name: string }>();
  for (const d of draft.decisions) {
    const name = clip(d.name, limits.nameChars);
    const norm = normalizeGraphKey(name);
    if (norm === "") {
      dropped.nodes++;
      continue;
    }
    if (decisionByKey.has(norm)) continue;
    if (decisions.length >= limits.maxDecisions) {
      dropped.nodes++;
      continue;
    }
    const key = `${options.decisionKeyPrefix}:${norm}`;
    decisions.push({ key, name, description: clip(d.rationale, limits.descriptionChars) });
    decisionByKey.set(norm, { key, name });
  }

  const concepts: ValidatedGraph["concepts"] = [];
  const draftConcepts = new Map<string, { key: string; name: string }>();
  for (const c of draft.concepts) {
    const name = clip(c.name, limits.nameChars);
    const key = normalizeGraphKey(name);
    if (key === "") {
      dropped.nodes++;
      continue;
    }
    if (draftConcepts.has(key)) continue;
    if (concepts.length >= limits.maxConcepts) {
      dropped.nodes++;
      continue;
    }
    concepts.push({ key, name, description: clip(c.definition, limits.descriptionChars) });
    draftConcepts.set(key, { key, name });
  }

  const rules: ValidatedGraph["rules"] = [];
  const draftRules = new Map<string, { key: string; name: string }>();
  const personalKeys = new Set<string>();
  for (const r of draft.rules) {
    const name = clip(r.name, limits.nameChars);
    const key = normalizeGraphKey(name);
    if (key === "") {
      dropped.nodes++;
      continue;
    }
    if (r.scope === "personal") {
      dropped.personalRules++;
      personalKeys.add(key);
      continue;
    }
    if (draftRules.has(key)) continue;
    if (rules.length >= limits.maxRules) {
      dropped.nodes++;
      continue;
    }
    rules.push({ key, name, description: clip(r.statement, limits.descriptionChars) });
    draftRules.set(key, { key, name });
  }

  const others: ValidatedGraph["others"] = [];
  const otherKeys = new Set<string>();
  for (const o of draft.others) {
    const label = clip(o.label, limits.labelChars);
    const name = clip(o.name, limits.nameChars);
    const labelKey = normalizeGraphKey(label);
    const nameKey = normalizeGraphKey(name);
    if (labelKey === "" || nameKey === "") {
      dropped.nodes++;
      continue;
    }
    const key = `${labelKey}:${nameKey}`;
    if (otherKeys.has(key)) continue;
    if (others.length >= limits.maxOthers) {
      dropped.nodes++;
      continue;
    }
    others.push({ key, label, name, description: clip(o.description, limits.descriptionChars) });
    otherKeys.add(key);
  }

  // --- 既存の概念・ルール・決定の引き当て表 ---
  const existingConcepts = new Map<string, { key: string; name: string }>();
  const aliasToCanonical = new Map<string, { key: string; name: string }>();
  const aliasNodes = new Map<string, { key: string; name: string }>();
  for (const c of candidates.concepts) {
    existingConcepts.set(c.key, { key: c.key, name: c.name });
    for (const a of c.aliases) {
      aliasToCanonical.set(a.key, { key: c.key, name: c.name });
      aliasNodes.set(a.key, { key: a.key, name: a.name });
    }
  }
  const existingRules = new Map(candidates.rules.map((r) => [r.key, { key: r.key, name: r.name }]));
  const refDecisions = new Map(
    candidates.decisions.map((d) => [d.ref, { key: d.key, name: d.name }]),
  );
  const issues = new Set(candidates.issues);
  const files = new Set(candidates.files);

  // --- 辺の両端の解決(規則 5) ---
  type Side = "from" | "to";
  function resolve(
    kind: string,
    rawName: string,
    side: Side,
    edgeKind: GraphDraftEdgeKind,
  ): Ref | null {
    // 節点の作成と同じく、切り詰めてから正規化する(長い名前を指す辺を落とさない)
    const key = normalizeGraphKey(clip(rawName, limits.nameChars));
    switch (kind) {
      case "decision": {
        const own = decisionByKey.get(key);
        if (own) return { kind: "decision", ...own };
        if (side === "from") return null;
        const ref = refDecisions.get(rawName.trim());
        return ref ? { kind: "decision", ...ref } : null;
      }
      case "concept": {
        if (edgeKind === "synonym" && side === "from") {
          // 別名の節点そのもの。読み替えない
          const hit = draftConcepts.get(key) ?? existingConcepts.get(key) ?? aliasNodes.get(key);
          return hit ? { kind: "concept", ...hit } : null;
        }
        const hit =
          aliasToCanonical.get(key) ?? draftConcepts.get(key) ?? existingConcepts.get(key);
        return hit ? { kind: "concept", ...hit } : null;
      }
      case "rule": {
        if (personalKeys.has(key)) return null;
        const hit = draftRules.get(key) ?? existingRules.get(key);
        return hit ? { kind: "rule", ...hit } : null;
      }
      case "issue": {
        const n = normalizeIssue(rawName);
        return n !== null && issues.has(n) ? { kind: "issue", key: n, name: n } : null;
      }
      case "file": {
        const path = normalizeFilePath(rawName);
        return files.has(path) ? { kind: "file", key: path, name: path } : null;
      }
      default:
        return null;
    }
  }

  const seen = new Set<string>();
  const edges: ValidEdge[] = [];
  for (const e of draft.edges) {
    const from = resolve(e.from.kind, e.from.name, "from", e.kind);
    const to = resolve(e.to.kind, e.to.name, "to", e.kind);
    const kindOk = (GRAPH_EDGE_KINDS as readonly string[]).includes(e.kind);
    const label = e.kind === "other" ? clip(e.label, limits.labelChars) : "";
    if (
      !from ||
      !to ||
      !kindOk ||
      !isAllowedDirection(e.kind, from.kind, to.kind) ||
      (from.kind === to.kind && from.key === to.key) ||
      (e.kind === "other" && label === "")
    ) {
      dropped.edges++;
      continue;
    }
    const id = [e.kind, from.kind, from.key, to.kind, to.key, label].join("\u0000");
    if (seen.has(id)) continue;
    seen.add(id);
    if (edges.length >= limits.maxEdges) {
      dropped.edges++;
      continue;
    }
    edges.push({
      kind: e.kind,
      fromKind: from.kind,
      fromKey: from.key,
      toKind: to.kind,
      toKey: to.key,
      toName: to.name,
      label,
    });
  }

  // --- 機械的な節点(残った辺の先の issue / file) ---
  const mechanical: ValidatedGraph["mechanical"] = [];
  const mechSeen = new Set<string>();
  for (const e of edges) {
    if (e.toKind !== "issue" && e.toKind !== "file") continue;
    const id = `${e.toKind}:${e.toKey}`;
    if (mechSeen.has(id)) continue;
    mechSeen.add(id);
    mechanical.push({ kind: e.toKind, key: e.toKey, name: e.toName });
  }

  // --- 決めた(人 → 決定)。AI には出させず、上限にも数えない(規則 9) ---
  const person = candidates.sender && decisions.length > 0 ? candidates.sender : null;
  if (person) {
    for (const d of decisions) {
      edges.push({
        kind: "decided",
        fromKind: "person",
        fromKey: person.key,
        toKind: "decision",
        toKey: d.key,
        toName: d.name,
        label: "",
      });
    }
  }

  return { person, mechanical, decisions, concepts, rules, others, edges, dropped };
}
