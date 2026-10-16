import { Cpu, HardDrive, Lightning } from "@phosphor-icons/react";
import SectionShell from "../components/SectionShell";
import { useCountUp, useInView } from "../hooks";
import { useLang } from "../i18n";

const icons = [HardDrive, Cpu, Lightning];

export default function Performance() {
  const { t } = useLang();
  return (
    <SectionShell
      id="performance"
      title={t.performance.title}
      subtitle={t.performance.subtitle}
    >
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-3">
        {t.performance.metrics.map((m, i) => (
          <Counter key={m.label} {...m} Icon={icons[i] ?? Cpu} />
        ))}
      </div>

      <p className="mt-6 flex max-w-prose items-start gap-2 text-sm text-muted-foreground">
        <Lightning className="mt-0.5 h-4 w-4 shrink-0 text-primary" weight="duotone" aria-hidden="true" />
        {t.performance.footNote}
      </p>
    </SectionShell>
  );
}

function Counter({
  target,
  decimals = 0,
  suffix,
  label,
  desc,
  Icon,
}: {
  target: number;
  decimals?: number;
  suffix: string;
  label: string;
  desc: string;
  Icon: typeof Cpu;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const v = useCountUp(target, inView);
  return (
    <div ref={ref} className="bg-card p-7 md:p-8">
      <Icon className="h-5 w-5 text-muted-foreground" weight="duotone" aria-hidden="true" />
      <div className="mt-5 font-mono text-4xl font-semibold tabular-nums tracking-tight md:text-[42px]">
        {v.toFixed(decimals)}
        <span className="text-2xl md:text-[26px]">{suffix}</span>
      </div>
      <div className="mt-3 text-sm font-medium">{label}</div>
      <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</div>
    </div>
  );
}
