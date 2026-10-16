import { BookOpen, Database, LinkSimple, type Icon } from "@phosphor-icons/react";
import SectionShell from "../components/SectionShell";
import { useInView } from "../hooks";
import { useLang } from "../i18n";

const icons: Record<string, Icon> = {
  local: Database,
  direct: LinkSimple,
  open: BookOpen,
};

export default function Privacy() {
  const { t } = useLang();
  const [ref, inView] = useInView<HTMLDivElement>();

  return (
    <SectionShell id="privacy" title={t.privacy.title} subtitle={t.privacy.subtitle}>
      <div
        ref={ref}
        className={`reveal grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8 ${
          inView ? "reveal-on" : "reveal-off"
        }`}
      >
        {t.privacy.items.map((it, i) => {
          const Icon = icons[it.id] ?? Database;
          return (
            <div
              key={it.id}
              style={{ transitionDelay: `${i * 80}ms` }}
              className={`border-t border-border pt-6 ${
                inView ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
              } transition-[opacity,transform] duration-[620ms] ease-reveal`}
            >
              <Icon className="h-5 w-5 text-primary" weight="duotone" aria-hidden="true" />
              <h3 className="mt-4 text-base font-semibold tracking-tight">{it.title}</h3>
              <p className="mt-2 max-w-[42ch] text-sm leading-relaxed text-muted-foreground">
                {it.desc}
              </p>
            </div>
          );
        })}
      </div>
    </SectionShell>
  );
}
