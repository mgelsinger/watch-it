import { useState } from 'react';
import { api } from '../api';

export default function ApiKeyField({ source, present, managed, onSaved }: {
  source: 'tmdb' | 'omdb'; present: boolean; managed: boolean; onSaved: () => void;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const label = source === 'tmdb' ? 'TMDB API key' : 'OMDb API key';
  const save = async (value: string) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await api(`/api/settings/keys/${source}`, { method: 'PUT', headers: { 'x-watch-it-settings': '1' }, json: { key: value } });
      setKey('');
      setMessage(value ? `${label} verified and saved. It works immediately.` : `${label} removed.`);
      onSaved();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <form className="api-key-field" onSubmit={(event) => { event.preventDefault(); void save(key.trim()); }}>
    <label htmlFor={`${source}-key`}><strong>{label}</strong> {source === 'tmdb' ? '(required for discovery)' : '(optional extra ratings)'}</label>
    {source === 'tmdb' ? <ol className="faint">
      <li>Sign in to <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">TMDB API settings</a> and apply for API access for your actual use.</li>
      <li>Copy the <strong>API Key</strong> (32 characters). The API Read Access Token is a different credential.</li>
      <li>Paste it below and select <strong>Verify and save TMDB key</strong>.</li>
    </ol> : <p className="faint">To add IMDb, Rotten Tomatoes and Metacritic scores where available, <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noreferrer">request an OMDb key</a>, follow the activation email, then paste the key below. You can skip this.</p>}
    {managed ? <p className="muted">Configured by the installation environment. To manage it here, clear {source.toUpperCase()}_API_KEY in .env and run <code>docker compose up -d --no-build</code>. Existing environment setup remains supported.</p> : <div className="key-actions">
      <input id={`${source}-key`} aria-label={label} type="password" autoComplete="off" spellCheck={false}
        value={key} onChange={(event) => setKey(event.target.value)} placeholder={present ? 'Paste a replacement key' : 'Paste your key here'} maxLength={128} disabled={busy} />
      <button className="primary" disabled={busy || !key.trim()}>{busy ? 'Verifying...' : `Verify and save ${source === 'tmdb' ? 'TMDB' : 'OMDb'} key`}</button>
      {present && <button type="button" disabled={busy} onClick={() => void save('')}>Remove {source === 'tmdb' ? 'TMDB' : 'OMDb'} key</button>}
    </div>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
