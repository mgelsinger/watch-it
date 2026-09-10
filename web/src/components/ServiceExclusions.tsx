import { useState } from 'react';
import { useApi } from '../api';
import type { Provider } from '../types';

export default function ServiceExclusions({ excluded, onChange }: {
  excluded: number[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { data, loading, error, reload } = useApi<{ providers: Provider[] }>(open ? '/api/providers' : null);
  const providers = data?.providers ?? [];
  const missing = excluded.filter((id) => !providers.some((provider) => provider.provider_id === id));
  const options = [...providers, ...missing.map((id) => ({ provider_id: id, provider_name: `Service ${id}` }))]
    .filter((provider) => provider.provider_name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.provider_name.localeCompare(b.provider_name));

  return (
    <details className="service-exclusions" onToggle={(event) => {
      setOpen(event.currentTarget.open);
      if (event.currentTarget.open) for (const details of event.currentTarget.parentElement?.querySelectorAll('details') ?? []) {
        if (details !== event.currentTarget) details.open = false;
      }
    }}>
      <summary>Exclude services{excluded.length > 0 ? ` (${excluded.length})` : ''}</summary>
      <div className="service-exclusions-panel">
        <p className="faint">Choose services to leave out. Titles must be available on a remaining service. Separate channel versions can be excluded too.</p>
        <input type="search" aria-label="Find services to exclude" placeholder="Find a service, e.g. Crunchyroll"
          value={search} onChange={(event) => setSearch(event.target.value)} />
        {excluded.length > 0 && <button type="button" onClick={() => onChange([])}>Clear exclusions</button>}
        {loading && <p className="muted">Loading services...</p>}
        {error && <p role="status">Services unavailable. <button type="button" onClick={reload}>Retry</button></p>}
        <div className="service-exclusions-list" role="group" aria-label="Services to exclude">
          {options.map((provider) => (
            <label key={provider.provider_id}>
              <input type="checkbox" checked={excluded.includes(provider.provider_id)}
                onChange={(event) => onChange(event.target.checked
                  ? [...excluded, provider.provider_id].sort((a, b) => a - b)
                  : excluded.filter((id) => id !== provider.provider_id))} />
              {provider.provider_name}
            </label>
          ))}
        </div>
        {!loading && !error && options.length === 0 && <p className="muted">No matching services.</p>}
      </div>
    </details>
  );
}
