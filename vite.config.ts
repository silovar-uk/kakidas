import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const runtime = globalThis as {
  process?: { env?: { GITHUB_ACTIONS?: string } };
};

export default defineConfig({
  // GitHub Pages project sites are published below /<repository>/.
  // Keep the development server and non-Pages hosts at the root path.
  base: runtime.process?.env?.GITHUB_ACTIONS === "true" ? "/kakidas/" : "/",
  plugins: [react()],
});
