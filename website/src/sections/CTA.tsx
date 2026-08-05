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
        <div className="card relative overflow-hidden p-12 text-center md:p-16">
          {/* 克制同色系光晕 + 顶部强调线（去紫，保持页面调性） */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[480px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
          />
          <div className="relative">
            <h2
              id="cta-title"
              className="text-3xl font-bold tracking-[-0.03em] md:text-5xl"
            >
              {t.cta.title}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground md:text-lg">
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
