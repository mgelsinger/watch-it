import { type ReactNode, useEffect, useRef, useState } from 'react';

export default function Carousel({ children, label }: { children: ReactNode[]; label: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [canGoLeft, setCanGoLeft] = useState(false);
  const [canGoRight, setCanGoRight] = useState(false);

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const update = () => {
      const max = Math.max(0, element.scrollWidth - element.clientWidth);
      setCanGoLeft(element.scrollLeft > 2);
      setCanGoRight(element.scrollLeft < max - 2);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    const frame = requestAnimationFrame(update);
    element.addEventListener('scroll', update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, [children.length]);

  const move = (direction: -1 | 1) => {
    const element = track.current;
    if (!element) return;
    element.scrollBy({ left: direction * Math.max(154, element.clientWidth - 48), behavior: 'smooth' });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const cards = Array.from(track.current?.querySelectorAll<HTMLElement>('[data-card]') ?? []);
    const index = cards.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    const next = cards[index + (event.key === 'ArrowRight' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
    next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  };

  return (
    <div className="carousel" aria-label={label}>
      <button
        className="carousel-control carousel-left"
        aria-label="Show previous titles"
        disabled={!canGoLeft}
        onClick={() => move(-1)}
      >
        ‹
      </button>
      <div className="carousel-track" ref={track} onKeyDown={onKeyDown}>
        {children}
      </div>
      <button
        className="carousel-control carousel-right"
        aria-label="Show more titles"
        disabled={!canGoRight}
        onClick={() => move(1)}
      >
        ›
      </button>
    </div>
  );
}
