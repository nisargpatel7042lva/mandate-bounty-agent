"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** One masked line of a rising headline. */
export function Line({ i, children }: { i: number; children: ReactNode }) {
  return (
    <span className="mask">
      <span style={{ "--i": i } as CSSProperties}>{children}</span>
    </span>
  );
}

/** Counts up to `value` once it scrolls into view. */
export function CountUp({ value, pad = 0 }: { value: number; pad?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / 1600);
        setShown(Math.round(value * (1 - Math.pow(1 - p, 4))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);
  return <span ref={ref}>{String(shown).padStart(pad, "0")}</span>;
}

export interface Step {
  key: string;
  title: ReactNode;
  short: string;
  body: ReactNode;
  tags: string[];
  advice?: boolean;
}

/** Sticky step counter on the left; the step nearest the middle of the screen is active. */
export function Method({ steps }: { steps: Step[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.idx));
        }),
      { rootMargin: "-45% 0px -50% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  const n = String(active + 1).padStart(2, "0");
  return (
    <div className="method">
      <div className="method-sticky">
        <div className="method-num" aria-hidden>
          <span key={n}>{n}</span>
          <span className="it">/</span>
          <span style={{ color: "var(--muted)" }}>{String(steps.length).padStart(2, "0")}</span>
        </div>
        <p className="method-caption label" style={{ fontSize: 12 }}>
          {steps[active]?.short}
        </p>
        <div className="method-bar">
          <span style={{ width: `${((active + 1) / steps.length) * 100}%` }} />
        </div>
      </div>
      <ol className="method-steps">
        {steps.map((s, i) => (
          <li
            key={s.key}
            data-idx={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={`method-step${i === active ? " active" : ""}${s.advice ? " advice" : ""}`}
          >
            <span className="label">{`${String(i + 1).padStart(2, "0")} — ${s.short}`}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            <div className="tag">
              {s.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
