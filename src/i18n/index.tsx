import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { enTranslations } from "./en";
import { zhTranslations, type TranslationKey } from "./zh";

export type Language = "zh" | "en";

const translations = {
  zh: zhTranslations,
  en: enTranslations,
};

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
}

function interpolatePositional(template: string, args: string[]): string {
  return template.replace(/\{(\d+)\}/g, (_, index) => args[Number(index)] ?? `{${index}}`);
}

interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  tv: (code: string, args: string[]) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "kimi-switch-lang";

function getInitialLang(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Language | null;
    if (stored === "zh" || stored === "en") return stored;
  } catch {
    // ignore
  }
  const browser = navigator.language.toLowerCase();
  return browser.startsWith("zh") ? "zh" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(getInitialLang);

  const setLang = (next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const t = (key: TranslationKey, params?: Record<string, string | number>) => {
    const template = translations[lang][key];
    return interpolate(template ?? key, params);
  };

  const tv = (code: string, args: string[]) => {
    const template = translations[lang][code as TranslationKey];
    return interpolatePositional(template ?? code, args);
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t, tv }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within I18nProvider");
  }
  return ctx;
}
