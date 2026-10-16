import { useInView, useRevealStyles } from "../hooks";
import type { ReactNode } from "react";

interface SectionShellProps {
  id: string;
  title: string;
  subtitle?: string;
  className?: string;
  children: ReactNode;
}

export default function SectionShell({
  id,
  title,
  subtitle,
  className = "",
  children,
}: SectionShellProps) {
  const [ref, inView] = useInView<HTMLElement>();
  const head = useRevealStyles(inView);
  return (
    <section
      ref={ref}
      id={id}
      aria-labelledby={`${id}-title`}
      className={`scroll-mt-20 py-20 md:py-28 ${className}`}
    >
      <div className="container-page">
        <header className={`mb-10 max-w-2xl md:mb-14 ${head.className}`} style={head.style}>
          <h2 id={`${id}-title`} className="text-section font-semibold">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-4 max-w-prose text-base leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          )}
        </header>
        {children}
      </div>
    </section>
  );
}
