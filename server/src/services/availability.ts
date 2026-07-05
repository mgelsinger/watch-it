import { getDb, getSetting } from '../db.js';
import { nowIso } from '../config.js';
import type { RegionOffers } from '../sources/tmdb.js';
import { emitEvent } from './events.js';

const OFFER_TYPES = ['flatrate', 'rent', 'buy', 'free', 'ads'] as const;
type OfferType = (typeof OFFER_TYPES)[number];

interface AvailabilityRow {
  id: number;
  provider_id: number;
  provider_name: string;
  offer_type: OfferType;
  active: number;
}

export function enabledServiceIds(): Set<number> {
  const rows = getDb().prepare('SELECT provider_id FROM my_services WHERE enabled = 1').all() as { provider_id: number }[];
  return new Set(rows.map((r) => r.provider_id));
}

/**
 * Diff a fresh TMDB watch-provider payload against stored availability.
 * Rows are never deleted: vanished offers get active=0 (history is kept).
 * Emits arrived_on_service / left_service for the user's enabled services, and
 * now_streaming for theater-pipeline titles gaining their first home offer.
 *
 * opts.initialSync: this is the title's first-ever provider snapshot. Rows get
 * initial_sync = 1 (first_seen means "tracking started", not an arrival) and
 * no events are emitted — a five-year-old Netflix title is not "arriving".
 */
export function applyProviders(
  titleId: number,
  allRegions: Record<string, RegionOffers>,
  opts: { initialSync: boolean },
): void {
  const db = getDb();
  const region = getSetting('region');
  const offers = allRegions[region] ?? {};
  const now = nowIso();
  const myServices = enabledServiceIds();

  const fresh = new Map<string, { providerId: number; providerName: string; logoPath: string | null; offerType: OfferType }>();
  for (const type of OFFER_TYPES) {
    for (const p of offers[type] ?? []) {
      fresh.set(`${p.provider_id}:${type}`, {
        providerId: p.provider_id,
        providerName: p.provider_name,
        logoPath: p.logo_path ?? null,
        offerType: type,
      });
    }
  }

  const existing = db
    .prepare('SELECT id, provider_id, provider_name, offer_type, active FROM availability WHERE title_id = ? AND region = ?')
    .all(titleId, region) as AvailabilityRow[];
  const existingByKey = new Map(existing.map((r) => [`${r.provider_id}:${r.offer_type}`, r]));

  const title = db
    .prepare('SELECT status_upstream, media_type, name FROM titles WHERE id = ?')
    .get(titleId) as { status_upstream: string | null; media_type: string; name: string } | undefined;
  if (!title) return;

  const hadActiveHomeOffer = existing.some((r) => r.active === 1);
  const hasFreshHomeOffer = fresh.size > 0;

  const apply = db.transaction(() => {
    for (const [key, offer] of fresh) {
      const row = existingByKey.get(key);
      const isNewlyAvailable = !row || row.active === 0;
      if (row) {
        // Reactivation of a lapsed offer is an observed arrival: clear initial_sync
        // (the CASE reads the pre-update active value).
        db.prepare(`
          UPDATE availability SET last_seen = ?, provider_name = ?, logo_path = COALESCE(?, logo_path),
                 initial_sync = CASE WHEN active = 0 THEN 0 ELSE initial_sync END, active = 1
          WHERE id = ?
        `).run(now, offer.providerName, offer.logoPath, row.id);
      } else {
        db.prepare(
          'INSERT INTO availability (title_id, provider_id, provider_name, logo_path, offer_type, region, first_seen, last_seen, active, initial_sync) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
        ).run(titleId, offer.providerId, offer.providerName, offer.logoPath, offer.offerType, region, now, now, opts.initialSync ? 1 : 0);
      }
      if (
        !opts.initialSync &&
        isNewlyAvailable &&
        myServices.has(offer.providerId) &&
        (offer.offerType === 'flatrate' || offer.offerType === 'free' || offer.offerType === 'ads')
      ) {
        emitEvent(titleId, 'arrived_on_service', {
          provider_id: offer.providerId,
          provider_name: offer.providerName,
          offer_type: offer.offerType,
          title_name: title.name,
        });
      }
    }

    for (const [key, row] of existingByKey) {
      if (fresh.has(key) || row.active === 0) continue;
      db.prepare('UPDATE availability SET active = 0, last_seen = ? WHERE id = ?').run(now, row.id);
      if (
        !opts.initialSync &&
        myServices.has(row.provider_id) &&
        (row.offer_type === 'flatrate' || row.offer_type === 'free' || row.offer_type === 'ads')
      ) {
        emitEvent(titleId, 'left_service', {
          provider_id: row.provider_id,
          provider_name: row.provider_name,
          offer_type: row.offer_type,
          title_name: title.name,
        });
      }
    }

    // Theater-to-streaming pipeline: first home offer for an In Theaters movie.
    if (
      title.media_type === 'movie' &&
      title.status_upstream === 'In Theaters' &&
      hasFreshHomeOffer &&
      !hadActiveHomeOffer
    ) {
      const first = [...fresh.values()][0];
      emitEvent(titleId, 'now_streaming', {
        provider_name: first.providerName,
        offer_type: first.offerType,
        title_name: title.name,
      });
      db.prepare("UPDATE titles SET status_upstream = 'Released' WHERE id = ?").run(titleId);
    }
  });
  apply();
}
