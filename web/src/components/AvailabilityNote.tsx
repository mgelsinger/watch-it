import type { AvailabilityCheck } from '../types';

export default function AvailabilityNote({ check }: { check?: AvailabilityCheck }) {
  if (!check || check.status === 'fresh') return null;
  return <p className="faint" role="status">
    {check.status === 'stale' ? 'Cached availability; offers may have changed.' : 'Availability has not been confirmed.'}
    {check.checked_at && ` Last checked ${check.checked_at.slice(0, 10)} (${check.region}).`}
  </p>;
}
