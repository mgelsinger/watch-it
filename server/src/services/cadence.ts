// Release-cadence classifier: per season, from episode air-date gaps.

export interface Cadence {
  type: 'weekly' | 'binge' | 'split' | 'irregular';
  detail: string; // human-readable, e.g. "Weekly, Thursdays" or "Full-season drop"
}

const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

export function classifySeason(airDates: (string | null)[]): Cadence | null {
  const dates = [...new Set(airDates.filter((d): d is string => !!d))].sort();
  if (dates.length === 0) return null;
  if (dates.length === 1) {
    // Every episode on one day = full-season drop (a 1-episode season also lands here).
    return { type: 'binge', detail: 'Full-season drop' };
  }

  const days = dates.map((d) => Math.round(Date.parse(`${d}T12:00:00Z`) / 86400_000));
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(days[i] - days[i - 1]);

  const weeklyGaps = gaps.filter((g) => g >= 6 && g <= 8).length;
  if (weeklyGaps / gaps.length >= 0.75) {
    // Majority weekday of the air dates (UTC noon avoids date shifting).
    const counts = new Map<number, number>();
    for (const d of dates) {
      const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
      counts.set(wd, (counts.get(wd) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { type: 'weekly', detail: `Weekly, ${WEEKDAYS[top]}` };
  }

  // Split: 2+ clusters of same/adjacent days separated by 14+ day gaps.
  const bigGaps = gaps.filter((g) => g >= 14).length;
  const smallGaps = gaps.filter((g) => g <= 1).length;
  if (bigGaps >= 1 && bigGaps + smallGaps === gaps.length) {
    return { type: 'split', detail: `${bigGaps + 1}-part drop` };
  }

  return { type: 'irregular', detail: 'Irregular schedule' };
}

/**
 * Title-level cadence: the most recent season that has enough aired data.
 * Seasons ordered ascending by season_number; specials (season 0) excluded by caller.
 */
export function classifyTitle(seasonAirDates: { seasonNumber: number; airDates: (string | null)[] }[]): Cadence | null {
  const usable = seasonAirDates
    .filter((s) => s.airDates.filter(Boolean).length >= 2)
    .sort((a, b) => b.seasonNumber - a.seasonNumber);
  if (usable.length > 0) return classifySeason(usable[0].airDates);
  const any = seasonAirDates
    .filter((s) => s.airDates.filter(Boolean).length >= 1)
    .sort((a, b) => b.seasonNumber - a.seasonNumber);
  return any.length > 0 ? classifySeason(any[0].airDates) : null;
}
