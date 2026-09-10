export default function VersionPreferences({ preferEnglish, includeAdaptations, onChange }: {
  preferEnglish: boolean;
  includeAdaptations: boolean;
  onChange: (patch: { preferEnglish?: boolean; includeAdaptations?: boolean }) => void;
}) {
  return (
    <div className="version-preferences">
      <label>
        <input type="checkbox" checked={preferEnglish} onChange={(e) => onChange({ preferEnglish: e.target.checked })} />
        {' '}English audio preferred
      </label>
      <p className="faint">Known English versions come first in each batch. Titles with unconfirmed audio stay included. Check English audio on your service.</p>
      <label>
        <input type="checkbox" checked={includeAdaptations} onChange={(e) => onChange({ includeAdaptations: e.target.checked })} />
        {' '}Include American remakes/adaptations
      </label>
      <p className="faint">Adds known English-language remakes and anime/manga adaptations to the selected genres. These extra matches do not limit the genre results; adaptation coverage is partial.</p>
    </div>
  );
}
