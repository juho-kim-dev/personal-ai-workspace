import { useEffect, useState } from "react";
import init, { HwpDocument } from "../components/documents/engine/rhwp.js";
import {
  makeDocument,
  fingerprint,
  validateOutput,
} from "../components/documents/documents.mjs";
import { structure } from "../components/documents/structured.mjs";
import {
  structuredStage,
  structuredSnapshot,
} from "../components/documents/structured-snapshot.mjs";
import { download } from "./ui";
import DOMPurify from "dompurify";
let ready: Promise<any>;
export default function DocumentPane({
  report,
  notify,
}: {
  report: string;
  notify: (s: string) => void;
}) {
  const [bytes, setBytes] = useState<Uint8Array>(),
    [model, setModel] = useState<any>(),
    [target, setTarget] = useState("body:0"),
    [text, setText] = useState(""),
    [svg, setSvg] = useState(""),
    [busy, setBusy] = useState(true);
  function view(data: Uint8Array) {
    const doc = new HwpDocument(data);
    try {
      const s = structure(doc);
      const preview = DOMPurify.sanitize(doc.renderPageSvg(0), {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ["foreignObject"],
      });
      setModel(s);
      setTarget(s.paragraphs[0]?.target || "body:0");
      setText(s.paragraphs[0]?.text || "");
      setSvg(preview);
      setBytes(data);
    } finally {
      doc.free();
    }
  }
  useEffect(() => {
    let active = true;
    (ready ??= init({
      module_or_path: new URL("./engine/rhwp_bg.wasm", location.href),
    }))
      .then(() => {
        if (active) {
          view(makeDocument(true, "hwpx"));
          setBusy(false);
        }
      })
      .catch((e) => {
        if (active) {
          notify(e.message);
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(fn: () => void | Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  function replace() {
    return run(() => {
      const p = model.paragraphs.find((p) => p.target === target);
      const staged = structuredStage(HwpDocument, bytes, [
        { type: "replace", target, start: 0, end: [...p.text].length, text },
      ]);
      view(staged.bytes);
      notify("문단을 수정하고 HWPX로 다시 읽었습니다.");
    });
  }
  function save() {
    return run(() => {
      const doc = new HwpDocument(bytes);
      try {
        const expected = fingerprint(doc),
          snapshot = structuredSnapshot(doc),
          check = validateOutput(snapshot.bytes, expected);
        if (
          !check.textPreserved ||
          !check.stylesPreserved ||
          !check.tablesPreserved
        )
          throw Error("다시 열기 검증 실패. 다운로드를 중단했습니다.");
        download("exhibition.hwpx", snapshot.bytes, "application/hwp+zip");
        notify(
          `HWPX 검증 완료 · ${check.pageCount}쪽 · ${check.cellCount}개 표 셀`,
        );
      } finally {
        doc.free();
      }
    });
  }
  return (
    <div className="document-layout">
      <section className="document-controls">
        <p className="eyebrow">STRUCTURED DOCUMENT</p>
        <h2>생각을 문서로</h2>
        <p className="muted">
          실제 HWPX 엔진으로 문단과 표 셀을 편집합니다. 오른쪽은 엔진이 그린 첫
          페이지입니다.
        </p>
        <label>
          편집 위치
          <select
            disabled={!model || busy}
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setText(
                model.paragraphs.find((p) => p.target === e.target.value).text,
              );
            }}
          >
            {model?.paragraphs.map((p) => (
              <option key={p.target} value={p.target}>
                {p.target.startsWith("cell") ? "표 셀" : "본문"} · {p.target} ·{" "}
                {p.text.slice(0, 18)}
              </option>
            ))}
          </select>
        </label>
        <label>
          문단 내용
          <input
            disabled={!bytes || busy}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={100000}
          />
        </label>
        <div className="actions">
          <button
            className="primary"
            disabled={!bytes || busy}
            onClick={replace}
          >
            문단 적용
          </button>
          <button
            disabled={!bytes || busy}
            onClick={() =>
              setText(
                report
                  .replace(/^#+\s*/gm, "")
                  .replace(/\s+/g, " ")
                  .trim(),
              )
            }
          >
            보고서 본문 가져오기
          </button>
        </div>
        <hr />
        <div className="actions">
          <button disabled={!bytes || busy} onClick={save}>
            HWPX 검증 후 내려받기
          </button>
          <button
            disabled={!bytes || busy}
            onClick={() =>
              run(() => {
                const p = model.paragraphs.find((p) => p.target === "body:0");
                view(
                  structuredStage(HwpDocument, bytes, [
                    {
                      type: "create_table",
                      target: "body:0",
                      start: [...p.text].length,
                      rows: 2,
                      columns: 2,
                    },
                  ]).bytes,
                );
                notify("2 × 2 표를 추가했습니다.");
              })
            }
          >
            표 추가
          </button>
        </div>
        <label className="file-label">
          이 데모에서 저장한 HWPX 다시 열기
          <input
            type="file"
            accept=".hwpx"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f)
                run(async () => {
                  if (f.size > 10 * 1024 * 1024)
                    throw Error("10MB 이하 HWPX를 선택하세요.");
                  view(new Uint8Array(await f.arrayBuffer()));
                  notify("선택한 문서를 브라우저 안에서 열었습니다.");
                });
            }}
          />
        </label>
        <p className="fine">
          서버로 업로드하지 않습니다. 문서 편집 내용은 이 화면을 떠나면
          초기화되므로 먼저 내려받으세요. 지원 범위: 첫 섹션 본문과 직접 표 셀.
          모든 한글 문서의 호환성을 보장하지 않습니다.
        </p>
      </section>
      <section className="paper-frame" aria-label="문서 첫 페이지 미리보기">
        {busy && !svg ? (
          <p role="status">문서 엔진을 여는 중…</p>
        ) : (
          <div className="paper" dangerouslySetInnerHTML={{ __html: svg }} />
        )}
      </section>
    </div>
  );
}
