import type { ReactNode } from "react";
import { asset } from "../lib/asset";

interface WindowFrameProps {
  src: string;
  alt: string;
  /** Small centered label in the title bar, e.g. "供应商". */
  title?: string;
  /** Right-aligned note inside the same title bar. */
  meta?: string;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
  children?: ReactNode;
}

/** macOS-style window chrome for real screenshots. Decorative only: the dots
 *  and title bar are aria-hidden, the image keeps its own alt text. */
export default function WindowFrame({
  src,
  alt,
  title,
  meta,
  className = "",
  imgClassName = "",
  priority = false,
  children,
}: WindowFrameProps) {
  return (
    <figure className={`window ${className}`}>
      <div className="window-bar" aria-hidden="true">
        <span className="flex shrink-0 gap-[6px]">
          <span className="window-dot bg-[#ff5f57]" />
          <span className="window-dot bg-[#febc2e]" />
          <span className="window-dot bg-[#28c840]" />
        </span>
        {title && (
          <span className="mx-auto truncate pl-1 text-[11px] font-medium tracking-wide text-muted-foreground">
            {title}
          </span>
        )}
        {meta && (
          <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/80">
            {meta}
          </span>
        )}
      </div>
      <div className="window-body">
        <span className="window-plate">
          <img
            src={asset(src)}
            alt={alt}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            className={`aspect-[1202/832] w-full object-cover object-top ${imgClassName}`}
          />
        </span>
        {children}
      </div>
    </figure>
  );
}
