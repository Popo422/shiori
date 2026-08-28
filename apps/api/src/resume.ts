/**
 * Deciding when a claimed render is parked rather than working.
 *
 * renderAndStore draws at most one reference sheet per invocation and returns
 * with the row still pending, because a sheet and an illustration together
 * overrun the 30s background budget. Something has to notice that the row is
 * waiting to be called back, or it only resumes once it ages out as stale —
 * three minutes per sheet, which is what made a character beat sit as a
 * skeleton for minutes while a scene beat appeared in seconds.
 *
 * Kept free of Drizzle and Cloudflare types so the rule can be tested directly.
 */

/** The parts of a beat this decision needs. */
export interface BeatLike {
  spineIndex: number;
  characterIds: string[];
}

/** The parts of a stored character appearance this decision needs. */
export interface EraLike {
  characterId: string;
  fromSpineIndex: number;
  referenceKey: string | null;
}

/**
 * Whether every character this beat needs already has its reference sheet
 * resolved — drawn, or recorded as unavailable.
 *
 * True means the sheet stage is finished and the next pass goes straight to the
 * illustration, so the row can be picked up immediately. False means a sheet is
 * being drawn right now: leave it alone, and this same check releases it on the
 * following poll.
 */
export function sheetsResolved(beat: BeatLike, eras: readonly EraLike[]): boolean {
  return beat.characterIds.every((characterId) => {
    const era = eraInForce(characterId, beat.spineIndex, eras);
    // No era recorded yet means analysis has not caught up. That is not a
    // parked sheet, so the row is left to the renderer.
    return era !== null && era.referenceKey != null;
  });
}

/**
 * The appearance in force at a point in the book: the latest one starting at or
 * before it. Resolved the same way the renderer resolves it, so this check and
 * the render agree on which sheet a beat is waiting for.
 */
function eraInForce(
  characterId: string,
  spineIndex: number,
  eras: readonly EraLike[],
): EraLike | null {
  let best: EraLike | null = null;
  for (const era of eras) {
    if (era.characterId !== characterId) continue;
    if (era.fromSpineIndex > spineIndex) continue;
    if (!best || era.fromSpineIndex > best.fromSpineIndex) best = era;
  }
  return best;
}
