import type { Icon } from "@phosphor-icons/react";
import {
  ChatsCircle,
  DownloadSimple,
  Gauge,
  Key,
  MagnifyingGlass,
  Monitor,
  PlusCircle,
  Stack,
} from "@phosphor-icons/react";
import SectionShell from "../components/SectionShell";
import { useInView } from "../hooks";
import { useLang } from "../i18n";

const icons: Record<string, Icon> = {
  "multi-provider": Stack,
  "custom-provider": PlusCircle,
  usage: Gauge,
  sessions: ChatsCircle,
  "kimi-auth": Key,
  "model-discovery": MagnifyingGlass,
  "auto-update": DownloadSimple,
  "native-app": Monitor,
};

/** Bento spans: cells vary in width so the grid reads as a composition
 *  rather than eight identical tiles. Rows fill 4+2 / 2+2+2 / 3+3 / 2(+2). */
const spans = [
  "lg:col-span-4",
  "lg:col-span-2",
  "lg:col-span-2",
  "lg:col-span-2",
  "lg:col-span-2",
  "lg:col-span-3",
  "lg:col-span-3",
  "sm:col-span-2 lg:col-span-6",
];

const wide = new Set([0, 7]);

export default function Features() {
  const { t } = useLang();
  const [ref, inView] = useInView<HTMLDivElement>();

  return (
    <SectionShell id="features" title={t.features.title} subtitle={t.features.subtitle}>
      <div
        ref={ref}
        className={`reveal grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6 ${
          inView ? "reveal-on" : "reveal-off"
        }`}
      >
        {t.features.items.map((f, i) => {
          const Icon = icons[f.id] ?? Stack;
          return (
            <article
              key={f.id}
              style={{ transitionDelay: `${i * 55}ms` }}
              className={`card card-hover group flex flex-col gap-4 p-6 transition-[opacity,transform,box-shadow,border-color] duration-[620ms] ease-reveal md:p-7 ${
                spans[i] ?? ""
              } ${wide.has(i) ? "sm:col-span-2" : ""} ${
                inView ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="icon-chip transition-colors duration-300 group-hover:border-primary/40 group-hover:text-primary">
                  <Icon className="h-5 w-5" weight="duotone" />
                </span>
                <h3 className="text-base font-semibold tracking-tight md:text-[17px]">
                  {f.title}
                </h3>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
              <ul className="mt-auto space-y-1.5 pt-1">
                {f.points.map((p) => (
                  <li
                    key={p}
                    className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/70"
                    />
                    {p}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>

      <Compatibility title={t.features.tableTitle} note={t.features.tableNote} rows={t.features.table} />
    </SectionShell>
  );
}

/** Grouped definition list instead of a bordered table: two clusters, no
 *  per-row borders, monospace values so paths stay legible. */
function Compatibility({
  title,
  note,
  rows,
}: {
  title: string;
  note: string;
  rows: { k: string; v: string; note: string }[];
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const half = Math.ceil(rows.length / 2);
  const groups = [rows.slice(0, half), rows.slice(half)];

  return (
    <div
      ref={ref}
      className={`reveal mt-16 border-t border-border pt-10 ${
        inView ? "reveal-on" : "reveal-off"
      }`}
    >
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">{note}</p>

      <div className="mt-8 grid grid-cols-1 gap-x-14 gap-y-6 md:grid-cols-2">
        {groups.map((group, gi) => (
          <dl key={gi} className="space-y-5">
            {group.map((r) => (
              <div key={r.k} className="sm:grid sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-4">
                <dt className="pt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {r.k}
                </dt>
                <dd className="mt-1 sm:mt-0">
                  <span className="block break-all font-mono text-[13px] leading-relaxed">
                    {r.v}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{r.note}</span>
                </dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </div>
  );
}
