import { useInView } from "../hooks";
import type { ReactNode } from "react";

interface SectionShellProps {
  id: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export default function SectionShell({ id, title, subtitle, children }: SectionShellProps) {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <section
      ref={ref}
      id={id}
      aria-labelledby={`${id}-title`}
      className={`py-20 transition-all duration-700 ease-out ${
        inView
          ? "motion-safe:opacity-100 motion-safe:translate-y-0"
          : "motion-safe:opacity-0 motion-safe:translate-y-6"
      }`}
    >
      <div className="container-page">
        <div className="mb-12 max-w-3xl">
          <h2
            id={`${id}-title`}
            className="text-3xl font-bold tracking-tight md:text-4xl"
          >
            {title}
          </h2>
          {subtitle && (
            <p className="mt-3 text-base text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}
