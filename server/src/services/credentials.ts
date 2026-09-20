import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { fetchJson, HttpError } from '../http.js';

export type CredentialSource = 'tmdb' | 'omdb';
type Credentials = Partial<Record<CredentialSource, string>>;

function readCredentials(): Credentials {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'credentials.json'), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    const data = parsed as Credentials;
    if (Object.values(data).some((value) => typeof value !== 'string')) throw new Error();
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new HttpError('Saved API keys could not be read. Check the data volume permissions or restore credentials.json from a private volume backup.', 503);
  }
}

export function credentialManaged(source: CredentialSource): boolean {
  return Boolean(source === 'tmdb' ? config.tmdbKey : config.omdbKey);
}

export function getCredential(source: CredentialSource): string {
  return (source === 'tmdb' ? config.tmdbKey : config.omdbKey) || readCredentials()[source] || '';
}

// The provider receives only its own key. Never echo provider bodies or submitted keys.
export async function validateCredential(source: CredentialSource, key: string): Promise<void> {
  if (!key) throw new HttpError(`Add your ${source === 'tmdb' ? 'TMDB' : 'OMDb'} API key in Settings > API keys.`, 400);
  try {
    if (source === 'tmdb') {
      await fetchJson('tmdb', `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`);
    } else {
      const data = await fetchJson('omdb', `https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=tt0111161`) as { Response?: string; Error?: string };
      if (data.Response !== 'True') {
        throw new HttpError(/limit/i.test(data.Error ?? '') ? 'quota' : 'invalid key', /limit/i.test(data.Error ?? '') ? 429 : 401);
      }
    }
  } catch (error) {
    if (error instanceof HttpError && [401, 403].includes(error.status)) {
      throw new HttpError(source === 'tmdb'
        ? 'TMDB rejected this key. Copy the API Key from your TMDB API settings, not the API Read Access Token.'
        : 'OMDb rejected this key. Check the key and activation email; your daily allowance may also be exhausted.', 400);
    }
    throw new HttpError(`${source.toUpperCase()} could not verify the key. Check your connection or provider quota and try again. Your saved key has not changed.`, 503);
  }
}

export function saveCredential(source: CredentialSource, key: string): void {
  if (credentialManaged(source)) throw new HttpError('This key is managed by the installation environment. Remove that environment value and recreate the container to manage it here.', 409);
  const values = readCredentials();
  if (key) values[source] = key; else delete values[source];
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const temporary = path.join(config.dataDir, `credentials-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(values), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, path.join(config.dataDir, 'credentials.json'));
  } catch {
    throw new HttpError('Could not save the key. Check data volume permissions and free disk space, then try again.', 503);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
