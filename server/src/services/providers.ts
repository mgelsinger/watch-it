import { cacheGet, cacheSet, getSetting } from '../db.js';
import * as tmdb from '../sources/tmdb.js';
import { enabledServiceIds } from './availability.js';
import { singleFlight } from '../singleFlight.js';
import { nowIso } from '../config.js';

const DAY = 86400_000;
const STREAM_TYPES = new Set<WatchOffer['offer_type']>(['flatrate', 'free', 'ads']);
const TYPE_ORDER: Record<WatchOffer['offer_type'], number> = {
  flatrate: 0,
  free: 1,
  ads: 2,
  rent: 3,
  buy: 4,
};

export interface WatchOffer {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  offer_type: 'flatrate' | 'rent' | 'buy' | 'free' | 'ads';
}

export interface AvailabilityCheck {
  status: 'fresh' | 'stale' | 'unavailable';
  region: string;
  checked_at: string | null;
}

export function watchUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.themoviedb.org' && !url.port && !url.username && !url.password
      && /^\/(movie|tv)\/\d+(?:-[^/]+)?\/watch$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

export interface OfferFilter {
  myServicesOnly: boolean;
  includeRentBuy: boolean;
  excludedProviderIds?: number[];
}

/** Share the region's provider catalog between search filters and Settings. */
export async function regionalProviders(): Promise<Awaited<ReturnType<typeof tmdb.providerList>>> {
  const region = getSetting('region');
  const key = `tmdb_providers:${region}`;
  const cached = cacheGet(key, 7 * DAY);
  if (cached?.fresh || !tmdb.tmdbConfigured()) return (cached?.payload ?? []) as Awaited<ReturnType<typeof tmdb.providerList>>;
  return singleFlight(key, async () => {
    try {
      const providers = await tmdb.providerList(region);
      cacheSet(key, providers);
      return providers;
    } catch (err) {
      if (cached) return cached.payload as Awaited<ReturnType<typeof tmdb.providerList>>;
      throw err;
    }
  });
}

/** null leaves services unrestricted; [] means none remain. Use an OR of the
 * remaining services so titles shared with an excluded service stay eligible. */
export async function discoveryProviderIds(excluded: number[], myServicesOnly: boolean): Promise<number[] | null> {
  if (!myServicesOnly && excluded.length === 0) return null;
  const candidates = myServicesOnly ? [...enabledServiceIds()] : (await regionalProviders()).map((p) => p.provider_id);
  return [...new Set(candidates)].filter((id) => !excluded.includes(id)).sort((a, b) => a - b);
}

interface CachedOffers {
  offers: WatchOffer[];
  watch_url?: string | null;
}

function flattenOffers(region: tmdb.RegionOffers | undefined): WatchOffer[] {
  if (!region) return [];
  const offers: WatchOffer[] = [];
  for (const type of ['flatrate', 'free', 'ads', 'rent', 'buy'] as const) {
    for (const p of region[type] ?? []) {
      offers.push({
        provider_id: p.provider_id,
        provider_name: p.provider_name,
        logo_path: p.logo_path ?? null,
        offer_type: type,
      });
    }
  }
  return offers;
}

export async function getExternalOffers(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
): Promise<{ offers: WatchOffer[]; stale: boolean; availability_check: AvailabilityCheck; watch_url: string | null }> {
  const region = getSetting('region');
  const key = `tmdb_providers:${region}:${mediaType}:${tmdbId}`;
  const cached = cacheGet(key, DAY);
  const result = (payload: CachedOffers, status: AvailabilityCheck['status'], checkedAt: string | null) => ({
    offers: payload.offers ?? [], stale: status === 'stale', watch_url: watchUrl(payload.watch_url),
    availability_check: { status, region, checked_at: checkedAt },
  });
  if (cached?.fresh) return result(cached.payload as CachedOffers, 'fresh', cached.fetchedAt);
  return singleFlight(key, async () => {
    try {
      const regions = mediaType === 'movie' ? await tmdb.movieProviders(tmdbId) : await tmdb.tvProviders(tmdbId);
      const payload: CachedOffers = { offers: flattenOffers(regions[region]), watch_url: watchUrl(regions[region]?.link) };
      cacheSet(key, payload);
      return result(payload, 'fresh', nowIso());
    } catch {
      if (cached) return result(cached.payload as CachedOffers, 'stale', cached.fetchedAt);
      return result({ offers: [] }, 'unavailable', null);
    }
  });
}

export function filterAndSortOffers(
  offers: WatchOffer[],
  filter: OfferFilter,
  enabled: Set<number> = enabledServiceIds(),
): WatchOffer[] {
  const filtered = offers.filter((o) => {
    if (filter.excludedProviderIds?.includes(o.provider_id)) return false;
    if (filter.myServicesOnly && !enabled.has(o.provider_id)) return false;
    return filter.includeRentBuy || STREAM_TYPES.has(o.offer_type);
  });

  filtered.sort((a, b) => {
    const enabledDiff = Number(enabled.has(b.provider_id)) - Number(enabled.has(a.provider_id));
    return enabledDiff || TYPE_ORDER[a.offer_type] - TYPE_ORDER[b.offer_type] || a.provider_name.localeCompare(b.provider_name);
  });

  const seen = new Set<number>();
  return filtered.filter((o) => {
    if (seen.has(o.provider_id)) return false;
    seen.add(o.provider_id);
    return true;
  });
}

export async function offersForTitle(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  filter: OfferFilter,
): Promise<WatchOffer[]> {
  const { offers } = await getExternalOffers(mediaType, tmdbId);
  return filterAndSortOffers(offers, filter);
}

export async function enrichCardsWithOffers<T extends { tmdb_id: number; media_type: 'movie' | 'tv' }>(
  cards: T[],
  filter: OfferFilter,
  concurrency = 5,
): Promise<Array<T & { offers: WatchOffer[]; availability_check: AvailabilityCheck }>> {
  const region = getSetting('region');
  const results = cards.map((card) => ({ ...card, offers: [] as WatchOffer[], availability_check: { status: 'unavailable', region, checked_at: null } as AvailabilityCheck }));
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, cards.length) }, async () => {
    while (cursor < cards.length) {
      const index = cursor++;
      const card = cards[index];
      try {
        const result = await getExternalOffers(card.media_type, card.tmdb_id);
        results[index].offers = filterAndSortOffers(result.offers, filter);
        results[index].availability_check = result.availability_check;
      } catch {
        results[index].offers = [];
      }
    }
  });
  await Promise.all(workers);
  return results;
}
