/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["class", ".dark"],
  theme: {
    extend: {
      colors: {
        app: "var(--bg-app)",
        panel: "var(--bg-panel)",
        input: "var(--bg-input)",
        hover: {
          DEFAULT: "var(--bg-hover)",
          2: "var(--bg-hover-2)",
        },
        footer: "var(--bg-footer)",
        "cell-empty": "var(--bg-cell-empty)",
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        content: {
          primary: "var(--text-primary)",
          muted: "var(--text-muted)",
        },
      },
    },
  },
  plugins: [],
};
