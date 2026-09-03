import { Link } from "react-router-dom";
import { useLang } from "../i18n";

export default function CTA() {
  const { t } = useLang();
  return (
    <section
      id="cta"
      aria-labelledby="cta-title"
      className="pt-20 pb-28"
    >
      <div className="container-page">
        {/* 左对齐 + 内容错位：不再整块居中 */}
        <div className="card relative max-w-3xl p-10 md:p-14">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px bg-primary/25"
          />
          <h2
            id="cta-title"
            className="text-3xl font-bold tracking-[-0.03em] md:text-4xl"
          >
            {t.cta.title}
          </h2>
          <p className="mt-4 max-w-[52ch] text-base text-muted-foreground md:text-lg">
            {t.cta.subtitle}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
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
    </section>
  );
}
