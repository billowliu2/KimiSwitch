import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLang } from "../i18n";
import { asset } from "../lib/asset";

export default function Hero() {
  const { t } = useLang();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const reveal = (delay: number, extra = "") => ({
    style: { transitionDelay: `${delay}ms` },
    className: `transition-all duration-700 ease-out ${
      mounted
        ? "motion-safe:opacity-100 motion-safe:translate-y-0"
        : "motion-safe:opacity-0 motion-safe:translate-y-4"
    } ${extra}`,
  });

  return (
    <section
      id="hero"
      aria-labelledby="hero-title"
      className="relative overflow-hidden pt-16 pb-20 md:pt-24"
    >
      <div className="container-page relative grid grid-cols-1 gap-10 md:grid-cols-2 md:items-center">
        <div>
          <div {...reveal(0)}>
            <span className="inline-block rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium tracking-wide text-primary">
              {t.hero.badge}
            </span>
          </div>
          <h1
            id="hero-title"
            {...reveal(100, "mt-5 text-4xl font-bold leading-[1.05] tracking-[-0.03em] md:text-5xl lg:text-6xl")}
          >
            {t.hero.titleBefore}
            <br />
            <span className="whitespace-nowrap text-primary">
              {t.hero.titleAccent}
            </span>
            {t.hero.titleAfter}
          </h1>
          <p
            {...reveal(200, "mt-5 max-w-[52ch] text-base leading-relaxed text-muted-foreground md:text-lg")}
          >
            {t.hero.subtitle}
          </p>
          <div {...reveal(300, "mt-8 flex flex-wrap gap-3")}>
            <Link to="/download" className="btn-primary">
              {t.hero.download}
            </Link>
            <a
              href="https://github.com/billowliu2/KimiSwitch"
              target="_blank"
              rel="noreferrer"
              className="btn-ghost"
            >
              {t.hero.source}
            </a>
          </div>
          <dl {...reveal(400, "mt-10 flex gap-8 font-mono")}>
            {t.hero.stats.map((s) => (
              <div key={s.label}>
                <dt className="sr-only">{s.label}</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {s.value}
                </dd>
                <dd className="mt-1 text-xs text-muted-foreground">
                  {s.label}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div {...reveal(250)}>
          <div className="screenshot max-h-[420px]">
            <img
              src={asset("screenshots/hero.png")}
              alt="Kimi Switch provider list, active provider pinned to the top"
              loading="eager"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
