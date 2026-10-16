import { Link } from "react-router-dom";
import { ArrowRight, GithubLogo } from "@phosphor-icons/react";
import { useInView } from "../hooks";
import { useLang } from "../i18n";

export default function CTA() {
  const { t } = useLang();
  const [ref, inView] = useInView<HTMLDivElement>();

  return (
    <section id="cta" aria-labelledby="cta-title" className="relative pb-24 pt-8 md:pb-32">
      <div className="container-page">
        <div
          ref={ref}
          className={`relative overflow-hidden rounded-card border border-border bg-card px-7 py-12 transition-[opacity,transform] duration-[620ms] ease-reveal md:px-14 md:py-16 ${
            inView ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
          }`}
          style={{ boxShadow: "var(--shadow-lift), var(--shadow-inset)" }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/12 blur-3xl"
          />
          <div className="relative max-w-2xl">
            <h2 id="cta-title" className="text-section font-semibold">
              {t.cta.title}
            </h2>
            <p className="mt-4 text-base text-muted-foreground md:text-lg">{t.cta.subtitle}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/download" className="btn-primary">
                {t.cta.download}
                <ArrowRight className="h-4 w-4" weight="bold" />
              </Link>
              <a
                href="https://github.com/billowliu2/KimiSwitch"
                target="_blank"
                rel="noreferrer"
                className="btn-ghost"
              >
                <GithubLogo className="h-4 w-4" weight="duotone" />
                {t.cta.source}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
