import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Visible in browser console — easier to diagnose than a runtime crash deep in a fetch.
  console.error(
    "Supabase env vars are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY " +
      "in Render (Static Site → Environment) and rebuild.",
  );
}

export const supabase: SupabaseClient = createClient(url ?? "", anonKey ?? "", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const FIXES_BUCKET = "fixes";
