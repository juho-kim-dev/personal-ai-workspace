import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MessageSquare,
  NotebookPen,
  BookOpen,
  FileText,
  LayoutGrid,
  Film,
  ArrowUpRight,
  ArrowRight,
  Search,
  Check,
  Download,
  GitBranch,
  Star,
} from "lucide-react";
import {
  roles,
  fixedMessage,
  makeProposal,
  applyProposal,
  saveBoard,
} from "./domain";
import {
  messages,
  archiveRevision,
  initialState,
  references,
  mediaSeed,
} from "./fixtures";
import {
  searchMessages,
  searchContext,
  highlight,
  parseRoute,
} from "../components/conversations/core.js";
import { Graph } from "../components/notes/app/components/GraphView";
import { defaultGraphState } from "../components/notes/lib/client/graph";
import CanvasEditor from "../components/notes/app/components/CanvasEditor";
import {
  DraftJournal,
  journalIssueMessage,
} from "../components/notes/lib/client/draft-journal";
import { parseCanvas } from "../components/notes/lib/client/canvas-document";
import "../components/media/saved-corpus.js";
import "../components/media/saved-media.js";
import DocumentPane from "./DocumentPane";
import { download } from "./ui";
import "./style.css";

const icons = [
    MessageSquare,
    NotebookPen,
    BookOpen,
    FileText,
    LayoutGrid,
    Film,
  ],
  storageKey = "paw-public-demo-v1";
function load() {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return { state: initialState(), error: "" };
    const s = JSON.parse(raw);
    if (
      s.schema !== 1 ||
      !s.notes ||
      typeof s.canvas !== "string" ||
      !s.knowledge ||
      !s.boards
    )
      throw Error("데모 저장 형식이 다릅니다.");
    return { state: s, error: "" };
  } catch (e) {
    return {
      state: initialState(),
      error:
        "저장 내용을 읽지 못했습니다. 현재 화면은 새 예제입니다. 기존 저장 내용은 그대로 두었습니다.",
    };
  }
}
const loaded = load();
function App() {
  const [state, setState] = useState<any>(loaded.state),
    [role, setRole] = useState(
      location.hash.startsWith("#/thread/") ? "conversations" : "overview",
    ),
    [notice, setNotice] = useState(loaded.error),
    [blocked, setBlocked] = useState(!!loaded.error),
    [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const change = () => {
      setHash(location.hash);
      if (location.hash.startsWith("#/thread/")) setRole("conversations");
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  function save(key: string, value: any) {
    if (blocked) {
      setNotice(
        "기존 저장 내용을 읽을 수 없어 덮어쓰기를 중단했습니다. 새 탭에서 데모를 열어주세요.",
      );
      return false;
    }
    const next = { ...state, [key]: value };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      setState(next);
      return true;
    } catch {
      setNotice(
        "저장 공간을 사용할 수 없습니다. 변경을 적용하지 않았습니다. 먼저 작업을 내려받으세요.",
      );
      return false;
    }
  }
  const meta = roles.find((r) => r[0] === role);
  return (
    <div
      className="app-shell"
      onClick={(e) => {
        if ((e.target as Element).closest('a[href^="#/thread/"]'))
          setRole("conversations");
      }}
    >
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => setRole("overview")}
          aria-label="PAW 시작 화면"
        >
          <span className="brand-mark">p.</span>
          <span>
            PAW<small>Personal AI Workspace</small>
          </span>
        </button>
        <p className="nav-caption">YOUR WORK, CONNECTED</p>
        <nav aria-label="작업 역할">
          {roles.map(([id, label, en], i) => {
            const Icon = icons[i];
            return (
              <button
                key={id}
                aria-label={label}
                title={label}
                className={role === id ? "nav-item active" : "nav-item"}
                onClick={() => setRole(id)}
              >
                <Icon size={19} />
                <span>
                  {label}
                  <small>{en}</small>
                </span>
                <span className="nav-number">0{i + 1}</span>
              </button>
            );
          })}
        </nav>
        <div className="side-bottom">
          <span className="status-dot" /> PUBLIC REFERENCE
          <br />
          <p>
            합성 자료로 자유롭게 탐색하세요.
            <br />
            변경은 이 탭에만 저장됩니다.
          </p>
          <a
            href="https://github.com/juho-kim-dev/personal-ai-workspace"
            target="_blank"
            rel="noreferrer"
          >
            소스 코드 보기 <ArrowUpRight size={14} />
          </a>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            워크스페이스 <span className="slash">/</span>{" "}
            <strong>{meta?.[1] || "시작하기"}</strong>
          </span>
          <div className="top-actions">
            <span className="demo-badge">SYNTHETIC DEMO</span>
            <button
              onClick={() =>
                download(
                  "paw-demo-session.json",
                  JSON.stringify(state, null, 2),
                )
              }
            >
              <Download size={15} />
              작업 내려받기
            </button>
          </div>
        </header>
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button aria-label="알림 닫기" onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        )}
        <div className={"workspace " + (role === "overview" ? "overview" : "")}>
          {role === "overview" ? (
            <Overview go={setRole} />
          ) : (
            <>
              <div className="workspace-heading">
                <div>
                  <p className="eyebrow">{meta?.[2]}</p>
                  <h1>{meta?.[1]}</h1>
                </div>
                <span className="project-label">
                  <span />
                  느리게 보는 도시
                </span>
              </div>
              {role === "conversations" && (
                <Conversations hash={hash} notify={setNotice} go={setRole} />
              )}
              {role === "notes" && (
                <Notes
                  notes={state.notes}
                  canvas={state.canvas}
                  save={save}
                  notify={setNotice}
                />
              )}
              {role === "knowledge" && (
                <Knowledge
                  data={state.knowledge}
                  save={save}
                  notify={setNotice}
                  go={setRole}
                />
              )}
              {role === "documents" && (
                <DocumentPane
                  report={state.knowledge.content}
                  notify={setNotice}
                />
              )}
              {role === "boards" && (
                <Boards
                  data={state.boards}
                  save={save}
                  notify={setNotice}
                  go={setRole}
                />
              )}
              {role === "media" && <Media />}
            </>
          )}
        </div>
        <footer>
          PAW / 공개 참조 구현{" "}
          <span>원문을 남기고, 맥락을 연결하고, 작업을 이어갑니다.</span>
        </footer>
      </main>
    </div>
  );
}
function Overview({ go }) {
  return (
    <>
      <div className="hero">
        <p className="eyebrow">PERSONAL AI WORKSPACE / 01</p>
        <h1>
          생각이 흩어져도,
          <br />
          <em>맥락은 이어지도록.</em>
        </h1>
        <p className="hero-copy">
          대화에서 시작한 생각을 노트로, 자료를 근거로,
          <br />
          검토한 결정을 한 편의 문서로 이어갑니다.
        </p>
        <button
          className="primary hero-button"
          onClick={() => go("conversations")}
        >
          대화에서 시작하기 <ArrowRight size={17} />
        </button>
        <div className="hero-art" aria-hidden="true">
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
          <span className="orbit-core">p.</span>
          <span className="orbit-tag t1">SOURCE</span>
          <span className="orbit-tag t2">CONTEXT</span>
          <span className="orbit-tag t3">WORK</span>
        </div>
      </div>
      <section className="scenario">
        <div>
          <p className="eyebrow">ONE PROJECT, SIX ROLES</p>
          <h2>작은 전시를 준비하는 작업실</h2>
        </div>
        <p>
          「느리게 보는 도시」는 직접 만든 예제입니다.
          <br />
          아래 흐름을 따라가거나 원하는 역할부터 열어보세요.
        </p>
      </section>
      <div className="role-grid">
        {roles.map(([id, label, en], i) => {
          const Icon = icons[i];
          return (
            <button key={id} className="role-card" onClick={() => go(id)}>
              <div className="card-top">
                <Icon size={25} />
                <span>0{i + 1}</span>
              </div>
              <h3>{label}</h3>
              <p>
                {
                  [
                    "결정의 앞뒤 대화와 원문 버전을 확인합니다.",
                    "글을 고치고 그래프·캔버스로 연결합니다.",
                    "출처와 변경 후보를 분리해 검토합니다.",
                    "실제 HWPX의 문단과 표를 편집합니다.",
                    "이미지를 묶고 메모와 선정 후보를 남깁니다.",
                    "영상·이미지를 검색하고 해당 장면을 엽니다.",
                  ][i]
                }
              </p>
              <span className="role-open">
                {en}
                <ArrowUpRight size={16} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="principles">
        <div>
          <GitBranch size={21} />
          <h3>원문에서 결과까지</h3>
          <p>
            요약으로 원문을 덮지 않습니다. 출처의 버전과 검토한 변경을 함께
            남깁니다.
          </p>
        </div>
        <div>
          <Check size={21} />
          <h3>직접 확인할 수 있는 구현</h3>
          <p>
            운영 구현에서 선별한 핵심 코드와 공개용 연결부를 구분해
            기록했습니다.
          </p>
        </div>
        <div>
          <BookOpen size={21} />
          <h3>개인 자료와 독립된 예제</h3>
          <p>
            대화·노트·이미지는 모두 합성 자료입니다. 실계정 로그인이나 원격
            수집을 하지 않습니다.
          </p>
        </div>
      </div>
    </>
  );
}
function Conversations({ hash, notify, go }) {
  const [q, setQ] = useState(""),
    [selected, setSelected] = useState("exhibit-m0003");
  const route = parseRoute(hash);
  useEffect(() => {
    if (route.view === "thread") {
      if (
        route.thread !== "exhibit" ||
        (route.revision && route.revision !== archiveRevision) ||
        !messages.some((m) => m.id === route.message)
      ) {
        notify("이 예제에는 요청한 원문 버전이나 메시지가 없습니다.");
        return;
      }
      setSelected(route.message);
      setQ("");
    }
  }, [hash]);
  const rows = q.trim() ? searchMessages(messages, q) : messages,
    hit = messages.find((m) => m.id === selected),
    context = searchContext(messages, hit);
  return (
    <div className="split-panel archive">
      <section>
        <div className="panel-toolbar">
          <label className="search">
            <Search size={17} />
            <input
              aria-label="대화 검색"
              placeholder="대화 원문 검색…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <span className="count">{rows.length}개 메시지</span>
        </div>
        <div className="thread-title">
          <p className="eyebrow">EXHIBITION / JAN 12–13</p>
          <h2>느리게 보는 도시 · 기획 대화</h2>
          <p>합성 대화 · 원문 순서 보존 · 버전 고정</p>
        </div>
        <div className="messages">
          {rows.map((m) => (
            <button
              key={m.id}
              className={"message " + (selected === m.id ? "selected" : "")}
              onClick={() => setSelected(m.id)}
            >
              <span className="message-meta">
                <b>{m.role === "user" ? "기획자" : "AI · 작성된 예시"}</b>
                <time>{m.time.slice(5, 16).replace("T", " ")}</time>
              </span>
              <span
                className="message-text"
                dangerouslySetInnerHTML={{ __html: highlight(m.text, q) }}
              />
            </button>
          ))}
          {!rows.length && (
            <p className="empty">
              검색 결과가 없습니다. “자막” 또는 “후보”를 찾아보세요.
            </p>
          )}
        </div>
      </section>
      <aside className="context-panel">
        <p className="eyebrow">SOURCE CONTEXT</p>
        <h3>앞뒤 맥락까지 함께</h3>
        <p className="muted">
          선택한 메시지의 전후 대화를 읽고 결정과 후보를 구분하세요.
        </p>
        {[context.before, hit, context.after].filter(Boolean).map((m) => (
          <article
            key={m.id}
            className={m.id === hit.id ? "context-current" : ""}
          >
            <small>
              {m.id === hit.id
                ? "선택한 원문"
                : m.seq < hit.seq
                  ? "이전"
                  : "다음"}{" "}
              · #{m.seq}
            </small>
            <p>{m.text}</p>
          </article>
        ))}
        <a className="source-link" href={fixedMessage(hit.id)}>
          이 원문의 고정 링크 <ArrowUpRight size={14} />
        </a>
        <p className="fine mono">revision {archiveRevision.slice(0, 12)}…</p>
        <button onClick={() => go("knowledge")}>
          근거와 보고서 보기 <ArrowRight size={15} />
        </button>
      </aside>
    </div>
  );
}
function Notes({ notes, canvas, save, notify }) {
  const [path, setPath] = useState(Object.keys(notes)[0]),
    [mode, setMode] = useState("write"),
    [draft, setDraft] = useState(notes[path]),
    [graph, setGraph] = useState(defaultGraphState),
    [recoveries, setRecoveries] = useState<any[]>([]);
  const journal = useMemo(() => {
    let storage = null;
    try {
      storage = localStorage;
    } catch {}
    return new DraftJournal(storage, "public-demo", "synthetic-notes");
  }, []);
  const file = (p) => ({
    path: p,
    size: new TextEncoder().encode(notes[p]).length,
    mime: "text/markdown",
    revision: "public-" + notes[p].length,
    updatedAt: "2026-01-12T00:00:00Z",
  });
  useEffect(() => {
    setRecoveries(
      journal
        .discover()
        .filter(
          (c) => c.record?.file.path === path && c.record.text !== notes[path],
        ),
    );
  }, [path]);
  function change(value) {
    setDraft(value);
    journal.persist({
      file: file(path),
      text: value,
      saved: notes[path],
      revision: file(path).revision,
    });
    if (journal.issue) notify(journalIssueMessage(journal.issue));
  }
  function open(next) {
    if (!Object.hasOwn(notes, next)) {
      notify("이 예제에 없는 노트입니다.");
      return;
    }
    setPath(next);
    setDraft(notes[next]);
    setMode("write");
  }
  function commit() {
    if (save("notes", { ...notes, [path]: draft })) {
      journal
        .discover()
        .filter((c) => c.record?.file.path === path && c.record.text === draft)
        .forEach((c) => journal.remove(c));
      setRecoveries([]);
      notify("노트를 이 탭에 저장했습니다.");
    }
  }
  return (
    <div className="notes-panel">
      <aside className="note-list">
        <p className="eyebrow">EXHIBITION NOTES</p>
        {Object.keys(notes).map((p) => (
          <button
            key={p}
            className={p === path ? "selected" : ""}
            onClick={() => open(p)}
          >
            <FileText size={16} />
            {p.replace(".md", "")}
          </button>
        ))}
        <div className="note-help">
          [[노트 이름]] 링크로 생각을 연결해 보세요.
          <br />
          <br />
          타이핑한 초안은 이 브라우저의 복구 기록에 남습니다.
        </div>
      </aside>
      <section className="note-work">
        <div className="panel-toolbar">
          <div className="tabs">
            {[
              ["write", "글쓰기"],
              ["graph", "관계 그래프"],
              ["canvas", "캔버스"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={mode === id}
                onClick={() => setMode(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() =>
              download(
                mode === "canvas" ? "exhibition.canvas" : path,
                mode === "canvas" ? canvas : draft,
                "text/plain",
              )
            }
          >
            내려받기
          </button>
        </div>
        {mode === "write" ? (
          <>
            <div className="note-title">
              <h2>{path.replace(".md", "")}</h2>
              <button className="primary" onClick={commit}>
                노트 저장
              </button>
            </div>
            {recoveries.length > 0 && (
              <div className="recovery">
                저장되지 않은 초안 {recoveries.length}개가 있습니다.
                <button
                  onClick={() => {
                    setDraft(recoveries[0].record.text);
                    notify(
                      "복구 초안을 열었습니다. 본문과 비교한 뒤 저장하세요.",
                    );
                  }}
                >
                  최근 초안 열기
                </button>
                <button
                  onClick={() =>
                    download(
                      "draft-recovery.json",
                      JSON.stringify(recoveries, null, 2),
                    )
                  }
                >
                  복구 기록 받기
                </button>
              </div>
            )}
            <textarea
              className="note-editor"
              aria-label="노트 본문"
              value={draft}
              onChange={(e) => change(e.target.value)}
              spellCheck={false}
            />
            <div className="outgoing">
              <span>연결된 노트</span>
              {[...draft.matchAll(/\[\[([^\]]+)\]\]/g)].map((m, i) => (
                <button key={i} onClick={() => open(m[1] + ".md")}>
                  {m[1]} ↗
                </button>
              ))}
            </div>
          </>
        ) : mode === "graph" ? (
          <div className="graph-host">
            <Graph
              index={notes}
              files={Object.keys(notes).map(file)}
              active={path}
              partial=""
              loading={false}
              tabId="public-graph"
              initialState={graph}
              onStateChange={setGraph}
              onOpen={open}
            />
          </div>
        ) : (
          <div className="canvas-host">
            <CanvasEditor
              text={canvas}
              onChange={(s) => {
                if (parseCanvas(s).ok) save("canvas", s);
              }}
              onOpen={open}
              readOnly={false}
              files={Object.keys(notes)}
            />
          </div>
        )}
      </section>
    </div>
  );
}
function Knowledge({ data, save, notify, go }) {
  const [draft, setDraft] = useState(data.content),
    [candidate, setCandidate] = useState(
      data.content +
        "\n\n관측: 동선 때문에 길 구역을 먼저 두는 안이 제안되었다. 최종 순서는 현장 확인 후 결정한다.",
    ),
    [history, setHistory] = useState(false);
  function run(fn) {
    try {
      fn();
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <div className="split-panel knowledge">
      <section className="report">
        <div className="panel-toolbar">
          <span className="revision">보고서 · revision {data.revision}</span>
          <button onClick={() => setHistory(!history)}>
            {history ? "현재 본문" : "변경 이력"}
          </button>
        </div>
        <h2>느리게 보는 도시</h2>
        {history ? (
          <div className="history">
            {data.history.length ? (
              data.history.map((h) => (
                <article key={h.revision}>
                  <b>revision {h.revision}</b>
                  <pre>{h.content}</pre>
                </article>
              ))
            ) : (
              <p>아직 본문 변경이 없습니다.</p>
            )}
          </div>
        ) : (
          <textarea
            aria-label="보고서 본문"
            className="report-editor"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        )}
        <div className="actions">
          <button
            className="primary"
            onClick={() => {
              if (
                save("knowledge", {
                  ...data,
                  content: draft,
                  revision: data.revision + 1,
                  history: [
                    ...data.history,
                    { revision: data.revision, content: data.content },
                  ],
                })
              )
                notify(
                  "본문을 저장했습니다. 이전 버전의 수정안은 다시 검토해야 합니다.",
                );
            }}
          >
            직접 수정 저장
          </button>
          <button onClick={() => go("documents")}>
            문서로 이어가기 <ArrowRight size={15} />
          </button>
        </div>
        <hr />
        <h3>연결된 근거</h3>
        <a className="evidence" href={fixedMessage("exhibit-m0003")}>
          <span className="evidence-icon">
            <MessageSquare size={19} />
          </span>
          <span>
            <b>작은 인쇄물 · 음소거 영상 · 자막</b>
            <small>
              기획자 원문 #3 · 고정 버전 {archiveRevision.slice(0, 8)}
            </small>
          </span>
          <ArrowUpRight size={17} />
        </a>
        <div className="observation">
          <b>새 관측 ≠ 확정된 변경</b>
          <p>
            원문 #5의 순서 변경은 후보입니다. 출처가 달라졌다는 이유만으로
            보고서가 자동 수정되지는 않습니다.
          </p>
          <button
            onClick={() => {
              if (
                save("knowledge", {
                  ...data,
                  observations: [
                    ...data.observations,
                    {
                      id: crypto.randomUUID(),
                      source: "exhibit-m0005",
                      sourceRevision: archiveRevision,
                      category: "source_changed",
                      status: "needs-review",
                    },
                  ],
                })
              )
                notify(
                  "새 원문 관측을 재검토 항목으로 남겼습니다. 본문은 유지됩니다.",
                );
            }}
          >
            재검토 항목 기록
          </button>
          <span className="fine"> {data.observations.length}개 기록</span>
        </div>
      </section>
      <aside className="proposal-panel">
        <p className="eyebrow">REVIEW BEFORE APPLY</p>
        <h3>근거를 갖춘 수정안</h3>
        <p className="muted">
          AI 협업 흐름을 보여주는 작성된 예시입니다. 실제 모델을 호출하지
          않습니다.
        </p>
        <label>
          제안할 본문
          <textarea
            value={candidate}
            onChange={(e) => setCandidate(e.target.value)}
            rows={8}
          />
        </label>
        <button
          onClick={() =>
            run(() => {
              const p = makeProposal(data, candidate);
              save("knowledge", { ...data, proposals: [...data.proposals, p] });
            })
          }
        >
          수정안 만들기
        </button>
        {data.proposals.map((p) => (
          <article className="proposal" key={p.id}>
            <div>
              <b>{p.payload.summary}</b>
              <span className="pill">
                {p.status === "applied"
                  ? "반영됨"
                  : p.baseRevision !== data.revision
                    ? "재검토 필요"
                    : "검토 대기"}
              </span>
            </div>
            <p>{p.payload.reason}</p>
            <small>기준 revision {p.baseRevision} · 작성된 AI 예시</small>
            <pre>{p.payload.content}</pre>
            <a href={fixedMessage(p.source.id)}>원문 결정 #3 확인 ↗</a>
            <a href={fixedMessage("exhibit-m0005")}>변경 후보 #5 확인 ↗</a>
            <button
              disabled={p.status !== "open" || p.baseRevision !== data.revision}
              onClick={() =>
                run(() => {
                  const next = applyProposal(
                    data,
                    p.id,
                    data.revision,
                    crypto.randomUUID(),
                  );
                  if (save("knowledge", next)) {
                    setDraft(next.content);
                    notify(
                      "검토한 수정안을 반영했습니다. 이전 본문은 이력에 남습니다.",
                    );
                  }
                })
              }
            >
              검토 후 반영
            </button>
          </article>
        ))}
      </aside>
    </div>
  );
}
function Boards({ data, save, notify, go }) {
  const [board, setBoard] = useState("inspiration"),
    [selected, setSelected] = useState("light"),
    [q, setQ] = useState(""),
    [newTitle, setNewTitle] = useState("");
  const ref = references.find((r) => r.id === selected),
    item = data.items[selected];
  function change(update) {
    try {
      save("boards", saveBoard({ ...data, ...update }, data));
    } catch (e) {
      notify(e.message);
    }
  }
  function itemChange(value) {
    change({ items: { ...data.items, [selected]: { ...item, ...value } } });
  }
  const shown = references.filter(
    (r) =>
      data.items[r.id].boards.includes(board) &&
      (r.title + r.text + data.items[r.id].notes).includes(q),
  );
  return (
    <>
      <div className="panel-toolbar board-toolbar">
        <div className="tabs">
          {data.boards.map((b) => (
            <button
              key={b.id}
              aria-pressed={b.id === board}
              onClick={() => setBoard(b.id)}
            >
              {b.title}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newTitle.trim()) return;
            const id = crypto.randomUUID();
            change({
              boards: [
                ...data.boards,
                {
                  id,
                  title: newTitle.trim(),
                  createdAt: new Date().toISOString(),
                },
              ],
            });
            setNewTitle("");
          }}
        >
          <input
            aria-label="새 보드 이름"
            placeholder="새 보드 이름"
            value={newTitle}
            maxLength={100}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <button>보드 추가</button>
        </form>
      </div>
      <div className="board-layout">
        <section>
          <label className="search">
            <Search size={17} />
            <input
              aria-label="자료 검색"
              placeholder="자료와 메모 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <div className="masonry">
            {shown.map((r) => (
              <button
                key={r.id}
                className={"pin " + (r.id === selected ? "selected" : "")}
                onClick={() => setSelected(r.id)}
              >
                <img src={r.image} alt={r.text} />
                <span>
                  <b>{r.title}</b>
                  {data.items[r.id].favorite && (
                    <Star size={16} fill="currentColor" />
                  )}
                </span>
                <small>{r.category}</small>
              </button>
            ))}
          </div>
          {!shown.length && (
            <p className="empty">
              이 보드에는 해당 자료가 없습니다. 다른 보드에서 자료를 선택해
              추가하세요.
            </p>
          )}
        </section>
        <aside className="pin-detail">
          <img src={ref.image} alt={ref.text} />
          <p className="eyebrow">AUTHORED REFERENCE</p>
          <h2>{ref.title}</h2>
          <p>{ref.text}</p>
          <button
            aria-pressed={item.favorite}
            onClick={() => itemChange({ favorite: !item.favorite })}
          >
            <Star size={16} />
            {item.favorite ? "즐겨찾기 해제" : "즐겨찾기"}
          </button>
          <label>
            자료 메모
            <textarea
              aria-label="자료 메모"
              value={item.notes || ""}
              onChange={(e) => itemChange({ notes: e.target.value })}
              maxLength={20000}
            />
          </label>
          <fieldset>
            <legend>담아둘 보드</legend>
            {data.boards.map((b) => (
              <label className="check" key={b.id}>
                <input
                  type="checkbox"
                  checked={item.boards.includes(b.id)}
                  onChange={(e) =>
                    itemChange({
                      boards: e.target.checked
                        ? [...item.boards, b.id]
                        : item.boards.filter((id) => id !== b.id),
                      sections: {},
                    })
                  }
                />
                {b.title}
              </label>
            ))}
          </fieldset>
          <button onClick={() => go("media")}>
            관련 영상 보기 <ArrowRight size={15} />
          </button>
        </aside>
      </div>
    </>
  );
}
function Media() {
  const [q, setQ] = useState(""),
    [id, setId] = useState(mediaSeed[0].id),
    [slide, setSlide] = useState(0),
    host = useRef<HTMLDivElement>(null),
    player = useRef<any>();
  const item = mediaSeed.find((r) => r.id === id),
    corpus = (window as any).MediaLibraryCorpus;
  const rows = q ? corpus.search(mediaSeed, q) : mediaSeed;
  useEffect(() => {
    setSlide(0);
    if (host.current)
      player.current = (window as any).MediaLibrarySavedMedia.mount(
        host.current,
        item,
        0,
        (index) => setSlide(index),
      );
    return () => {
      host.current?.querySelectorAll("video").forEach((v) => {
        v.pause();
        v.removeAttribute("src");
        v.load();
      });
    };
  }, [id]);
  return (
    <div className="media-layout">
      <section>
        <div className="panel-toolbar">
          <label className="search">
            <Search size={17} />
            <input
              aria-label="미디어 검색"
              placeholder="설명·자막 예시 검색…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <span className="count">{rows.length}개</span>
        </div>
        <div className="media-list">
          {rows.map((r) => (
            <button
              key={r.id}
              className={r.id === id ? "selected" : ""}
              onClick={() => setId(r.id)}
            >
              <img
                src={
                  r.assets.find(
                    (a) => a.role === "poster" || a.role === "image",
                  )?.src
                }
                alt=""
              />
              <span>
                <b>{r.title}</b>
                <small>{r.caption}</small>
              </span>
            </button>
          ))}
          {!rows.length && <p className="empty">검색 결과가 없습니다.</p>}
        </div>
      </section>
      <section className="media-view">
        <div key={id} ref={host} className="media-player" />
        <div className="media-caption">
          <p className="eyebrow">
            {item.kind === "video" ? "MOTION STUDY" : "IMAGE COLLECTION"} /{" "}
            {slide + 1} OF {item.knownMediaCount}
          </p>
          <h2>{item.title}</h2>
          <p>{item.caption}</p>
          <p className="fine">
            이 이미지·영상과 주석은 데모용으로 직접 만들었습니다. OCR·음성
            인식을 실행한 결과가 아닙니다.
          </p>
          <h3>장면으로 이동</h3>
          {(["asr", "ocr"] as const).flatMap(
            (kind) =>
              item.reading[kind]?.segments?.map((s, i) => (
                <button
                  className="segment"
                  key={kind + i}
                  onClick={() => player.current?.seek(s.ordinal, s.start)}
                >
                  <span>
                    {item.kind === "video"
                      ? `${s.start}초`
                      : `${s.ordinal + 1}번 이미지`}
                  </span>
                  {s.text}
                  <ArrowUpRight size={16} />
                </button>
              )) || [],
          )}
          <div className="reading-status">
            주석: 직접 작성 · 댓글: 수집하지 않음 · 원격 계정: 연결 없음
          </div>
        </div>
      </section>
    </div>
  );
}
class Boundary extends React.Component<any, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(e) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <div className="fatal">
        <h1>화면을 열지 못했습니다</h1>
        <p>{this.state.error}</p>
        <p>저장 자료는 지우지 않았습니다.</p>
        <button onClick={() => location.reload()}>다시 열기</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <App />
  </Boundary>,
);
