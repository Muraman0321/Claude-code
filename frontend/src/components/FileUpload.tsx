import { useRef, useState } from "react";
import { api } from "../api/client";
import type { UploadResult } from "../types";

export function FileUpload({ onDone }: { onDone: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | File[]) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const r = await api.upload(files);
      setResults(r);
      onDone();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setResults([{ filename: "(upload)", success: false, flight_id: null, error: msg }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>IGCファイルをアップロード</h2>
      <div
        className={`upload-area ${dragging ? "dragging" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".igc"
          multiple
          style={{ display: "none" }}
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        {busy ? (
          <span>アップロード中...</span>
        ) : (
          <>
            <div style={{ fontSize: "1rem", marginBottom: "0.4rem" }}>
              ここにドラッグ&ドロップ、またはクリックで選択
            </div>
            <div style={{ fontSize: "0.8rem", color: "#57606a" }}>
              形式: <code>yy.mm.dd_&lt;機体&gt;_&lt;選手&gt;_&lt;備考&gt;.igc</code>
            </div>
          </>
        )}
      </div>
      {results.length > 0 && (
        <div className="upload-results">
          {results.map((r, i) => (
            <div key={`${r.filename}_${i}`} className={r.success ? "ok" : "fail"} style={{ marginBottom: "0.35rem" }}>
              {r.success ? "✓" : "✗"} <code>{r.filename}</code>
              {r.error && <span> — {r.error}</span>}
              {r.normalized_from && (
                <div style={{ fontSize: "0.78rem", color: "#9a6700", marginLeft: "1.2rem" }}>
                  ↺ 元: <code>{r.normalized_from}</code>
                  {r.normalization_notes && r.normalization_notes.length > 0 && (
                    <> ({r.normalization_notes.join(" / ")})</>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
