import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "kimi-switch-theme";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === "light" || stored === "dark" || stored === "auto") return stored;
  } catch {
    // ignore
  }
  return "auto";
}

function applyTheme(theme: Theme): ResolvedTheme {
  const resolved: ResolvedTheme = theme === "auto" ? getSystemTheme() : theme;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  return resolved;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => applyTheme(getInitialTheme()));

  // Apply theme on change
  useEffect(() => {
    const resolved = applyTheme(theme);
    setResolvedTheme(resolved);
  }, [theme]);

  // Listen to system theme changes when in "auto" mode
  useEffect(() => {
    if (theme !== "auto") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const resolved = applyTheme("auto");
      setResolvedTheme(resolved);
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  return { theme, resolvedTheme, setTheme };
}
