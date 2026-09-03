import SectionShell from "../components/SectionShell";
import { useInView } from "../hooks";
import { useLang } from "../i18n";
import { asset } from "../lib/asset";

export default function Showcase() {
  const { t } = useLang();
  const [gridRef, gridInView] = useInView<HTMLDivElement>();
  return (
    <SectionShell
      id="showcase"
      title={t.showcase.title}
      subtitle={t.showcase.subtitle}
    >
      <div
        ref={gridRef}
        className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        {t.showcase.items.map((s, i) => (
          <figure
            key={s.src}
            style={{ transitionDelay: `${i * 60}ms` }}
            className={`transition-all duration-500 ease-out ${
              i === 0 ? "sm:col-span-2" : ""
            } ${
              gridInView
                ? "motion-safe:opacity-100 motion-safe:translate-y-0"
                : "motion-safe:opacity-0 motion-safe:translate-y-4"
            }`}
          >
            <div
              className={`screenshot group overflow-hidden ${
                i === 0 ? "aspect-[16/9]" : "aspect-[4/3]"
              }`}
            >
              <img
                src={asset(s.src)}
                alt={`Kimi Switch - ${s.title}`}
                loading="lazy"
                className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
              />
            </div>
            <figcaption className="mt-3">
              <div className="text-sm font-semibold">{s.title}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">{s.desc}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </SectionShell>
  );
}
