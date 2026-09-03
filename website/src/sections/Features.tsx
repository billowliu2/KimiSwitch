import SectionShell from "../components/SectionShell";
import { useInView } from "../hooks";
import { useLang } from "../i18n";
import { asset } from "../lib/asset";
import {
  Stack,
  PlusCircle,
  Gauge,
  ChatsCircle,
  Key,
  SlidersHorizontal,
  MagnifyingGlass,
  DownloadSimple,
  type Icon,
} from "@phosphor-icons/react";

const icons: Record<string, Icon> = {
  "multi-provider": Stack,
  "custom-provider": PlusCircle,
  usage: Gauge,
  sessions: ChatsCircle,
  "kimi-auth": Key,
  "usage-config": SlidersHorizontal,
  "model-discovery": MagnifyingGlass,
  "auto-update": DownloadSimple,
};

export default function Features() {
  const { t } = useLang();
  const [gridRef, gridInView] = useInView<HTMLDivElement>();
  return (
    <SectionShell
      id="features"
      title={t.features.title}
      subtitle={t.features.subtitle}
    >
      <div
        ref={gridRef}
        className="grid grid-cols-1 gap-6 sm:grid-cols-2"
      >
        {t.features.items.map((f, i) => {
          const Icon = icons[f.id] ?? Stack;
          return (
            <div
              key={f.id}
              style={{ transitionDelay: `${i * 60}ms` }}
              className={`card overflow-hidden p-0 transition-all duration-500 ease-out hover:border-primary/50 ${
                i % 2 === 1 ? "sm:mt-12" : ""
              } ${
                gridInView
                  ? "motion-safe:opacity-100 motion-safe:translate-y-0"
                  : "motion-safe:opacity-0 motion-safe:translate-y-4"
              }`}
            >
              <div className="border-b border-border bg-muted">
                <img
                  src={asset(f.img)}
                  alt={`Kimi Switch - ${f.title}`}
                  loading="lazy"
                  className="aspect-[16/9] w-full object-cover object-top"
                />
              </div>
              <div className="p-6">
                <div className="icon-chip mb-3">
                  <Icon className="h-5 w-5" weight="duotone" />
                </div>
                <h3 className="mb-2 text-lg font-semibold tracking-tight">{f.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {f.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </SectionShell>
  );
}
