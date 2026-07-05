import { z } from 'zod';
import { fetchJson } from '../http.js';

const AiringZ = z
  .object({
    id: z.number(),
    airdate: z.string().nullish(),
    airtime: z.string().nullish(),
    name: z.string().nullish(), // episode name
    season: z.union([z.number(), z.string()]).nullish(),
    number: z.number().nullish(),
    runtime: z.number().nullish(),
    show: z
      .object({
        id: z.number(),
        name: z.string(),
        type: z.string().nullish(),
        network: z.object({ name: z.string() }).passthrough().nullish(),
        webChannel: z.object({ name: z.string() }).passthrough().nullish(),
        externals: z.object({ imdb: z.string().nullish() }).passthrough().nullish(),
        image: z.object({ medium: z.string().nullish() }).passthrough().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

export type Airing = z.infer<typeof AiringZ>;

/** Broadcast schedule for a country + date (YYYY-MM-DD). Malformed entries are skipped. */
export async function schedule(country: string, date: string): Promise<Airing[]> {
  const raw = await fetchJson('tvmaze', `https://api.tvmaze.com/schedule?country=${encodeURIComponent(country)}&date=${encodeURIComponent(date)}`);
  if (!Array.isArray(raw)) return [];
  const out: Airing[] = [];
  for (const entry of raw) {
    const parsed = AiringZ.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export async function testApi(): Promise<void> {
  await fetchJson('tvmaze', 'https://api.tvmaze.com/shows/1');
}
