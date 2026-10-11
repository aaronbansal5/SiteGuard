import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Keep a bounded, keyboard-scrollable queue without dropping stored reports. */
export function IncidentScrollArea({
  children,
  label = "Incident reports, scroll for more",
  className = "",
  visibleRows = 4,
  rowSelector,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  visibleRows?: number;
  rowSelector?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const rows = Array.from(
      rowSelector ? list.querySelectorAll(rowSelector) : list.children,
    ).slice(0, visibleRows);
    const measure = () => {
      const fourth = rows[visibleRows - 1];
      if (!fourth) {
        list.style.removeProperty("--incident-list-height");
        return;
      }
      const height =
        fourth.getBoundingClientRect().bottom -
        list.getBoundingClientRect().top +
        list.scrollTop;
      list.style.setProperty(
        "--incident-list-height",
        `${Math.ceil(height)}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    rows.forEach((row) => observer.observe(row));
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [children, visibleRows, rowSelector]);
  return (
    <div
      ref={ref}
      className={`incident-scroll-area ${className}`}
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
