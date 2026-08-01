/**
 * Resolve a public-asset path against Vite's base URL.
 * All site assets live under `/KimiSwitch/` in dev and on GitHub Pages,
 * so bare absolute paths like `/logos/x.svg` would 404 — always go through here.
 */
export const asset = (p: string) =>
  `${import.meta.env.BASE_URL}${p.replace(/^\/+/, "")}`;
