import { useRef, useState } from "react";
import { api } from "../api/client";
import type { UploadResult } from "../types";

export function FileUpload({ onDone }: { onDone: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [driveUrl, setDriveUrl] = useState("");
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
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

  async function importDrive() {
    if (!driveUrl.trim()) return;
    setDriveBusy(true);
    setDriveError(null);
    try {
      const r = await api.importDriveFolder(driveUrl.trim());
      setResults(r);
      onDone();
    } catch (e: unknown) {
      setDriveError(e instanceof Error ? e.message : String(e));
    } finally {
      setDriveBusy(false);
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
      <div style={{ marginTop: "1rem", padding: "0.75rem", border: "1px solid #d0d7de", borderRadius: "6px", background: "#f6f8fa" }}>
        <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.95rem" }}>📁 Google Drive フォルダから一括取り込み</h3>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.78rem", color: "#57606a" }}>
          フォルダの共有設定を「<strong>リンクを知っている全員</strong>」にしてからURLを貼ってください。
          フォルダ内の <code>.igc</code> ファイル全てを取り込みます。
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            type="url"
            value={driveUrl}
            onChange={(e) => setDriveUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/..."
            style={{ flex: "1 1 280px", minWidth: 0 }}
            disabled={driveBusy}
          />
          <button onClick={importDrive} disabled={driveBusy || !driveUrl.trim()}>
            {driveBusy ? "取り込み中..." : "取り込み"}
          </button>
        </div>
        {driveError && (
          <div style={{ marginTop: "0.4rem", color: "#cf222e", fontSize: "0.82rem" }}>
            ✗ {driveError}
          </div>
        )}
        {driveBusy && (
          <div style={{ marginTop: "0.4rem", fontSize: "0.78rem", color: "#57606a" }}>
            Drive からダウンロード中... ファイル数によっては時間がかかります
          </div>
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
