import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

/** Same storage key and vocabulary as the desktop app (`src/hooks/useTheme.ts`). */
const STORAGE_KEY = "kimi-switch-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function readStored(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "auto") return saved;
  } catch {
    /* storage blocked: fall back to the system preference */
  }
  return "auto";
}

function applyToDom(mode: ThemeMode): ResolvedTheme {
  const resolved = mode === "auto" ? systemTheme() : mode;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  document
    .getElementById("theme-color")
    ?.setAttribute("content", resolved === "dark" ? "#101216" : "#fafafb");
  return resolved;
}

const ThemeContext = createContext<{
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (m: ThemeMode) => void;
}>({ mode: "auto", resolved: "light", setMode: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStored);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => systemTheme());

  // The inline script in index.html already painted the right class; this only
  // re-syncs React state with what the DOM says after hydration.
  useEffect(() => {
    setResolved(applyToDom(mode));
  }, [mode]);

  // In auto mode the page follows the OS while it is open.
  useEffect(() => {
    if (mode !== "auto") return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => setResolved(applyToDom("auto"));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage blocked: the choice still applies for this session */
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
