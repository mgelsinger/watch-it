"""Install the actual setup ZIP in an isolated Compose project and volume."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from uuid import uuid4
from zipfile import ZipFile

root = Path(__file__).resolve().parent.parent
archive = Path(sys.argv[1]).resolve(strict=True)
version = json.loads((root / "package.json").read_text())["version"]
project = "watch-it-setup-test-" + uuid4().hex[:10]
work = Path(tempfile.mkdtemp(prefix=project + "-"))
environment = os.environ.copy()
for line in (root / ".env.example").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        environment.pop(line.split("=", 1)[0], None)
for name in ("COMPOSE_FILE", "COMPOSE_PROJECT_NAME", "COMPOSE_ENV_FILES", "COMPOSE_PROFILES"):
    environment.pop(name, None)


def docker(*args):
    result = subprocess.run(["docker", *args], cwd=work, env=environment,
                            capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError(f"Docker {args[0]} failed: {result.stderr[-2000:]}")
    return result.stdout


def request(base, route):
    with urllib.request.urlopen(base + route, timeout=15) as response:
        return json.load(response)


compose = ["compose", "-p", project, "-f", "docker-compose.yml", "-f", "test.override.yml"]
started = False
try:
    with ZipFile(archive) as bundle:
        names = set(bundle.namelist())
        required = {"docker-compose.yml", ".env.example", "START_HERE.md",
                    "docs/INSTALL.md", "docs/OPERATIONS.md", "docs/PROVIDERS.md", f"watch-it-{version}-linux-amd64.tar"}
        assert required <= names, "Missing setup files"
        assert ".env" not in names, "A private .env must never be packaged"
        for entry in bundle.infolist():
            assert (work / entry.filename).resolve().is_relative_to(work), "Unsafe archive path"
        bundle.extractall(work)
    shutil.copyfile(work / ".env.example", work / ".env")
    # Isolate names and ports only. The downloaded configuration, image, and
    # environment defaults remain the ones actually used for installation.
    (work / "test.override.yml").write_text(
        f"services:\n  watch-it:\n    container_name: {project}-app\n"
        "    ports: !override\n      - '127.0.0.1::8300'\n", encoding="utf-8")
    config = json.loads(docker(*compose, "config", "--format", "json"))
    service = config["services"]["watch-it"]
    assert "build" not in service, "Downloaded setup must not require source"
    assert service["image"] == f"watch-it:{version}", "Version must match the loaded image"
    assert service["environment"]["TMDB_API_KEY"] == ""
    assert service["environment"]["WATCH_IT_PASSWORD"] == ""
    docker("load", "--input", f"watch-it-{version}-linux-amd64.tar")
    started = True
    docker(*compose, "up", "-d", "--no-build", "--wait", "--wait-timeout", "90")
    address = docker(*compose, "port", "watch-it", "8300").strip()
    base = "http://" + address
    assert request(base, "/api/health")["ok"] is True
    assert request(base, "/api/settings")["keys"]["tmdb"] is False
    assert request(base, "/api/titles")["titles"] == []
    with urllib.request.urlopen(base + "/demo/", timeout=15) as response:
        assert b"Sample content only." in response.read()
    live = "--live" in sys.argv[2:]
    if live:
        # The helper reads only the local TMDB key and never records browser traces or the key.
        subprocess.run(["node", str(root / "scripts/setup-journey.mjs"), base], cwd=root, check=True, timeout=300)
    # Prove the documented command applies a changed .env and keeps the volume.
    with urllib.request.urlopen(urllib.request.Request(base + "/api/settings",
        data=b'{"region":"GB"}', method="PUT", headers={"Content-Type": "application/json"}), timeout=15) as response:
        assert response.status == 200
    with (work / ".env").open("a") as configuration:
        configuration.write("\nIMAGE_CACHE_MB=128\n")
    docker(*compose, "up", "-d", "--no-build", "--wait", "--wait-timeout", "90")
    address = docker(*compose, "port", "watch-it", "8300").strip()
    assert request("http://" + address, "/api/settings")["settings"]["region"] == "GB"
    if live:
        assert request("http://" + address, "/api/settings")["keys"]["tmdb"] is True
        assert len(request("http://" + address, "/api/titles")["titles"]) == 1
        mode = docker(*compose, "exec", "-T", "watch-it", "node", "-e",
            "process.stdout.write((require('node:fs').statSync('/data/credentials.json').mode & 511).toString(8))")
        assert mode == "600", "Stored credential file must be private"
    value = docker(*compose, "exec", "-T", "watch-it", "node", "-e", "process.stdout.write(process.env.IMAGE_CACHE_MB)")
    assert value == "128", "Changed environment was not applied"
    report = {"passed": True, "bundle": archive.name, "checks": ["required-files", "blank-secrets",
        "version-pinned-image", "no-source-build", "fresh-compose-install", "missing-key-guidance",
        "sample-demo", "apply-env-changes", "data-preserved-on-recreation"], "live_journey": live}
    (root / "artifacts/setup-smoke.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
finally:
    if started:
        # -v applies only to this invocation's random disposable Compose project.
        docker(*compose, "down", "-v")
    if work.parent == Path(tempfile.gettempdir()).resolve() and work.name.startswith(project):
        shutil.rmtree(work)
