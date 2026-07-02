import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages project sites are published below /<repository>/.
  // Keep the development server and non-Pages hosts at the root path.
  base: process.env.GITHUB_ACTIONS === "true" ? "/kakidas/" : "/",
  plugins: [react()],
});
