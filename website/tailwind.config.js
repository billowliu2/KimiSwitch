/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--foreground) / <alpha-value>)",
        },
        border: "hsl(var(--border) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        // Kimi purple: the second half of the brand accent pair. Used for
        // icon tints and the hero glyph only, never as a second CTA color.
        violet: {
          DEFAULT: "hsl(var(--violet) / <alpha-value>)",
          foreground: "hsl(var(--violet-foreground) / <alpha-value>)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
      },
      borderRadius: {
        // Two-tier shape lock: interactive = lg (8px), container = 2xl (16px).
        card: "1rem",
        frame: "0.875rem",
      },
      fontFamily: {
        sans: [
          "Geist",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          "sans-serif",
        ],
        mono: ['"Fira Code"', "ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
      },
      fontSize: {
        display: ["clamp(2.4rem, 6vw, 4.25rem)", { lineHeight: "1.03", letterSpacing: "-0.035em" }],
        section: ["clamp(1.75rem, 3.4vw, 2.5rem)", { lineHeight: "1.12", letterSpacing: "-0.03em" }],
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        lift: "var(--shadow-lift)",
        inset: "var(--shadow-inset)",
      },
      maxWidth: {
        prose: "65ch",
      },
      transitionTimingFunction: {
        reveal: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        drift: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(0,-2.5%,0) scale(1.04)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.5s ease-out both",
        drift: "drift 18s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
