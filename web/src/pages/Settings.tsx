import { useRef, useState } from 'react';
import { api, img, useApi } from '../api';
import type { Provider, SyncLogRow, SyncState } from '../types';

interface SettingsData {
  settings: Record<string, string>;
  keys: { tmdb: boolean; omdb: boolean };
  omdb_quota_remaining: number | null;
  db: { path: string; size_bytes: number };
}

const REGIONS = ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'NO', 'DK', 'BR', 'MX', 'JP', 'KR', 'IN'];

function fmtBytes(n: number): string {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function KeyTest({ source, label, present }: { source: string; label: string; present: boolean | null }) {
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await api<{ ok: boolean; error?: string }>(`/api/settings/test/${source}`, { method: 'POST' });
      setResult(res.ok ? '✓ working' : `✗ ${res.error}`);
    } catch (e) {
      setResult(`✗ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="kv">
      <span className="k">{label}</span>
      <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {present !== null && (
          <span className={present ? '' : 'muted'}>{present ? 'key present' : 'no key (set in .env)'}</span>
        )}
        {result && <span className="faint">{result}</span>}
        <button onClick={() => void test()} disabled={busy || present === false}>{busy ? 'testing…' : 'test'}</button>
      </span>
    </div>
  );
}

export default function Settings() {
  const { data, loading, reload } = useApi<SettingsData>('/api/settings');
  const providers = useApi<{ region: string; providers: Provider[] }>('/api/providers');
  const sync = useApi<{ state: SyncState; log: SyncLogRow[] }>('/api/sync/status');
  const [providerFilter, setProviderFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const saveSetting = async (key: string, value: string) => {
    await api('/api/settings', { method: 'PUT', json: { [key]: value } });
    reload();
    providers.reload();
  };

  const toggleProvider = async (p: Provider) => {
    await api('/api/my-services', {
      method: 'PUT',
      json: { provider_id: p.provider_id, provider_name: p.provider_name, logo_path: p.logo_path, enabled: !p.enabled },
    });
    providers.setData(
      providers.data
        ? { ...providers.data, providers: providers.data.providers.map((x) => (x.provider_id === p.provider_id ? { ...x, enabled: !p.enabled } : x)) }
        : providers.data,
    );
  };

  const doImport = async (file: File) => {
    setImportMsg('importing…');
    try {
      const json = JSON.parse(await file.text());
      const res = await api<{ ok: boolean; titles: number }>('/api/import', { json });
      setImportMsg(`✓ imported ${res.titles} titles (existing data replaced)`);
      reload();
    } catch (e) {
      setImportMsg(`✗ ${(e as Error).message}`);
    }
  };

  if (loading || !data) return <p className="muted">Loading…</p>;

  const filteredProviders = (providers.data?.providers ?? []).filter((p) =>
    p.provider_name.toLowerCase().includes(providerFilter.toLowerCase()),
  );
  const enabledCount = (providers.data?.providers ?? []).filter((p) => p.enabled).length;

  return (
    <div className="settings-section">
      <h1>Settings</h1>

      <div className="panel">
        <h3>API keys</h3>
        <KeyTest source="tmdb" label="TMDB (metadata, posters, providers)" present={data.keys.tmdb} />
        <KeyTest source="omdb" label="OMDb (RT / IMDb / Metacritic scores)" present={data.keys.omdb} />
        <KeyTest source="tvmaze" label="TVmaze (broadcast schedule, no key needed)" present={null} />
        {data.keys.omdb && data.omdb_quota_remaining !== null && (
          <div className="kv">
            <span className="k">OMDb quota remaining today</span>
            <span>{data.omdb_quota_remaining} requests</span>
          </div>
        )}
        <p className="faint">Keys are read from the .env file at startup; edit it and restart the container to change them.</p>
      </div>

      <div className="panel">
        <h3>Region & schedule</h3>
        <div className="kv">
          <span className="k">Watch-provider region</span>
          <select value={data.settings.region} onChange={(e) => void saveSetting('region', e.target.value)}>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="kv">
          <span className="k">Broadcast schedule country (TVmaze)</span>
          <select value={data.settings.schedule_country} onChange={(e) => void saveSetting('schedule_country', e.target.value)}>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="kv">
          <span className="k">Broadcast TV networks (Browse filter, TMDB network ids)</span>
          <input
            defaultValue={data.settings.broadcast_networks}
            onBlur={(e) => {
              if (e.target.value !== data.settings.broadcast_networks) void saveSetting('broadcast_networks', e.target.value);
            }}
            aria-label="Broadcast network ids"
            style={{ width: 180 }}
          />
        </div>
        <p className="faint">
          Pipe-separated TMDB network ids for the Browse “Broadcast TV” filter. Default 2|6|16|19|71 = ABC, NBC, CBS, Fox, The CW.
        </p>
      </div>

      <div className="panel">
        <h3>My streaming services ({enabledCount} enabled)</h3>
        <p className="faint" style={{ marginTop: 0 }}>
          Toggle the services you subscribe to — they drive highlighting, the “Wishlist — Available Now” row, and
          arrived/left alerts. Provider data by JustWatch.
        </p>
        <input
          placeholder="Filter providers…"
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          style={{ width: '100%', marginBottom: 10 }}
        />
        {providers.error && <p className="muted">{providers.error}</p>}
        <div className="providers" style={{ maxHeight: 320, overflowY: 'auto' }}>
          {filteredProviders.map((p) => (
            <button
              key={p.provider_id}
              className={`provider ${p.enabled ? 'mine' : ''}`}
              onClick={() => void toggleProvider(p)}
              aria-pressed={p.enabled}
            >
              {p.logo_path && <img src={img(p.logo_path, 'w92') ?? ''} alt="" />}
              {p.provider_name}
              {p.enabled ? ' ✓' : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>Data</h3>
        <div className="kv">
          <span className="k">Database file</span>
          <span style={{ wordBreak: 'break-all' }}>{data.db.path} ({fmtBytes(data.db.size_bytes)})</span>
        </div>
        <div className="kv">
          <span className="k">Export library</span>
          <a href="/api/export" download><button>download JSON</button></a>
        </div>
        <div className="kv">
          <span className="k">Import library (replaces current data)</span>
          <span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && window.confirm('Importing replaces ALL current library data. Continue?')) void doImport(f);
                e.target.value = '';
              }}
            />
            <button onClick={() => fileRef.current?.click()}>choose file…</button>
            {importMsg && <span className="faint" style={{ marginLeft: 8 }}>{importMsg}</span>}
          </span>
        </div>
      </div>

      <div className="panel">
        <h3>Sync health</h3>
        {sync.data && (
          <>
            <div className="kv">
              <span className="k">Currently</span>
              <span>
                {sync.data.state.running
                  ? `running ${sync.data.state.scope} (${sync.data.state.done}/${sync.data.state.total})`
                  : `idle${sync.data.state.lastFinishedAt ? `, last finished ${new Date(sync.data.state.lastFinishedAt).toLocaleString()}` : ''}`}
              </span>
            </div>
            <table className="list-table" style={{ marginTop: 8 }}>
              <thead>
                <tr><th>Job</th><th>Started</th><th>Result</th></tr>
              </thead>
              <tbody>
                {sync.data.log.slice(0, 15).map((l) => (
                  <tr key={l.id}>
                    <td>{l.source} / {l.scope}</td>
                    <td className="muted">{new Date(l.started_at).toLocaleString()}</td>
                    <td>{l.ok === null ? <span className="muted">running…</span> : l.ok ? '✓ ok' : <span style={{ color: 'var(--bad)' }} title={l.error ?? ''}>✗ {l.error?.slice(0, 60)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <button style={{ marginTop: 10 }} onClick={() => sync.reload()}>refresh log</button>
      </div>
    </div>
  );
}
