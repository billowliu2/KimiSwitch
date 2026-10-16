import { Link } from "react-router-dom";
import { GithubLogo } from "@phosphor-icons/react";
import { useLang } from "../i18n";
import WindowFrame from "../components/WindowFrame";

export default function Hero() {
  const { t } = useLang();

  return (
    <section id="hero" aria-labelledby="hero-title" className="relative overflow-hidden pt-14 md:pt-20">
      <div className="halo" aria-hidden="true" />

      <div className="container-page">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
          <div className="animate-fade-in">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              {t.hero.badge}
            </p>

            <h1
              id="hero-title"
              className="mt-5 text-display font-bold"
            >
              <span className="block">{t.hero.titleBefore}</span>
              <span className="block text-primary">
                {t.hero.titleAccent}
                {t.hero.titleAfter}
              </span>
            </h1>

            <p className="mt-6 max-w-prose text-base leading-relaxed text-muted-foreground md:text-lg">
              {t.hero.subtitle}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/download" className="btn-primary">
                {t.hero.download}
              </Link>
              <a
                href="https://github.com/billowliu2/KimiSwitch"
                target="_blank"
                rel="noreferrer"
                className="btn-ghost"
              >
                <GithubLogo className="h-4 w-4" weight="duotone" />
                {t.hero.secondary}
              </a>
            </div>
          </div>

          <div className="animate-fade-in lg:-mr-6">
            <WindowFrame
              src="screenshots/v084/providers-dark.png"
              alt={t.hero.imageAlt}
              title={t.showcase.tabs[0].tab}
              priority
            />
          </div>
        </div>

        {/* Facts strip: hairline-divided, not four more cards. */}
        <dl className="mt-16 grid grid-cols-2 gap-y-8 border-t border-border pt-8 md:mt-20 md:grid-cols-4 md:divide-x md:divide-border">
          {t.facts.items.map((f) => (
            <div key={f.label} className="md:px-6 md:first:pl-0 md:last:pr-0">
              <dd className="font-mono text-2xl font-semibold tabular-nums tracking-tight md:text-3xl">
                {f.value}
              </dd>
              <dt className="mt-1.5 text-sm font-medium">{f.label}</dt>
              <dd className="mt-0.5 text-xs text-muted-foreground">{f.desc}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
