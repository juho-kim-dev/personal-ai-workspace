import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createHash } from "node:crypto";
import {
  searchMessages,
  matchRanges,
  highlight,
  parseRoute,
  messageLink,
  searchContext,
} from "../components/conversations/core.js";
import {
  parseCanvas,
  addCanvasNode,
  connectCanvasNodes,
  deleteCanvasNode,
  serializeCanvas,
} from "../components/notes/lib/client/canvas-document.ts";
import {
  buildGraph,
  defaultGraphState,
} from "../components/notes/lib/client/graph.ts";
import {
  setProperty,
  propertyDocument,
} from "../components/notes/lib/client/core-features.ts";
import {
  DraftJournal,
  parseDraft,
} from "../components/notes/lib/client/draft-journal.ts";
import { knowledgePayload } from "../components/knowledge/contract.ts";
import {
  makeProposal,
  applyProposal,
  saveBoard,
  roles,
  readRole,
} from "../src/domain.ts";
import {
  initialState,
  messages,
  noteSeed,
  mediaSeed,
  archiveRevision,
} from "../src/fixtures.ts";
import { dispatch } from "../src/mcp.ts";
import init, { HwpDocument } from "../components/documents/engine/rhwp.js";
import {
  makeDocument,
  fingerprint,
  validateOutput,
} from "../components/documents/documents.mjs";
import { structure } from "../components/documents/structured.mjs";
import { structuredStage } from "../components/documents/structured-snapshot.mjs";

test("archive search preserves text and Unicode grapheme boundaries", () => {
  const raw = [{ text: "Cafe\u0301 👨‍👩‍👧‍👦", threadId: "a", id: "a1", seq: 1 }];
  assert.equal(searchMessages(raw, "CAFÉ")[0].text, raw[0].text);
  assert.deepEqual(matchRanges(raw[0].text, "é"), [[3, 5]]);
  assert.deepEqual(matchRanges(raw[0].text, "👩"), [[6, 17]]);
  assert.equal(highlight("<script>", "script"), "&lt;<mark>script</mark>&gt;");
});
test("fixed message link roundtrips revision and source context", () => {
  assert.equal(
    createHash("sha256").update(JSON.stringify(messages)).digest("hex"),
    archiveRevision,
  );
  const link = messageLink("a", "a1", { revision: "a".repeat(64) }),
    route = parseRoute(link);
  assert.equal(route.revision, "a".repeat(64));
  assert.equal(route.message, "a1");
  assert.equal(searchContext(messages, messages[2]).before.id, messages[1].id);
  assert.equal(parseRoute("#/thread/a?turn=1&turn=2").view, "missing");
});
test("graph follows actual wiki links, not precomputed decorative nodes", () => {
  const files = Object.keys(noteSeed).map((path) => ({
    path,
    mime: "text/markdown",
    size: 10,
    revision: "r1",
    updatedAt: "2026-01-01T00:00:00Z",
  }));
  const g = buildGraph(noteSeed, files, defaultGraphState());
  assert.equal(g.nodes.length, 3);
  assert.ok(g.links.length >= 2);
});
test("canvas edits preserve unknown data and reject dangling edges", () => {
  let doc = { nodes: [], edges: [], custom: { preserve: true } };
  doc = addCanvasNode(doc, "text");
  doc = addCanvasNode(doc, "text");
  doc = connectCanvasNodes(doc, doc.nodes[0].id, doc.nodes[1].id, "trace");
  assert.equal(parseCanvas(serializeCanvas(doc)).ok, true);
  assert.deepEqual(doc.custom, { preserve: true });
  const removed = deleteCanvasNode(doc, doc.nodes[0].id);
  assert.equal(removed.edges.length, 0);
  assert.equal(parseCanvas(JSON.stringify({ ...doc, nodes: [] })).ok, false);
});
test("YAML property changes preserve comments and refuse dangerous keys", () => {
  const text = "---\nstatus: draft # keep this\n---\nBody";
  const next = setProperty(text, "status", "ready");
  assert.ok(next.includes("# keep this"));
  assert.equal(propertyDocument(next).body, "Body");
  assert.throws(() => setProperty(text, "__proto__", "bad"));
});
function storage() {
  const data = new Map();
  return {
    get length() {
      return data.size;
    },
    key(i) {
      return [...data.keys()][i] ?? null;
    },
    getItem(k) {
      return data.get(k) ?? null;
    },
    setItem(k, v) {
      data.set(k, v);
    },
    removeItem(k) {
      data.delete(k);
    },
  };
}
const file = {
  path: "demo.md",
  size: 4,
  mime: "text/markdown",
  revision: "r1",
  updatedAt: "2026-01-01T00:00:00Z",
};
test("draft journals survive a new run and remove only acknowledged snapshot", () => {
  const store = storage(),
    a = new DraftJournal(store, "public", "notes");
  const first = a.persist({
    file,
    text: "changed",
    saved: "base",
    revision: "r1",
  });
  assert.ok(parseDraft(first.raw));
  const b = new DraftJournal(store, "public", "notes");
  assert.equal(b.discover()[0].record.text, "changed");
  const second = b.persist({
    file,
    text: "newer",
    saved: "base",
    revision: "r1",
  });
  a.remove(first);
  assert.ok(b.discover().some((c) => c.key === second.key));
});
test("draft quota failure retains exportable in-memory text", () => {
  const store = storage();
  store.setItem = () => {
    throw Object.assign(Error("quota"), { name: "QuotaExceededError" });
  };
  const journal = new DraftJournal(store, "public", "notes");
  journal.persist({
    file,
    text: "must survive",
    saved: "base",
    revision: "r1",
  });
  assert.equal(journal.issue, "quota");
  assert.equal(journal.discover()[0].record.text, "must survive");
});
test("knowledge contract rejects unsafe URLs and unsupported evidence fields", () => {
  const evidence = {
    url:
      "https://example.invalid/#/thread/exhibit/message/exhibit-m0003?revision=" +
      archiveRevision,
    label: "Public fixture",
    source_key: "exhibit",
    source_version: archiveRevision,
    observed_at: "2026-01-01T00:00:00Z",
    scope: "Message 3",
  };
  assert.equal(
    knowledgePayload("evidence", evidence).source_version,
    archiveRevision,
  );
  assert.throws(() =>
    knowledgePayload("evidence", { ...evidence, source_version: "wrong" }),
  );
  assert.throws(() =>
    knowledgePayload("evidence", {
      url: "javascript:alert(1)",
      label: "x",
      source_key: "x",
      source_version: "v1",
      observed_at: "2026-01-01T00:00:00Z",
      scope: "x",
    }),
  );
  assert.throws(() =>
    knowledgePayload("proposal", {
      content: "a",
      summary: "b",
      reason: "c",
      scope: "d",
      evidence_ids: ["x", "x"],
    }),
  );
});
test("proposal application checks revision and is idempotent without duplicate history", () => {
  const base = initialState().knowledge,
    p = makeProposal(base, "Reviewed content"),
    state = { ...base, proposals: [p] };
  const applied = applyProposal(state, p.id, 1, "request-0001");
  assert.equal(applied.content, "Reviewed content");
  assert.equal(applied.history.length, 1);
  assert.equal(applyProposal(applied, p.id, 1, "request-0001"), applied);
  assert.throws(() => applyProposal(applied, p.id, 2, "request-0001"));
  assert.throws(() =>
    applyProposal({ ...state, revision: 2 }, p.id, 2, "request-0002"),
  );
  assert.equal(state.content, base.content);
});
test("board state rejects unknown media and memberships; retains notes", () => {
  const base = initialState().boards;
  const candidate = structuredClone(base);
  candidate.items.light.notes = "For the entrance";
  const saved = saveBoard(candidate, base);
  assert.equal(saved.items.light.notes, "For the entrance");
  assert.equal(saved.revision, 1);
  assert.throws(() => saveBoard(candidate, saved));
  candidate.items.light.boards = ["unknown"];
  assert.throws(() => saveBoard(candidate, base));
});
test("media corpus searches authored segments and marks unknown readings honestly", async () => {
  const context = { window: {}, structuredClone };
  vm.runInNewContext(
    await readFile("components/media/saved-corpus.js", "utf8"),
    context,
  );
  const corpus = context.window.MediaLibraryCorpus;
  assert.equal(corpus.search(mediaSeed, "빛")[0].id, "window-light");
  assert.ok(corpus.matches(mediaSeed[0], "천천히").some((m) => m.start === 2));
  assert.equal(corpus.readingStatus({}).asr, "not-analyzed");
  assert.equal(
    corpus.commentBody({ bodyStatus: "unknown", text: "not evidence" }),
    "",
  );
});
test("MCP exposes six read-only fixture roles and bounded search", () => {
  assert.equal(dispatch({ method: "tools/list" }).tools.length, 7);
  for (const [role] of roles) {
    assert.ok(readRole(role));
    assert.ok(
      !dispatch({
        method: "tools/call",
        params: { name: "read_" + role, arguments: {} },
      }).isError,
    );
  }
  assert.ok(
    dispatch({
      method: "tools/call",
      params: { name: "search_conversations", arguments: { query: "자막" } },
    }).content[0].text.includes("자막"),
  );
  assert.equal(
    dispatch({
      method: "tools/call",
      params: { name: "read_notes", arguments: { path: "../../private" } },
    }).isError,
    true,
  );
});
await init({
  module_or_path: await readFile("components/documents/engine/rhwp_bg.wasm"),
});
test("HWPX body and table edits survive export/reopen with style and table fingerprints", () => {
  const bytes = makeDocument(true, "hwpx"),
    doc = new HwpDocument(bytes);
  let paragraph, cell;
  try {
    const model = structure(doc);
    paragraph = model.paragraphs[0];
    cell = model.paragraphs.find((p) => p.target === "cell:1:0:3:0");
  } finally {
    doc.free();
  }
  const staged = structuredStage(HwpDocument, bytes, [
    {
      type: "replace",
      target: "body:0",
      start: 0,
      end: [...paragraph.text].length,
      text: "공개 전시 😀",
    },
    {
      type: "replace",
      target: "cell:1:0:3:0",
      start: 0,
      end: [...cell.text].length,
      text: "빛 · 길 · 쉼",
    },
  ]);
  const reopened = new HwpDocument(staged.bytes);
  try {
    const check = validateOutput(staged.bytes, fingerprint(reopened));
    assert.equal(check.reopened, true);
    assert.equal(check.textPreserved, true);
    assert.equal(check.stylesPreserved, true);
    assert.equal(check.tablesPreserved, true);
    assert.equal(check.cellCount, 6);
    assert.ok(structure(reopened).text.includes("공개 전시 😀"));
  } finally {
    reopened.free();
  }
});
test("failed structured batch leaves original bytes untouched", () => {
  const bytes = makeDocument(true, "hwpx"),
    before = Buffer.from(bytes);
  assert.throws(
    () =>
      structuredStage(HwpDocument, bytes, [
        { type: "insert", target: "body:0", text: "staged only" },
        { type: "replace", target: "missing", text: "invalid" },
      ]),
    /no changes committed/,
  );
  assert.deepEqual(Buffer.from(bytes), before);
  const doc = new HwpDocument(bytes);
  try {
    assert.ok(!structure(doc).text.includes("staged only"));
  } finally {
    doc.free();
  }
});
