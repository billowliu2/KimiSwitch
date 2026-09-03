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
      {/* 三条承诺改为一个面板内的三行，图标左置，避免三张等宽卡片 */}
      <div className="card divide-y divide-border p-0">
        {t.privacy.items.map((it) => {
          const Icon = icons[it.id] ?? Database;
          return (
            <div key={it.id} className="flex items-start gap-5 p-6 md:p-7">
              <div className="icon-chip shrink-0">
                <Icon className="h-5 w-5" weight="duotone" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold tracking-tight">
                  {it.title}
                </h3>
                <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
                  {it.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </SectionShell>
  );
}
