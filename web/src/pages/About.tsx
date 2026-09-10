import { Link } from 'react-router-dom';
import { useApi } from '../api';

export default function About() {
  const health = useApi<{ version: string }>('/api/health');
  return <article className="about-page">
    <h1>About watch-it</h1>
    <p>A single-user app you install and control. {health.data && `Version ${health.data.version}.`}</p>
    <h2>Credits</h2>
    <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer"><img src="/tmdb-logo.svg" alt="TMDB" width="100" /></a>
    <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    <p>Watch-provider data is supplied by <a href="https://www.justwatch.com/">JustWatch</a> through TMDB. Ratings come from <a href="https://www.omdbapi.com/">OMDb</a>. Broadcast schedules come from <a href="https://www.tvmaze.com/api#licensing">TVmaze</a>.</p>
    <h2>Your data</h2>
    <p>Your library, watched episodes, notes, preferences, sessions, and backups stay on your installation. The app has no telemetry or automatic support uploads.</p>
    <p>Your server requests search terms, title details, regional offers, images, ratings, and schedules from their respective providers. Opening an external source or watch-options link connects your browser to that website. Providers apply their own privacy policies.</p>
    <p>Use <Link to="/settings">Settings</Link> to export or restore your profile. Exported profiles contain your personal library and notes, so keep them private.</p>
    <h2>Coverage and support</h2>
    <p>Genres search the matching TMDB catalog across services. Availability varies by region and may be cached or incomplete. English-audio evidence is dated and partial; confirm the track and episode on your streaming service. Adaptations come from a separate curated list.</p>
    <p>For installation and recovery instructions, see the <a href="https://github.com/mgelsinger/watch-it#readme">project documentation</a>. Report ordinary bugs through <a href="https://github.com/mgelsinger/watch-it/issues">project issues</a>. Review your report before posting and leave out API keys, passwords, notes, and backup files. Consult SECURITY.md before reporting a security issue.</p>
  </article>;
}
