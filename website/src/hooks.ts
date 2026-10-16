import { useEffect, useMemo, useRef, useState } from "react";

/** True when the element already overlaps the viewport. */
function overlapsViewport(node: Element) {
  const rect = node.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return rect.top < vh && rect.bottom > 0;
}

/** Fires once when the element scrolls into view. The only scroll-driven
 *  primitive on the site: no scroll listeners anywhere.
 *
 *  Reveal is progressive enhancement, never a gate on content. The effect
 *  measures synchronously (no animation frame, no observer tick) so anything
 *  already on screen is visible on the first paint, and the hidden state is
 *  itself gated behind `<html class="js">` set by the inline bootstrap. */
export function useInView<T extends Element = Element>(
  options: IntersectionObserverInit = { threshold: 0, rootMargin: "0px 0px -10% 0px" },
) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  const optionsRef = useRef(options);

  useEffect(() => {
    const node = ref.current;
    if (!node || inView) return;

    if (overlapsViewport(node) || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        io.disconnect();
      }
    }, optionsRef.current);
    io.observe(node);
    return () => io.disconnect();
  }, [inView]);

  return [ref, inView] as const;
}

/** Animates a numeric value once `trigger` flips to true. */
export function useCountUp(target: number, trigger: boolean, durationMs = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!trigger) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      setValue(target * easeOut(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, trigger, durationMs]);
  return value;
}

/** Reveal styles for a section/child: pairs `.reveal` with the off/on states
 *  and an optional stagger delay. Returns className + style for one element. */
export function useRevealStyles(
  inView: boolean,
  index = 0,
  stepMs = 70,
): { className: string; style: { transitionDelay: string } } {
  return useMemo(
    () => ({
      className: `reveal ${inView ? "reveal-on" : "reveal-off"}`,
      style: { transitionDelay: `${index * stepMs}ms` },
    }),
    [inView, index, stepMs],
  );
}
