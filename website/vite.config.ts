import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * GitHub Pages SPA fallback: any deep path (e.g. /KimiSwitch/features) is
 * served by 404.html; duplicating the built index.html there lets the
 * BrowserRouter boot and render the right route. This keeps every page
 * indexable as a real URL instead of a `#/` fragment.
 */
function generate404(): Plugin {
  return {
    name: "generate-404",
    apply: "build",
    closeBundle() {
      const dist = fileURLToPath(new URL("./dist", import.meta.url));
      copyFileSync(`${dist}/index.html`, `${dist}/404.html`);
    },
  };
}

// GitHub Pages subpath: billowliu2.github.io/KimiSwitch/
export default defineConfig({
  base: "/KimiSwitch/",
  plugins: [react(), generate404()],
  resolve: {
    alias: { "@": "/src" },
  },
});
