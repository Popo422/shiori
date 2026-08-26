import { useEffect, useState } from 'react';
import type { Beat } from '@shiori/core';

interface Props {
  url: string;
  beat: Beat;
  onDismiss(): void;
}

/**
 * An illustration surfaces as a peek at the bottom of the page; tapping opens it
 * full-bleed. It never interrupts the text — the reader chooses to look.
 */
export function Illustration({ url, beat, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setExpanded(false);
  }, [url]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  if (expanded) {
    return (
      <div className="lightbox" onClick={() => setExpanded(false)} role="dialog" aria-modal="true">
        <img src={url} alt={beat.prompt} className="lightbox__image" />
        <p className="lightbox__caption">{beat.prompt}</p>
        <button className="lightbox__close" onClick={() => setExpanded(false)} aria-label="Close">
          ✕
        </button>
      </div>
    );
  }

  return (
    <figure className={`peek peek--${beat.kind} ${loaded ? 'is-loaded' : ''}`}>
      <button className="peek__button" onClick={() => setExpanded(true)}>
        <img src={url} alt={beat.prompt} loading="lazy" onLoad={() => setLoaded(true)} />
        <span className="peek__label">{KIND_LABEL[beat.kind]}</span>
      </button>
      <button className="peek__dismiss" onClick={onDismiss} aria-label="Hide illustration">
        ✕
      </button>
    </figure>
  );
}

const KIND_LABEL: Record<Beat['kind'], string> = {
  character: 'Character',
  scene: 'Scene',
  action: 'Spread',
  item: 'Item',
};
