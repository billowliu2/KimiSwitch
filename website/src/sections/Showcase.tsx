import { useState } from "react";
import { CaretLeft, CaretRight, CheckCircle } from "@phosphor-icons/react";
import SectionShell from "../components/SectionShell";
import WindowFrame from "../components/WindowFrame";
import { useInView, useRevealStyles } from "../hooks";
import { useLang } from "../i18n";

export default function Showcase() {
  const { t } = useLang();
  const tabs = t.showcase.tabs;
  const [active, setActive] = useState(0);
  const [ref, inView] = useInView<HTMLDivElement>();
  const styles = useRevealStyles(inView);
  const item = tabs[active];

  const step = (delta: number) => setActive((i) => (i + delta + tabs.length) % tabs.length);

  return (
    <SectionShell id="showcase" title={t.showcase.title} subtitle={t.showcase.subtitle}>
      <div ref={ref} className={`reveal ${inView ? "reveal-on" : "reveal-off"}`} style={styles.style}>
        <div
          role="tablist"
          aria-label={t.showcase.title}
          className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto rounded-xl border border-border bg-muted/60 p-1"
        >
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              role="tab"
              type="button"
              id={`showcase-tab-${tab.id}`}
              aria-selected={i === active}
              aria-controls={`showcase-panel-${tab.id}`}
              onClick={() => setActive(i)}
              className={`tab-pill shrink-0 ${i === active ? "tab-pill-active" : ""}`}
            >
              {tab.tab}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`showcase-panel-${item.id}`}
          aria-labelledby={`showcase-tab-${item.id}`}
          className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-center lg:gap-12"
        >
          <WindowFrame
            key={item.src}
            src={item.src}
            alt={`Kimi Switch - ${item.title}`}
            title={item.tab}
            className="animate-fade-in"
          />

          <div key={item.id} className="animate-fade-in">
            <h3 className="text-xl font-semibold tracking-tight md:text-2xl">{item.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground md:text-base">
              {item.desc}
            </p>
            <ul className="mt-6 space-y-2.5">
              {item.points.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle
                    className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                    weight="fill"
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">{p}</span>
                </li>
              ))}
            </ul>

            <div className="mt-7 flex items-center gap-3">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={tabs[(active - 1 + tabs.length) % tabs.length].tab}
                className="btn-ghost px-3 py-2"
              >
                <CaretLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={tabs[(active + 1) % tabs.length].tab}
                className="btn-ghost px-3 py-2"
              >
                <CaretRight className="h-4 w-4" />
              </button>
              <span className="font-mono text-xs text-muted-foreground">
                {active + 1} / {tabs.length}
              </span>
              <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
                {t.showcase.hint}
              </span>
            </div>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
