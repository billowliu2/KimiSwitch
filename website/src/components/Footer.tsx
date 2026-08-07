import { useEffect, useState } from "react";
import { recommendLinks } from "../data/recommendLinks";
import { useLang } from "../i18n";
import { asset } from "../lib/asset";

/** Map recommendLink.name → logo file in public/logos (only when we have one). */
const logoFor: Record<string, string> = {
  "Kimi": "logos/kimi.svg",
  "智谱 GLM": "logos/zhipu.svg",
  "DeepSeek": "logos/deepseek.svg",
  "OpenCodeGo": "logos/opencode.svg",
  "MiniMax": "logos/minimax.svg",
  "基元律动": "logos/tokenrhythm.svg",
};

// 下载统计：只拉 GitHub（公开 API 带 CORS），镜像站 Gitea 未开 CORS 不计入。
const STATS_URL =
  "https://api.github.com/repos/billowliu2/KimiSwitch/releases?per_page=100";
const STATS_CACHE_KEY = "kimi-switch-downloads";
const STATS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/** GitHub Release 全部资产 download_count 之和；拉取失败返回 null（不展示）。 */
function useDownloadCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    try {
      const cached = localStorage.getItem(STATS_CACHE_KEY);
      if (cached) {
        const { ts, total } = JSON.parse(cached) as { ts: number; total: number };
        if (Date.now() - ts < STATS_CACHE_TTL) {
          setCount(total);
          return;
        }
      }
    } catch {
      /* ignore corrupt cache */
    }
    fetch(STATS_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((releases: Array<{ assets?: Array<{ download_count?: number }> }>) => {
        if (cancelled) return;
        const total = (releases ?? []).reduce(
          (sum, rel) =>
            sum +
            (rel.assets ?? []).reduce((s, a) => s + (a.download_count ?? 0), 0),
          0
        );
        setCount(total);
        try {
          localStorage.setItem(
            STATS_CACHE_KEY,
            JSON.stringify({ ts: Date.now(), total })
          );
        } catch {
          /* ignore quota errors */
        }
      })
      .catch(() => {
        /* 拉取失败则不显示 */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return count;
}

export default function Footer() {
  const { t } = useLang();
  const downloadCount = useDownloadCount();
  return (
    <footer className="border-t border-border py-12">
      <div className="container-page space-y-8">
        {/* 推荐链接 */}
        <div>
          <h3 className="mb-4 text-sm font-semibold text-muted-foreground">
            {t.footer.recommend}
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recommendLinks.map((link) => {
              const logo = logoFor[link.name];
              const text = t.footer.recommendText[link.name] ?? "";
              return (
                <a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40"
                  style={{ boxShadow: "var(--shadow-soft)" }}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-white">
                    {logo ? (
                      <img
                        src={asset(logo)}
                        alt={`${link.name} logo`}
                        className="h-7 w-7 object-contain"
                      />
                    ) : (
                      <span className="text-base font-bold text-muted-foreground">
                        {link.name.slice(0, 1)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold tracking-tight group-hover:text-primary">
                      {link.name}
                    </div>
                    {text && (
                      <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                        {text}
                      </p>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        </div>

        {/* 版权与开源 */}
        <div className="flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <div>
            © 2026 Kimi Switch ·{" "}
            <a
              href="https://github.com/billowliu2/KimiSwitch"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              GitHub
            </a>{" "}
            ·{" "}
            <a
              href="https://git.codingplan.site/admin/KimiCodeSwitch"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              {t.footer.mirror}
            </a>{" "}
            · MIT License
          </div>
          <div className="text-xs opacity-80">
            {t.footer.creditBefore}
            <a
              href="https://github.com/JochenYang/kimicode-dashboard"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              kimicode-dashboard
            </a>
            {t.footer.creditAfter}
          </div>
        </div>

        {/* 下载统计（低调展示，仅 GitHub 下载量） */}
        {downloadCount !== null && (
          <p className="pt-1 text-center text-xs opacity-50">
            {t.footer.downloads.replace("{n}", downloadCount.toLocaleString())}
          </p>
        )}
      </div>
    </footer>
  );
}
