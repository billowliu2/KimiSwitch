import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages subpath: billowliu2.github.io/KimiSwitch/
export default defineConfig({
  base: "/KimiSwitch/",
  plugins: [react()],
  resolve: {
    alias: { "@": "/src" },
  },
});