import { useEffect, useState } from "react";
import {
  type AuthState,
  ensureSession,
  onAuthChange,
  sendMagicLink,
  signOut,
} from "../lib/storage/auth";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const unsub = onAuthChange(setState);
    void ensureSession();
    return unsub;
  }, []);

  if (state.status === "loading") {
    return <div style={{ padding: "2rem", textAlign: "center" }}>読み込み中…</div>;
  }
  if (state.status === "error") {
    return (
      <div className="card" style={{ margin: "2rem", color: "#cf222e" }}>
        認証エラー: {state.message}
      </div>
    );
  }
  if (state.status === "signed-out") {
    return (
      <div className="card" style={{ margin: "2rem" }}>
        サインインを準備しています…
      </div>
    );
  }

  return (
    <>
      <AuthBar user={state.user} isAnonymous={state.isAnonymous} />
      {children}
    </>
  );
}

function AuthBar({
  user,
  isAnonymous,
}: {
  user: { email?: string | null; id: string };
  isAnonymous: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!email.trim()) return;
    setBusy(true);
    setMsg(null);
    const r = await sendMagicLink(email.trim());
    setBusy(false);
    setMsg(r.message);
  }

  if (!isAnonymous && user.email) {
    return (
      <div
        style={{
          padding: "0.4rem 0.8rem",
          fontSize: "0.78rem",
          background: "#f6f8fa",
          borderBottom: "1px solid #d0d7de",
          display: "flex",
          gap: "0.8rem",
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        <span>👤 {user.email}</span>
        <button
          onClick={() => void signOut()}
          style={{ fontSize: "0.78rem", padding: "0.1rem 0.5rem" }}
        >
          サインアウト
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "0.5rem 0.8rem",
        fontSize: "0.78rem",
        background: "#fff8c5",
        borderBottom: "1px solid #d0d7de",
      }}
    >
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <span>📱 ゲストモード — この端末だけのデータです。</span>
        <button onClick={() => setOpen((v) => !v)} style={{ fontSize: "0.78rem", padding: "0.1rem 0.5rem" }}>
          {open ? "閉じる" : "別端末と同期する"}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            style={{ flex: "1 1 240px", minWidth: 0 }}
          />
          <button onClick={send} disabled={busy || !email.trim()}>
            {busy ? "送信中…" : "ログインリンクを送る"}
          </button>
        </div>
      )}
      {msg && <div style={{ marginTop: "0.4rem" }}>{msg}</div>}
    </div>
  );
}
