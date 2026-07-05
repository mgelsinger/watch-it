import { type ReactNode, useRef } from 'react';

/** Netflix-style horizontal row. Arrow keys move focus between cards. */
export default function Row({ title, children, empty }: { title: string; children: ReactNode[]; empty?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  if (!children || children.length === 0) {
    return empty ? (
      <section>
        <h2 className="row-title">{title}</h2>
        <div className="faint" style={{ marginBottom: 12 }}>{empty}</div>
      </section>
    ) : null;
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const cards = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-card]') ?? []);
    const idx = cards.indexOf(document.activeElement as HTMLElement);
    if (idx === -1) return;
    const next = cards[idx + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) {
      e.preventDefault();
      next.focus();
      next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  };

  return (
    <section aria-label={title}>
      <h2 className="row-title">{title}</h2>
      <div className="poster-row" ref={ref} onKeyDown={onKeyDown}>
        {children}
      </div>
    </section>
  );
}
