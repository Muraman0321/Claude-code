import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type AuthState =
  | { status: "loading" }
  | { status: "signed-in"; user: User; isAnonymous: boolean }
  | { status: "signed-out" }
  | { status: "error"; message: string };

export async function getCurrentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

/** Ensure there is a session. If none, sign in anonymously so the user can start using the app immediately. */
export async function ensureSession(): Promise<Session | null> {
  const existing = await getCurrentSession();
  if (existing) return existing;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error("anonymous sign-in failed:", error);
    return null;
  }
  return data.session ?? null;
}

/** Send a magic-link email so the same anonymous device can be paired with a permanent identity. */
export async function sendMagicLink(email: string): Promise<{ ok: boolean; message: string }> {
  // Use VITE_APP_URL for production (e.g., Render.com), fall back to window.location for local dev
  const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin;
  const redirectUrl = baseUrl + window.location.pathname;

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectUrl },
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "メールを送りました。リンクを開いて続行してください。" };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export function onAuthChange(cb: (state: AuthState) => void): () => void {
  const emit = (session: Session | null) => {
    if (!session) {
      cb({ status: "signed-out" });
      return;
    }
    cb({
      status: "signed-in",
      user: session.user,
      isAnonymous: session.user.is_anonymous ?? false,
    });
  };

  void getCurrentSession().then(emit);
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => emit(session));
  return () => sub.subscription.unsubscribe();
}
