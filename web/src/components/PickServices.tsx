import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api';
import type { Provider } from '../types';

export default function PickServices({ onSelect }: { onSelect: () => void }) {
  const { data, error, loading, reload, setData } = useApi<{ region: string; providers: Provider[] }>('/api/providers');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const selected = data?.providers.filter((provider) => provider.enabled) ?? [];
  const matches = data?.providers.filter((provider) => provider.provider_name.toLowerCase().includes(filter.trim().toLowerCase())) ?? [];
  const toggle = async (provider: Provider) => {
    setBusy(true); setSaveError('');
    try {
      await api('/api/my-services', { method: 'PUT', json: { provider_id: provider.provider_id, enabled: !provider.enabled } });
      setData(data ? { ...data, providers: data.providers.map((item) => item.provider_id === provider.provider_id ? { ...item, enabled: !item.enabled } : item) } : null);
      if (!provider.enabled) onSelect();
    } catch (err) { setSaveError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="pick-field">
    <div className="pick-label">Your services {data && `(${data.region})`}</div>
    <p className="faint">{selected.length ? selected.map((provider) => provider.provider_name).join(', ') : 'No services selected yet.'}{' · '}<Link to="/settings">Change region or API keys</Link></p>
    <details className="pick-service-picker">
      <summary>Choose your streaming services</summary>
      <p className="faint">Select the subscriptions you use. Channel add-ons are separate choices. Saved for this shared installation.</p>
      <input aria-label="Find your streaming service" type="search" placeholder="Find a service" value={filter} onChange={(event) => setFilter(event.target.value)} />
      {loading && <p className="muted">Loading services...</p>}
      {error && <p role="alert">Services unavailable: {error} <button onClick={reload}>Retry services</button></p>}
      {saveError && <p role="alert">{saveError}</p>}
      <div className="pick-service-options">
        {matches.map((provider) =>
          <label key={provider.provider_id}><input aria-label={`Use ${provider.provider_name}`} type="checkbox" checked={!!provider.enabled} disabled={busy} onChange={() => void toggle(provider)} /> {provider.provider_name}</label>)}
      </div>
      {data && data.providers.length === 0 && <p className="muted">Add a working TMDB key in Settings to load services for your region.</p>}
      {data && data.providers.length > 0 && matches.length === 0 && <p role="status">No services match this search in {data.region}. Try another name or check your region in Settings. <button onClick={() => setFilter('')}>Clear service search</button></p>}
    </details>
  </div>;
}
