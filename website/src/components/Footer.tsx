import { recommendLinks } from "../data/recommendLinks";
import { useLang } from "../i18n";
import { asset } from "../lib/asset";

/** Map recommendLink.name → logo file in public/logos (only when we have one). */
const logoFor: Record<string, string> = {
  "Kimi": "logos/kimi.svg",
  "智谱 GLM": "logos/glm.svg",
  "DeepSeek": "logos/deepseek.svg",
  "OpenCodeGo": "logos/opencode.svg",
  "MiniMax": "logos/minimax.svg",
  "基元律动": "logos/tokenrhythm.svg",
};

export default function Footer() {
  const { t } = useLang();
  return (
    <footer className="border-t border-border py-12">
      <div className="container-page space-y-8">
        {/* 推荐链接 */}
        <div>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
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
                  className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-white">
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
                    <div className="font-semibold group-hover:text-primary">
                      {link.name}
                    </div>
                    {text && (
                      <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
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
      </div>
    </footer>
  );
}
