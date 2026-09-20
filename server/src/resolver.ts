// The app contacts fully qualified provider hosts. Disable inherited DNS search
// suffixes before any lookup, including LOCALDOMAIN supplied by the operator.
// This avoids glibc CVE-2026-8674's long-search-list assertion on Linux.
if (process.platform === 'linux') process.env.LOCALDOMAIN = '.';
