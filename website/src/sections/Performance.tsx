import SectionShell from "../components/SectionShell";
import { useInView, useCountUp } from "../hooks";
import { useLang } from "../i18n";
import { asset } from "../lib/asset";

export default function Performance() {
  const { t } = useLang();
  return (
    <SectionShell
      id="performance"
      title={t.performance.title}
      subtitle={t.performance.subtitle}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {t.performance.metrics.map((m) => (
          <Counter key={m.label} {...m} />
        ))}
      </div>

      {/* 仪表盘截图示例 */}
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <figure>
          <div className="screenshot max-h-[340px]">
            <img
              src={asset("screenshots/dashboard-light.png")}
              alt="Kimi Switch usage dashboard (light theme)"
              loading="lazy"
            />
          </div>
          <figcaption className="mt-2 text-center text-xs text-muted-foreground">
            {t.performance.lightCaption}
          </figcaption>
        </figure>
        <figure>
          <div className="screenshot max-h-[340px]">
            <img
              src={asset("screenshots/dashboard-dark.png")}
              alt="Kimi Switch usage dashboard (dark theme)"
              loading="lazy"
            />
          </div>
          <figcaption className="mt-2 text-center text-xs text-muted-foreground">
            {t.performance.darkCaption}
          </figcaption>
        </figure>
      </div>
    </SectionShell>
  );
}

function Counter({
  target,
  decimals = 0,
  suffix,
  label,
  desc,
}: {
  target: number;
  decimals?: number;
  suffix: string;
  label: string;
  desc: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const v = useCountUp(target, inView);
  return (
    <div ref={ref} className="card text-center">
      <div className="font-mono text-4xl font-bold tracking-[-0.03em] tabular-nums">
        {v.toFixed(decimals)}
        {suffix}
      </div>
      <div className="mt-2 text-sm font-medium">{label}</div>
      <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
    </div>
  );
}
