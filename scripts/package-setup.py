"""Build a self-contained setup ZIP from an already-tested Docker image archive.

Python is a release-maintainer dependency only. End users only need Docker.
Files are explicitly allowed here; the working directory and .env are never zipped.
"""
import json
from pathlib import Path
import re
import sys
from zipfile import ZIP_DEFLATED, ZipFile


def package_setup(image_archive: Path) -> Path:
    root = Path(__file__).resolve().parent.parent
    version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version):
        raise ValueError("Invalid package version")
    image_archive = image_archive.resolve(strict=True)
    expected_name = f"watch-it-{version}-linux-amd64.tar"
    if image_archive.name != expected_name:
        raise ValueError("Image archive name must match the application version")
    compose = (root / "docker-compose.yml").read_text(encoding="utf-8")
    if compose.count("    build: .\n") != 1:
        raise ValueError("Review the changed Compose build definition before packaging")
    compose = compose.replace("    build: .\n", "")
    compose = compose.replace("watch-it:local", f"watch-it:{version}")
    env = (root / ".env.example").read_text(encoding="utf-8").replace("watch-it:local", f"watch-it:{version}")
    for name in ("TMDB_API_KEY", "OMDB_API_KEY", "WATCH_IT_PASSWORD"):
        if not re.search(rf"^{name}=\s*$", env, re.MULTILINE):
            raise ValueError(f"The example configuration must leave {name} empty")
    start = f"""# Start watch-it {version}

1. Install and start Docker with Compose. Windows uses Linux containers.
2. Open a terminal in this extracted folder.
3. Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`; Linux: `cp .env.example .env`).
4. Leave the template defaults for a local installation. API keys will be entered in the app.
5. Load and start the tested image:

```sh
docker load --input {expected_name}
docker compose up -d --no-build --wait
```

6. Open http://localhost:8300. In Settings > API keys > TMDB API key, paste your key and choose Verify and save TMDB key. The field links to TMDB's key application. OMDb is optional. Choose your region.
7. Open Pick For Me, choose 45 min and Light / comedy, then select your streaming services. Save a recommendation to your Watchlist. Your library can start empty.

No video files needed. Watch It does not play video; playback happens on your streaming service.
One shared library per installation. Try the separate sample demo at http://localhost:8300/demo/ without any keys.

No Git, Node.js, Python, or source build is needed. Keep this folder for future Compose commands.
After changing `.env`, run `docker compose up -d --no-build` to apply it.

[Full setup and troubleshooting](docs/INSTALL.md) | [Upgrades and backups](docs/OPERATIONS.md)

This bundle targets Linux x86-64 containers, including Docker Desktop on Windows.
Use the upgrade guide for an existing installation; moving to a new Compose project can create a new empty volume.
"""
    output = image_archive.with_suffix(".zip")
    include = [
        "docs/INSTALL.md", "docs/OPERATIONS.md", "docs/PRIVACY.md",
        "docs/ATTRIBUTION.md", "docs/PROVIDERS.md", "docs/DEPENDENCY_REVIEW.md", "docs/RELEASE_NOTES.md",
        "SECURITY.md", "docker-compose.https.yml", "deploy/Caddyfile", "web/public/tmdb-logo.svg",
    ]
    if (root / "LICENSE").is_file():
        include.append("LICENSE")
    with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=6) as bundle:
        bundle.write(image_archive, expected_name)
        bundle.writestr("docker-compose.yml", compose)
        bundle.writestr(".env.example", env)
        bundle.writestr("START_HERE.md", start)
        for filename in include:
            bundle.write(root / filename, filename)
    with ZipFile(output) as bundle:
        invalid = bundle.testzip()
        if invalid:
            raise ValueError(f"Archive validation failed: {invalid}")
    print(f"Created {output.name}")
    return output


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/package-setup.py <tested-image.tar>")
    package_setup(Path(sys.argv[1]))
