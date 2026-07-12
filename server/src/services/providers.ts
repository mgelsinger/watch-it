import { cacheGet, cacheSet, getSetting } from '../db.js';
import * as tmdb from '../sources/tmdb.js';
import { enabledServiceIds } from './availability.js';

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

export interface OfferFilter {
  myServicesOnly: boolean;
  includeRentBuy: boolean;
}

interface CachedOffers {
  offers: WatchOffer[];
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
): Promise<{ offers: WatchOffer[]; stale: boolean }> {
  const region = getSetting('region');
  const key = `tmdb_providers:${region}:${mediaType}:${tmdbId}`;
  const cached = cacheGet(key, DAY);
  if (cached?.fresh) return { offers: (cached.payload as CachedOffers).offers ?? [], stale: false };

  try {
    const regions = mediaType === 'movie' ? await tmdb.movieProviders(tmdbId) : await tmdb.tvProviders(tmdbId);
    const payload: CachedOffers = { offers: flattenOffers(regions[region]) };
    cacheSet(key, payload);
    return { offers: payload.offers, stale: false };
  } catch (err) {
    if (cached) return { offers: (cached.payload as CachedOffers).offers ?? [], stale: true };
    throw err;
  }
}

export function filterAndSortOffers(
  offers: WatchOffer[],
  filter: OfferFilter,
  enabled: Set<number> = enabledServiceIds(),
): WatchOffer[] {
  const filtered = offers.filter((o) => {
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
): Promise<Array<T & { offers: WatchOffer[] }>> {
  const results = cards.map((card) => ({ ...card, offers: [] as WatchOffer[] }));
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, cards.length) }, async () => {
    while (cursor < cards.length) {
      const index = cursor++;
      const card = cards[index];
      try {
        results[index].offers = await offersForTitle(card.media_type, card.tmdb_id, filter);
      } catch {
        results[index].offers = [];
      }
    }
  });
  await Promise.all(workers);
  return results;
}
