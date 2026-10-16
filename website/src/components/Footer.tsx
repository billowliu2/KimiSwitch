import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, GithubLogo } from "@phosphor-icons/react";
import { recommendLinks } from "../data/recommendLinks";
import { useLang, VERSION_TAG } from "../i18n";
import { asset } from "../lib/asset";

/** Map recommendLink.name → logo file in public/logos (only when we have one). */
const logoFor: Record<string, string> = {
  Kimi: "logos/kimi.svg",
  "智谱 GLM": "logos/zhipu.svg",
  DeepSeek: "logos/deepseek.svg",
  OpenCodeGo: "logos/opencode.svg",
  MiniMax: "logos/minimax.svg",
  基元律动: "logos/tokenrhythm.svg",
};

// 下载统计：只拉 GitHub（公开 API 带 CORS），镜像站 Gitea 未开 CORS 不计入。
const STATS_URL = "https://api.github.com/repos/billowliu2/KimiSwitch/releases?per_page=100";
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
          (sum, rel) => sum + (rel.assets ?? []).reduce((s, a) => s + (a.download_count ?? 0), 0),
          0,
        );
        setCount(total);
        try {
          localStorage.setItem(STATS_CACHE_KEY, JSON.stringify({ ts: Date.now(), total }));
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

  const productLinks = [
    { to: "/features", label: t.nav.features },
    { to: "/changelog", label: t.nav.changelog },
    { to: "/download", label: t.nav.download },
  ];

  const resourceLinks = [
    { href: "https://github.com/billowliu2/KimiSwitch", label: "GitHub" },
    { href: "https://github.com/billowliu2/KimiSwitch/issues", label: "Issues" },
    { href: "https://git.codingplan.site/admin/KimiCodeSwitch/releases", label: t.footer.mirror },
    { href: "https://github.com/MoonshotAI/kimi-code", label: "Kimi Code CLI" },
    { href: "https://models.dev", label: "models.dev" },
  ];

  return (
    <footer className="border-t border-border">
      <div className="container-page py-14">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[minmax(0,1fr)_auto_auto] md:gap-16">
          <div className="max-w-sm">
            <Link to="/" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
              <img src={asset("kimi.svg")} alt="" className="h-7 w-7 rounded-lg" />
              <span>Kimi Switch</span>
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {t.footer.blurb}
            </p>
            <p className="mt-4 font-mono text-xs text-muted-foreground">
              {VERSION_TAG} · MIT
              {downloadCount !== null && ` · ${t.footer.downloads.replace("{n}", downloadCount.toLocaleString())}`}
            </p>
          </div>

          <nav aria-label={t.footer.product}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t.footer.product}
            </h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              {productLinks.map((l) => (
                <li key={l.to}>
                  <Link
                    to={l.to}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label={t.footer.resources}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t.footer.resources}
            </h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              {resourceLinks.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {l.label}
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-12 border-t border-border pt-8">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t.footer.recommend}
          </h3>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recommendLinks.map((link) => {
              const logo = logoFor[link.name];
              const text = t.footer.recommendText[link.name] ?? "";
              return (
                <a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40"
                  style={{ boxShadow: "var(--shadow-soft), var(--shadow-inset)" }}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-white">
                    {logo ? (
                      <img src={asset(logo)} alt="" className="h-7 w-7 object-contain" />
                    ) : (
                      <span className="text-base font-bold text-muted-foreground">
                        {link.name.slice(0, 1)}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 font-semibold tracking-tight transition-colors group-hover:text-primary">
                      {link.name}
                      <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                    {text && (
                      <span className="mt-1 line-clamp-3 block text-xs leading-relaxed text-muted-foreground">
                        {text}
                      </span>
                    )}
                  </span>
                </a>
              );
            })}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
          <div>
            © 2026 Kimi Switch · MIT License ·{" "}
            <a
              href="https://github.com/billowliu2/KimiSwitch"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline decoration-border underline-offset-4 hover:text-foreground"
            >
              <GithubLogo className="h-3.5 w-3.5" />
              billowliu2/KimiSwitch
            </a>
          </div>
          <div>
            {t.footer.creditBefore}
            <a
              href="https://github.com/JochenYang/kimicode-dashboard"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-border underline-offset-4 hover:text-foreground"
            >
              kimicode-dashboard
            </a>
            {t.footer.creditAfter}
          </div>
        </div>
      </div>
    </footer>
  );
}
