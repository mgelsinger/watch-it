import type { EnglishVersion } from '../types';

export default function VersionNote({ info, compact = false, showUnknown = false }: {
  info?: EnglishVersion;
  compact?: boolean;
  showUnknown?: boolean;
}) {
  if (!info || (info.audio === 'unknown' && !info.adaptation_of && !showUnknown)) return null;
  const label = info.audio === 'dub' ? `English dub listed${info.checked_at ? ` (${info.checked_at})` : ''}` : info.audio === 'original' ? 'English original' : 'English audio unknown';
  return (
    <div className={`version-note ${compact ? 'compact' : ''}`}>
      <div>
        {label}
        {!compact && info.audio_source && <> <a href={info.audio_source} target="_blank" rel="noreferrer">Audio source</a></>}
      </div>
      {info.adaptation_of && (
        <div>
          English adaptation of {info.adaptation_of}
          {!compact && info.adaptation_source && <> <a href={info.adaptation_source} target="_blank" rel="noreferrer">Adaptation source</a></>}
        </div>
      )}
      {!compact && (
        <p className="faint">
          {info.audio_provider && `Audio listed by ${info.audio_provider}${info.audio_region ? ` (${info.audio_region} page)` : ''}. `}
          Check English audio on your streaming service; tracks can vary by region and episode.
          {info.checked_at && ` Source checked ${info.checked_at}.`}
        </p>
      )}
    </div>
  );
}
