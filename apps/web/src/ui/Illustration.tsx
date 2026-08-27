import { useEffect, useState } from 'react';
import type { Beat } from '@shiori/core';

interface Props {
  url: string;
  beat: Beat;
  onAdvance(): void;
  onBack(): void;
}

/**
 * A full-page plate, the way a light novel prints one: you turn into the art,
 * look at it, and turn again into the text.
 *
 * Landscape beats — a fight kicking off, an establishing shot — go full bleed.
 * A character portrait sits centered with margins, like a colour insert.
 */
export function Illustration({ url, beat, onAdvance, onBack }: Props) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => setLoaded(false), [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') onAdvance();
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAdvance, onBack]);

  const bleed = beat.kind === 'action' || beat.kind === 'scene';

  return (
    <div
      className={`plate ${bleed ? 'plate--bleed' : 'plate--inset'} ${loaded ? 'is-loaded' : ''}`}
      role="img"
      aria-label={beat.prompt}
    >
      <img
        className="plate__image"
        src={url}
        alt={beat.prompt}
        onLoad={() => setLoaded(true)}
        draggable={false}
      />

      {/* Same three tap zones as the text, so paging never changes its rules. */}
      <div className="zones">
        <button className="zone" onClick={onBack} aria-label="Previous page" />
        <button className="zone" onClick={onAdvance} aria-label="Continue reading" />
        <button className="zone" onClick={onAdvance} aria-label="Continue reading" />
      </div>

      <p className="plate__hint">{KIND_LABEL[beat.kind]}</p>
    </div>
  );
}

const KIND_LABEL: Record<Beat['kind'], string> = {
  character: 'Character',
  scene: 'Scene',
  action: 'Spread',
  item: 'Item',
};
