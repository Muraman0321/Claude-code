import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Set VITE_BASE_PATH (e.g. "/glider/") at build time to mount the app under
// a sub-path. Defaults to "/" for local dev / root-domain deployments.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_BASE_PATH || "/";
  const trimmed = base.replace(/\/$/, ""); // "" or "/glider"
  const apiPrefix = trimmed + "/api";

  return {
    base,
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // In dev the backend is at localhost:8000 with no BASE_PATH, so strip
        // the sub-path prefix before forwarding.
        [apiPrefix]: {
          target: "http://localhost:8000",
          rewrite: (path) => (trimmed ? path.replace(trimmed, "") : path),
        },
      },
    },
  };
});
