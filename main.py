#!/usr/bin/env python3
"""Writingway local web server.

Serves static files (like `python -m http.server`) and adds local backup APIs.
Default backup directory is `./local_backups` (override with `--backup-dir`):
- POST /api/backups
- GET  /api/backups?projectId=<id>
- GET  /api/backups/<backup_id>
"""

from __future__ import annotations

import argparse
import json
import re
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse


ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_BACKUP_DIR_NAME = "local_backups"
BACKUPS_DIR = ROOT_DIR / DEFAULT_BACKUP_DIR_NAME
MAX_BODY_BYTES = 25 * 1024 * 1024  # 25 MB
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def slugify(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value or "").strip("._-")
    cleaned = cleaned[:80]
    return cleaned or fallback


def resolve_backup_dir(raw_value: str) -> Path:
    candidate = Path(raw_value).expanduser()
    if not candidate.is_absolute():
        candidate = ROOT_DIR / candidate
    return candidate


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT_DIR))
    except ValueError:
        return str(path)


class WritingwayRequestHandler(SimpleHTTPRequestHandler):
    """Static file handler with local backup JSON endpoints."""

    server_version = "WritingwayHTTP/1.0"

    def __init__(self, *args: Any, directory: str | None = None, **kwargs: Any) -> None:
        super().__init__(*args, directory=directory or str(ROOT_DIR), **kwargs)

    def do_GET(self) -> None:  # noqa: N802 - http.server naming
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "service": "writingway-local-server",
                    "backupsDir": str(BACKUPS_DIR),
                },
            )
            return

        if path == "/api/backups":
            project_id = parse_qs(parsed.query).get("projectId", [""])[0]
            backups = self._list_backups(project_id=project_id or None)
            self._send_json(HTTPStatus.OK, {"success": True, "backups": backups})
            return

        if path.startswith("/api/backups/"):
            backup_id = unquote(path.removeprefix("/api/backups/")).strip()
            self._handle_get_backup(backup_id)
            return

        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - http.server naming
        parsed = urlparse(self.path)
        if parsed.path != "/api/backups":
            self._send_json(HTTPStatus.NOT_FOUND, {"success": False, "error": "Not found"})
            return

        payload = self._read_json_body()
        if payload is None:
            return

        if not isinstance(payload, dict):
            self._send_json(HTTPStatus.BAD_REQUEST, {"success": False, "error": "Body must be a JSON object"})
            return

        project = payload.get("project")
        if not isinstance(project, dict) or not project.get("id"):
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"success": False, "error": "Missing required field: project.id"},
            )
            return

        project_id = slugify(str(project.get("id", "")), "project")
        project_name = slugify(str(project.get("name", "")), "project")
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        suffix = uuid.uuid4().hex[:8]
        backup_id = f"{project_id}__{timestamp}__{project_name}__{suffix}"
        backup_path = BACKUPS_DIR / f"{backup_id}.json"

        try:
            BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
            serialized = json.dumps(payload, indent=2, ensure_ascii=False)
            backup_path.write_text(serialized + "\n", encoding="utf-8")
        except OSError as exc:
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"success": False, "error": f"Failed to write backup file: {exc}"},
            )
            return

        exported_at = payload.get("exportedAt") or datetime.now(timezone.utc).isoformat()
        self._send_json(
            HTTPStatus.CREATED,
            {
                "success": True,
                "backup": {
                    "id": backup_id,
                    "version": backup_id,
                    "timestamp": exported_at,
                    "url": f"/api/backups/{backup_id}",
                    "file": display_path(backup_path),
                },
            },
        )

    def _handle_get_backup(self, backup_id: str) -> None:
        if not SAFE_ID_RE.fullmatch(backup_id):
            self._send_json(HTTPStatus.BAD_REQUEST, {"success": False, "error": "Invalid backup ID"})
            return

        backup_path = BACKUPS_DIR / f"{backup_id}.json"
        if not backup_path.exists() or not backup_path.is_file():
            self._send_json(HTTPStatus.NOT_FOUND, {"success": False, "error": "Backup not found"})
            return

        try:
            payload = json.loads(backup_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"success": False, "error": f"Failed to read backup data: {exc}"},
            )
            return

        self._send_json(HTTPStatus.OK, payload)

    def _list_backups(self, project_id: str | None = None) -> list[dict[str, Any]]:
        BACKUPS_DIR.mkdir(parents=True, exist_ok=True)

        entries: list[dict[str, Any]] = []
        for path in BACKUPS_DIR.glob("*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue

            project = payload.get("project") if isinstance(payload, dict) else None
            if not isinstance(project, dict):
                continue

            pid = str(project.get("id", ""))
            if project_id and pid != project_id:
                continue

            mtime = path.stat().st_mtime
            timestamp = payload.get("exportedAt")
            if not isinstance(timestamp, str) or not timestamp:
                timestamp = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()

            backup_id = path.stem
            entries.append(
                {
                    "id": backup_id,
                    "version": backup_id,
                    "timestamp": timestamp,
                    "url": f"/api/backups/{backup_id}",
                    "projectId": pid,
                    "projectName": str(project.get("name", "")),
                    "size": path.stat().st_size,
                    "_mtime": mtime,
                }
            )

        entries.sort(key=lambda item: item.get("_mtime", 0.0), reverse=True)
        for item in entries:
            item.pop("_mtime", None)
        return entries

    def _read_json_body(self) -> dict[str, Any] | list[Any] | None:
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            self._send_json(HTTPStatus.BAD_REQUEST, {"success": False, "error": "Missing Content-Length header"})
            return None

        try:
            length = int(raw_length)
        except ValueError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"success": False, "error": "Invalid Content-Length header"})
            return None

        if length < 0 or length > MAX_BODY_BYTES:
            self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"success": False, "error": "Request body too large"})
            return None

        body = self.rfile.read(length)
        try:
            return json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(HTTPStatus.BAD_REQUEST, {"success": False, "error": "Body must be valid UTF-8 JSON"})
            return None

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(int(status))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Writingway local web server")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="TCP port to bind (default: 8000)")
    parser.add_argument(
        "--backup-dir",
        default=DEFAULT_BACKUP_DIR_NAME,
        help=f"Backup directory path (default: {DEFAULT_BACKUP_DIR_NAME})",
    )
    return parser


def main() -> None:
    global BACKUPS_DIR
    args = build_arg_parser().parse_args()
    BACKUPS_DIR = resolve_backup_dir(args.backup_dir)
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)

    server = ThreadingHTTPServer((args.host, args.port), WritingwayRequestHandler)
    print(f"Writingway web server listening on http://{args.host}:{args.port}")
    print("Static root:", ROOT_DIR)
    print("Backup directory:", BACKUPS_DIR)
    print("Backup API:")
    print("  POST /api/backups")
    print("  GET  /api/backups?projectId=<id>")
    print("  GET  /api/backups/<backup_id>")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("\nServer stopped.")


if __name__ == "__main__":
    main()
