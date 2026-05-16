#!/usr/bin/env python3
"""
Writingway app server.

Serves the repo as static files and exposes a small JSON API for
filesystem-backed project saves.
"""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import stat
import tarfile
import tempfile
import threading
import urllib.request
import zipfile
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


HOST = "127.0.0.1"
PORT = 8000
ROOT = Path(__file__).resolve().parent.parent
PROJECTS_DIR = ROOT / "projects"
BACKUPS_DIR = ROOT / "project-backups"
MODELS_DIR = ROOT / "models"
LLAMA_DIR = ROOT / "llama"
LLAMA_RELEASE_API = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest"
HTTP_HEADERS = {
    "User-Agent": "Writingway/2.0",
    "Accept": "application/vnd.github+json",
}


def json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def sanitize_filename(value: str) -> str:
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1F]+', "_", value or "").strip()
    safe = re.sub(r"\s+", " ", safe).strip(" .")
    return safe[:80] or "project"


def project_filename(project: dict) -> str:
    project_id = str(project.get("id") or "").strip()
    if not project_id:
        raise ValueError("Project id is required")
    safe_name = sanitize_filename(str(project.get("name") or "project"))
    return f"{safe_name}--{project_id}.json"


def project_backup_dir(project_id: str) -> Path:
    safe_project_id = sanitize_filename(project_id)
    return BACKUPS_DIR / safe_project_id


def runtime_platform() -> tuple[str, str]:
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "darwin":
        platform_id = "macos"
    elif system == "windows":
        platform_id = "windows"
    else:
        platform_id = system

    if machine in {"x86_64", "amd64"}:
        arch = "x64"
    elif machine in {"arm64", "aarch64"}:
        arch = "arm64"
    else:
        arch = machine

    return platform_id, arch


def llama_server_filename() -> str:
    platform_id, _ = runtime_platform()
    return "llama-server.exe" if platform_id == "windows" else "llama-server"


def llama_server_path() -> Path:
    return LLAMA_DIR / llama_server_filename()


def find_gguf_models() -> list[str]:
    if not MODELS_DIR.exists():
        return []
    return sorted(path.name for path in MODELS_DIR.glob("*.gguf") if path.is_file())


def llama_install_choices(platform_id: str, arch: str) -> list[dict]:
    if platform_id not in {"windows", "linux", "macos"} or arch not in {"x64", "arm64"}:
        return []

    choices = [{"id": "cpu", "label": "CPU", "description": "Runs on the CPU. Slowest, but works on most systems."}]

    if platform_id == "windows" and arch == "x64":
        choices.append(
            {
                "id": "cuda",
                "label": "NVIDIA GPU (CUDA)",
                "description": "Use this if you have an NVIDIA GPU with CUDA drivers installed.",
            }
        )

    return choices


def runtime_info() -> dict:
    platform_id, arch = runtime_platform()
    gguf_models = find_gguf_models()
    has_llama = llama_server_path().exists()
    install_choices = llama_install_choices(platform_id, arch)

    return {
        "ok": True,
        "platform": platform_id,
        "arch": arch,
        "hasGGUFModels": len(gguf_models) > 0,
        "ggufModels": gguf_models,
        "hasLlamaServer": has_llama,
        "llamaServerPath": str(llama_server_path().relative_to(ROOT)),
        "localAIAvailable": has_llama and len(gguf_models) > 0,
        "llamaSetupRecommended": len(gguf_models) > 0 and not has_llama and len(install_choices) > 0,
        "llamaInstallChoices": install_choices,
    }


def backup_filename(project: dict, exported_at: str | None = None) -> str:
    project_id = str(project.get("id") or "").strip()
    if not project_id:
        raise ValueError("Project id is required")
    safe_name = sanitize_filename(str(project.get("name") or "project"))
    timestamp = exported_at or datetime.now(timezone.utc).isoformat()
    timestamp = timestamp.replace(":", "-").replace(".", "-").replace("+00:00", "Z")
    return f"{timestamp}--{safe_name}--{sanitize_filename(project_id)}.json"


def github_json(url: str) -> dict:
    request = urllib.request.Request(url, headers=HTTP_HEADERS)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def select_llama_asset(assets: list[dict], platform_id: str, arch: str, variant: str) -> dict:
    excluded_gpu_terms = ("vulkan", "rocm", "openvino", "sycl", "hip")

    scored: list[tuple[int, dict]] = []
    for asset in assets:
        name = str(asset.get("name") or "").lower()
        if not name or not (
            name.endswith(".zip")
            or name.endswith(".tar.gz")
            or name.endswith(".tgz")
        ):
            continue

        score = 0

        if platform_id == "windows":
            if "win" not in name or arch not in name:
                continue
            score += 20
            if variant == "cuda":
                if "cuda" not in name:
                    continue
                score += 20
                if "cudart" in name:
                    score += 5
            else:
                if "cuda" in name or any(term in name for term in excluded_gpu_terms):
                    continue
                score += 10
        elif platform_id == "linux":
            if not any(term in name for term in ("ubuntu", "linux")) or arch not in name:
                continue
            score += 20
            if variant != "cpu":
                continue
            if any(term in name for term in excluded_gpu_terms):
                continue
            score += 10
        elif platform_id == "macos":
            if "macos" not in name or arch not in name:
                continue
            score += 20
            if variant != "cpu":
                continue
            score += 10
        else:
            continue

        if "server" in name:
            score += 3
        if name.endswith(".zip"):
            score += 1
        scored.append((score, asset))

    if not scored:
        raise RuntimeError(f"Could not find a llama.cpp asset for {platform_id}/{arch} ({variant}).")

    scored.sort(key=lambda item: (-item[0], len(str(item[1].get("name") or ""))))
    return scored[0][1]


def download_file(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers=HTTP_HEADERS)
    with urllib.request.urlopen(request, timeout=120) as response, destination.open("wb") as out_file:
        shutil.copyfileobj(response, out_file)


def extract_archive(archive_path: Path, target_dir: Path) -> None:
    with tempfile.TemporaryDirectory() as temp_dir_str:
        temp_dir = Path(temp_dir_str)

        if archive_path.name.endswith(".zip"):
            with zipfile.ZipFile(archive_path, "r") as archive:
                archive.extractall(temp_dir)
        elif archive_path.name.endswith(".tar.gz") or archive_path.name.endswith(".tgz"):
            with tarfile.open(archive_path, "r:gz") as archive:
                archive.extractall(temp_dir)
        else:
            raise RuntimeError(f"Unsupported archive type: {archive_path.name}")

        entries = [p for p in temp_dir.iterdir() if p.name != "__MACOSX"]
        source_root = entries[0] if len(entries) == 1 and entries[0].is_dir() else temp_dir

        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)

        for item in source_root.iterdir():
            destination = target_dir / item.name
            if item.is_dir():
                shutil.copytree(item, destination, dirs_exist_ok=True)
            else:
                shutil.copy2(item, destination)


def ensure_llama_server_executable() -> None:
    executable = llama_server_path()
    if not executable.exists():
        nested = list(LLAMA_DIR.rglob(llama_server_filename()))
        if nested:
            source = nested[0]
            target = LLAMA_DIR / llama_server_filename()
            if source != target:
                shutil.copy2(source, target)
                executable = target

    if not executable.exists():
        raise RuntimeError("llama-server executable was not found after extraction.")

    if runtime_platform()[0] != "windows":
        executable.chmod(executable.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def install_llama_cpp(variant: str) -> dict:
    info = runtime_info()
    platform_id = info["platform"]
    arch = info["arch"]

    supported_variants = {choice["id"] for choice in info["llamaInstallChoices"]}
    if variant not in supported_variants:
        raise RuntimeError(f"Unsupported install choice: {variant}")

    release = github_json(LLAMA_RELEASE_API)
    asset = select_llama_asset(release.get("assets") or [], platform_id, arch, variant)
    asset_name = str(asset.get("name") or "")
    asset_url = str(asset.get("browser_download_url") or "")
    if not asset_name or not asset_url:
        raise RuntimeError("Selected llama.cpp release asset is missing download metadata.")

    LLAMA_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        archive_path = temp_dir / asset_name
        download_file(asset_url, archive_path)
        extract_archive(archive_path, LLAMA_DIR)

    ensure_llama_server_executable()

    return {
        "ok": True,
        "installed": True,
        "assetName": asset_name,
        "platform": platform_id,
        "arch": arch,
        "variant": variant,
        "llamaServerPath": str(llama_server_path().relative_to(ROOT)),
        "requiresRestart": True,
    }


class WritingwayHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def respond_json(self, status: int, payload: dict) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/health":
            self.respond_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "service": "writingway-server",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
            return
        if parsed.path == "/api/runtime-info":
            self.respond_json(HTTPStatus.OK, runtime_info())
            return
        if parsed.path == "/api/list-backups":
            self.handle_list_backups(parsed.query)
            return
        if parsed.path == "/api/get-backup":
            self.handle_get_backup(parsed.query)
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/save-project":
            self.handle_save_project()
            return
        if self.path == "/api/install-llama":
            self.handle_install_llama()
            return
        if self.path == "/api/create-backup":
            self.handle_create_backup()
            return
        if self.path == "/api/shutdown":
            self.handle_shutdown()
            return
        self.respond_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})

    def handle_save_project(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid Content-Length"})
            return

        if length <= 0:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Request body is required"})
            return

        try:
            raw = self.rfile.read(length)
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON"})
            return

        project = payload.get("project") if isinstance(payload, dict) else None
        if not isinstance(project, dict):
            self.respond_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Missing project payload"})
            return

        try:
            PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
            filename = project_filename(project)
            target = PROJECTS_DIR / filename
            project_id = str(project.get("id"))

            for existing in PROJECTS_DIR.glob(f"*--{project_id}.json"):
                if existing != target and existing.exists():
                    existing.unlink()

            payload["filesystemSavedAt"] = datetime.now(timezone.utc).isoformat()
            payload["filesystemSaveVersion"] = 1

            with tempfile.NamedTemporaryFile(
                "w",
                encoding="utf-8",
                dir=str(PROJECTS_DIR),
                delete=False,
                suffix=".tmp",
            ) as tmp_file:
                json.dump(payload, tmp_file, ensure_ascii=False, indent=2)
                tmp_file.write("\n")
                temp_name = tmp_file.name

            os.replace(temp_name, target)

            self.respond_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "path": str(target.relative_to(ROOT)),
                    "filename": filename,
                },
            )
        except Exception as exc:
            self.respond_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"ok": False, "error": str(exc)},
            )

    def read_json_payload(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid Content-Length"})
            return None

        if length <= 0:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Request body is required"})
            return None

        try:
            raw = self.rfile.read(length)
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON"})
            return None
        return payload

    def handle_create_backup(self):
        payload = self.read_json_payload()
        if payload is None:
            return

        project = payload.get("project") if isinstance(payload, dict) else None
        if not isinstance(project, dict):
            self.respond_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Missing project payload"})
            return

        try:
            project_id = str(project.get("id") or "").strip()
            if not project_id:
                raise ValueError("Project id is required")

            backup_dir = project_backup_dir(project_id)
            backup_dir.mkdir(parents=True, exist_ok=True)
            filename = backup_filename(project, payload.get("exportedAt"))
            target = backup_dir / filename

            payload["localBackupSavedAt"] = datetime.now(timezone.utc).isoformat()
            payload["localBackupVersion"] = 1

            with tempfile.NamedTemporaryFile(
                "w",
                encoding="utf-8",
                dir=str(backup_dir),
                delete=False,
                suffix=".tmp",
            ) as tmp_file:
                json.dump(payload, tmp_file, ensure_ascii=False, indent=2)
                tmp_file.write("\n")
                temp_name = tmp_file.name

            os.replace(temp_name, target)

            self.respond_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "backupId": filename,
                    "path": str(target.relative_to(ROOT)),
                    "timestamp": payload["localBackupSavedAt"],
                },
            )
        except Exception as exc:
            self.respond_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"ok": False, "error": str(exc)},
            )

    def handle_install_llama(self):
        payload = self.read_json_payload()
        if payload is None:
            return

        variant = str(payload.get("variant") or "cpu").strip().lower()
        try:
            self.respond_json(HTTPStatus.OK, install_llama_cpp(variant))
        except Exception as exc:
            self.respond_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"ok": False, "error": str(exc)},
            )

    def handle_shutdown(self):
        self.respond_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "message": "Writingway is shutting down. Restart the launcher to enable local AI.",
            },
        )
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def handle_list_backups(self, query: str):
        params = parse_qs(query or "")
        project_id = (params.get("projectId") or [""])[0].strip()
        if not project_id:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Missing projectId"})
            return

        try:
            backup_dir = project_backup_dir(project_id)
            backups = []
            if backup_dir.exists():
                for backup_file in sorted(backup_dir.glob("*.json"), reverse=True):
                    stat = backup_file.stat()
                    backups.append(
                        {
                            "id": backup_file.name,
                            "timestamp": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                            "path": str(backup_file.relative_to(ROOT)),
                            "size": stat.st_size,
                        }
                    )

            self.respond_json(HTTPStatus.OK, {"ok": True, "backups": backups})
        except Exception as exc:
            self.respond_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"ok": False, "error": str(exc)},
            )

    def handle_get_backup(self, query: str):
        params = parse_qs(query or "")
        project_id = (params.get("projectId") or [""])[0].strip()
        backup_id = (params.get("backupId") or [""])[0].strip()
        if not project_id or not backup_id:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Missing projectId or backupId"})
            return

        if Path(backup_id).name != backup_id:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid backupId"})
            return

        try:
            backup_file = project_backup_dir(project_id) / backup_id
            if not backup_file.exists() or not backup_file.is_file():
                self.respond_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Backup not found"})
                return

            with backup_file.open("r", encoding="utf-8") as f:
                backup = json.load(f)

            self.respond_json(HTTPStatus.OK, {"ok": True, "backup": backup})
        except Exception as exc:
            self.respond_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"ok": False, "error": str(exc)},
            )


def main():
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), WritingwayHandler)
    print(f"Writingway server running at http://{HOST}:{PORT}")
    print(f"Project saves will be written to {PROJECTS_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nWritingway server stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
