import SectionShell from "../components/SectionShell";
import { Database, LinkSimple, BookOpen, type Icon } from "@phosphor-icons/react";
import { useLang } from "../i18n";

const icons: Record<string, Icon> = {
  local: Database,
  direct: LinkSimple,
  open: BookOpen,
};

export default function Privacy() {
  const { t } = useLang();
  return (
    <SectionShell
      id="privacy"
      title={t.privacy.title}
      subtitle={t.privacy.subtitle}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {t.privacy.items.map((it) => {
          const Icon = icons[it.id] ?? Database;
          return (
            <div key={it.id} className="card">
              <div className="icon-chip mb-3">
                <Icon className="h-5 w-5" weight="duotone" />
              </div>
              <h3 className="mb-2 text-lg font-semibold tracking-tight">{it.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {it.desc}
              </p>
            </div>
          );
        })}
      </div>
    </SectionShell>
  );
}
