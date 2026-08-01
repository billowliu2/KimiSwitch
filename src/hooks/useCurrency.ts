import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../i18n";
import { fmtUsd } from "../lib/dashboard-format";

/**
 * USD → CNY exchange rate for the dashboard.
 * Chinese mode shows prices in CNY (latest available rate), English stays in
 * USD. The rate is fetched once and cached in localStorage for 12h; any
 * failure falls back to a conservative fixed rate so the UI never blocks.
 */

const FALLBACK_RATE = 7.2;
const CACHE_KEY = "kimi-switch-cny-rate";
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

function readCachedRate(): number | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, rate } = JSON.parse(raw) as { ts: number; rate: number };
    if (Date.now() - ts > CACHE_TTL || !(rate > 1)) return null;
    return rate;
  } catch {
    return null;
  }
}

function writeCachedRate(rate: number) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), rate }));
  } catch {
    /* ignore */
  }
}

export function useCurrency() {
  const { lang } = useTranslation();
  const [rate, setRate] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = readCachedRate();
      if (cached) {
        setRate(cached);
        return;
      }
      try {
        const res = await fetch("https://open.er-api.com/v6/latest/USD");
        if (res.ok) {
          const data = (await res.json()) as { rates?: { CNY?: number } };
          const cny = Number(data.rates?.CNY);
          if (cny > 1) {
            if (!cancelled) setRate(cny);
            writeCachedRate(cny);
            return;
          }
        }
      } catch {
        /* network blocked → fallback */
      }
      if (!cancelled) setRate(FALLBACK_RATE);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Format a USD cost for display: CNY in Chinese mode, USD otherwise. */
  const money = useCallback(
    (usd: number): string => {
      if (lang !== "zh") return fmtUsd(usd);
      const v = (Number(usd) || 0) * (rate ?? FALLBACK_RATE);
      if (v === 0) return "¥0.00";
      if (v < 0.1) return "¥" + v.toFixed(3);
      if (v < 1) return "¥" + v.toFixed(2);
      return "¥" + v.toFixed(2);
    },
    [lang, rate],
  );

  return { money, cnyRate: rate ?? FALLBACK_RATE };
}
