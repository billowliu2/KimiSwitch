import { Link } from "react-router-dom";
import { useLang } from "../i18n";

export default function CTA() {
  const { t } = useLang();
  return (
    <section
      id="cta"
      aria-labelledby="cta-title"
      className="py-24"
    >
      <div className="container-page">
        <div className="relative overflow-hidden rounded-xl border border-primary/25 bg-gradient-to-r from-primary/10 via-primary/5 to-violet-500/10 p-12 text-center md:p-16">
          {/* 科技风光晕 */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[480px] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
          />
          <div className="relative">
            <h2
              id="cta-title"
              className="text-3xl font-bold tracking-tight md:text-5xl"
            >
              {t.cta.title}
            </h2>
            <p className="mt-4 text-base text-muted-foreground md:text-lg">
              {t.cta.subtitle}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/download" className="btn-primary">
                {t.cta.download}
              </Link>
              <a
                href="https://github.com/billowliu2/KimiSwitch"
                target="_blank"
                rel="noreferrer"
                className="btn-ghost"
              >
                {t.cta.source}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
