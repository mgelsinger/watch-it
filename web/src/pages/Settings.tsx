import { useRef, useState } from 'react';
import { api, img, useApi } from '../api';
import type { Provider, SyncLogRow, SyncState } from '../types';

interface SettingsData {
  settings: Record<string, string>;
  keys: { tmdb: boolean; omdb: boolean };
  omdb_quota_remaining: number | null;
  db: { path: string; size_bytes: number };
}

interface BackupPreview {
  exported_at: string;
  version: number;
  checksum_verified: boolean;
  legacy: boolean;
  titles: number;
  movies: number;
  shows: number;
  watched_titles: number;
  watched_episodes: number;
  saved_for_later: number;
  watchlist: number;
  watching: number;
  never_suggest: number;
}

interface SaveFilePickerHandle {
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
}

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<SaveFilePickerHandle>;
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
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<unknown>(null);
  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null);

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

  const exportBackup = async () => {
    setBackupBusy(true);
    setBackupMsg('Preparing your backup...');
    try {
      const suggestedName = `watch-it-profile-${new Date().toISOString().slice(0, 10)}.watchit.json`;
      const saveWindow = window as SaveFilePickerWindow;
      const handle = saveWindow.showSaveFilePicker
        ? await saveWindow.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'Watch It profile backup', accept: { 'application/json': ['.json'] } }],
        })
        : null;
      const response = await fetch('/api/backup/export');
      if (!response.ok) throw new Error(`Could not create backup (${response.status})`);
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = disposition.match(/filename="?([^";]+)"?/)?.[1] ?? suggestedName;
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setBackupMsg('Backup saved to the location you selected.');
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
        setBackupMsg('Backup downloaded. Move it to your NAS if your browser did not ask where to save it.');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setBackupMsg(`Backup failed: ${(e as Error).message}`);
    } finally {
      setBackupBusy(false);
    }
  };

  const inspectBackupFile = async (file: File) => {
    setBackupBusy(true);
    setBackupMsg('Checking the backup...');
    setBackupPreview(null);
    setSelectedBackup(null);
    try {
      const json = JSON.parse(await file.text()) as unknown;
      const result = await api<{ ok: boolean; preview: BackupPreview }>('/api/backup/inspect', { json });
      setSelectedBackup(json);
      setBackupPreview(result.preview);
      setBackupMsg('Backup checked successfully. Review it below before restoring.');
    } catch (e) {
      setBackupMsg(`This backup cannot be used: ${(e as Error).message}`);
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreSelectedBackup = async (mode: 'merge' | 'replace') => {
    if (!selectedBackup || !backupPreview) return;
    const question = mode === 'merge'
      ? 'Restore this backup? Existing information will be kept and combined with the backup.'
      : 'Replace the current profile with this backup? A local safety copy will be created first.';
    if (!window.confirm(question)) return;
    setBackupBusy(true);
    setBackupMsg('Restoring your profile...');
    try {
      const result = await api<{ ok: boolean; preview: BackupPreview; safety_backup: string }>('/api/backup/restore', {
        json: { backup: selectedBackup, mode },
      });
      setBackupMsg(`Restore complete. ${result.preview.titles} titles are in the imported backup. A safety copy of the previous profile was kept.`);
      setSelectedBackup(null);
      setBackupPreview(null);
      reload();
      providers.reload();
      sync.reload();
    } catch (e) {
      setBackupMsg(`Restore failed without changing your profile: ${(e as Error).message}`);
    } finally {
      setBackupBusy(false);
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
          Toggle the services you subscribe to - they drive highlighting, the “Watchlist - Available Now” row, and
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
        <h3>Data safety</h3>
        <p className="faint" style={{ marginTop: 0 }}>
          Keep a portable copy of your library, watched episodes, lists, ratings, notes, preferences, and Never Suggest choices.
          Save the file to your NAS or another safe location. It can restore a fresh Watch It installation on Windows or Linux.
        </p>
        <div className="kv">
          <span className="k">Database file</span>
          <span style={{ wordBreak: 'break-all' }}>{data.db.path} ({fmtBytes(data.db.size_bytes)})</span>
        </div>
        <div className="kv">
          <span className="k">Back up this profile</span>
          <button className="primary" onClick={() => void exportBackup()} disabled={backupBusy}>
            {backupBusy ? 'Working...' : 'Choose location and save backup'}
          </button>
        </div>
        <div className="kv">
          <span className="k">Import a profile backup</span>
          <span>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.watchit.json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void inspectBackupFile(f);
                e.target.value = '';
              }}
            />
            <button onClick={() => fileRef.current?.click()} disabled={backupBusy}>Choose backup file</button>
          </span>
        </div>
        {backupMsg && <p className="faint" role="status">{backupMsg}</p>}
        {backupPreview && (
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 14 }}>
            <h4 style={{ margin: '0 0 8px' }}>Backup ready to restore</h4>
            <p style={{ margin: '0 0 10px' }}>
              Created {new Date(backupPreview.exported_at).toLocaleString()} with {backupPreview.titles} titles
              ({backupPreview.shows} shows and {backupPreview.movies} movies), {backupPreview.watched_titles} watched titles,
              and {backupPreview.watched_episodes} watched episodes.
            </p>
            <p className="faint" style={{ margin: '0 0 12px' }}>
              {backupPreview.legacy
                ? 'This is an older Watch It export. It will be converted during restore.'
                : 'The backup checksum was verified. The file is complete and has not been damaged.'}
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="primary" onClick={() => void restoreSelectedBackup('merge')} disabled={backupBusy}>
                Restore backup
              </button>
              <button onClick={() => void restoreSelectedBackup('replace')} disabled={backupBusy}>
                Replace current profile
              </button>
              <button onClick={() => { setSelectedBackup(null); setBackupPreview(null); setBackupMsg(null); }} disabled={backupBusy}>
                Cancel
              </button>
            </div>
            <p className="faint" style={{ marginBottom: 0 }}>
              Restore backup is the safer choice. It combines both profiles without removing watched history. Replace current profile makes this backup authoritative.
            </p>
          </div>
        )}
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
