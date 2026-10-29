import { knowledgePayload } from "../components/knowledge/contract";
import { validateState } from "../components/boards/workspace-validation.mjs";
import {
  messages,
  archiveRevision,
  references,
  mediaSeed,
  initialState,
} from "./fixtures";
import {
  searchMessages,
  messageLink,
} from "../components/conversations/core.js";
export const roles = [
  ["conversations", "대화 기록", "Conversation archive"],
  ["notes", "노트 작업실", "Notes workspace"],
  ["knowledge", "지식·보고서", "Knowledge & reports"],
  ["documents", "문서 편집", "Document editing"],
  ["boards", "자료 보드", "Reference boards"],
  ["media", "미디어 보관함", "Media library"],
] as const;
export function fixedMessage(id: string) {
  return messageLink("exhibit", id, { revision: archiveRevision });
}
export function makeProposal(state: any, content: string) {
  const payload = knowledgePayload("proposal", {
    content,
    summary: "원문 결정에 맞춰 보고서 다듬기",
    reason: "원문과 미정 사항을 구별한다.",
    scope: "전시 개요",
    evidence_ids: ["decision-3", "candidate-5"],
  });
  return {
    id: crypto.randomUUID(),
    baseRevision: state.revision,
    status: "open",
    payload,
    actor: "scripted-demo",
    source: { id: "exhibit-m0003", revision: archiveRevision },
  };
}
export function applyProposal(
  state: any,
  id: string,
  expected: number,
  requestId: string,
) {
  if (typeof requestId !== "string" || !/^[-a-z0-9]{8,80}$/i.test(requestId))
    throw Error("요청 번호 형식이 올바르지 않습니다.");
  const replay = state.applied[requestId];
  if (replay) {
    if (replay.proposal !== id || replay.expected !== expected)
      throw Error("같은 요청 번호의 내용이 다릅니다.");
    return state;
  }
  const p = state.proposals.find((p: any) => p.id === id);
  if (!p || p.status !== "open") throw Error("열린 수정안을 선택하세요.");
  if (state.revision !== expected || p.baseRevision !== expected)
    throw Error("문서가 변경됐습니다. 최신 본문으로 수정안을 다시 검토하세요.");
  knowledgePayload("proposal", p.payload);
  if (
    p.source.revision !== archiveRevision ||
    !messages.some((m) => m.id === p.source.id)
  )
    throw Error("원문 버전을 확인할 수 없습니다.");
  return {
    ...state,
    revision: expected + 1,
    content: p.payload.content,
    history: [...state.history, { revision: expected, content: state.content }],
    proposals: state.proposals.map((p: any) =>
      p.id === id ? { ...p, status: "applied" } : p,
    ),
    applied: {
      ...state.applied,
      [requestId]: { proposal: id, expected, revision: expected + 1 },
    },
  };
}
export function saveBoard(candidate: any, previous: any) {
  if (candidate.revision !== previous.revision)
    throw Error("자료 보드가 변경됐습니다. 다시 읽고 저장하세요.");
  const validated = validateState(
    candidate,
    new Set(references.map((r) => r.id)),
    previous,
  );
  return {
    ...validated,
    revision: previous.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}
export function searchArchive(query: string) {
  return searchMessages(messages, query);
}
export function readRole(role: string) {
  const state = initialState();
  switch (role) {
    case "conversations":
      return { revision: archiveRevision, messages };
    case "notes":
      return { notes: state.notes, canvas: JSON.parse(state.canvas) };
    case "knowledge":
      return state.knowledge;
    case "documents":
      return {
        format: "HWPX",
        supported: "Section 0 body and direct table cells",
        implementation: "components/documents/structured.mjs",
        sample:
          "Generated in browser by the bundled MIT engine. No private documents.",
      };
    case "boards":
      return { references, workspace: state.boards };
    case "media":
      return {
        records: mediaSeed,
        reading: "Authored fixture annotations, not OCR/ASR model output",
      };
    default:
      throw Error("Unknown role");
  }
}
