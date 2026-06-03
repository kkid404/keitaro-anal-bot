"""Small Python web server for the standalone dashboard UI."""

from __future__ import annotations

import argparse
import json
import mimetypes
import re
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from keitaro_dashboard.client import KeitaroDashboardClient, resolve_keitaro_config
from keitaro_dashboard.imports import parse_spend_file
from keitaro_dashboard.store import (
    DashboardStore,
    DEFAULT_TIMEZONE,
    PROJECT_ROOT,
    SUPPORTED_PERIODS,
    build_sub5_report,
    refresh_keitaro_reports,
)


STATIC_DIR = PROJECT_ROOT / "static"
DEFAULT_KEITARO_REFRESH_SETTINGS = {
    "enabled": False,
    "interval_minutes": 60,
}
PROFILE_SETTING_KEY = "dashboard_profile"
DEFAULT_PROFILE_SETTINGS = {
    "timezone": DEFAULT_TIMEZONE,
    "keitaro_api_key": "",
}


def parse_list(params: dict[str, list[str]], name: str) -> list[str]:
    values = params.get(name, [])
    items: list[str] = []
    for value in values:
        items.extend(part.strip() for part in value.split(",") if part.strip())
    return items


def clean_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value not in (None, "", [])}


def parse_bool(value: Any, default: bool = False) -> bool:
    if value in (None, ""):
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def normalize_keitaro_refresh_settings(value: Any) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    try:
        interval = int(float(raw.get("interval_minutes", DEFAULT_KEITARO_REFRESH_SETTINGS["interval_minutes"])))
    except (TypeError, ValueError):
        interval = DEFAULT_KEITARO_REFRESH_SETTINGS["interval_minutes"]
    interval = min(24 * 60, max(5, interval))
    return {
        "enabled": parse_bool(raw.get("enabled"), DEFAULT_KEITARO_REFRESH_SETTINGS["enabled"]),
        "interval_minutes": interval,
    }


def normalize_profile_settings(value: Any, previous: dict[str, Any] | None = None) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    fallback = previous if isinstance(previous, dict) else {}
    timezone = str(raw.get("timezone") or fallback.get("timezone") or DEFAULT_TIMEZONE).strip() or DEFAULT_TIMEZONE

    token_value = raw.get("keitaro_api_key", raw.get("keitaro_token"))
    if token_value in (None, ""):
        api_key = str(fallback.get("keitaro_api_key") or "").strip()
    else:
        api_key = str(token_value).strip()
    if parse_bool(raw.get("clear_keitaro_token"), False):
        api_key = ""

    return {
        "timezone": timezone,
        "keitaro_api_key": api_key,
    }


def public_profile_settings(settings: dict[str, Any], config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or resolve_keitaro_config()
    normalized = normalize_profile_settings(settings)
    return {
        "timezone": normalized["timezone"],
        "keitaro_token_present": bool(normalized["keitaro_api_key"]),
        "env_keitaro_token_present": bool(config.get("api_key_present")),
        "keitaro_base_url_present": bool(config.get("base_url")),
    }


def default_upload_batch_id(uploads: list[dict[str, Any]]) -> str:
    stems = [Path(upload.get("filename") or "facebook-spend").stem for upload in uploads]
    clean_stems = [re.sub(r"[^A-Za-z0-9А-Яа-я_.-]+", "-", stem).strip("-_.") for stem in stems]
    clean_stems = [stem for stem in clean_stems if stem]
    if len(clean_stems) == 1:
        return clean_stems[0]
    batch = "-".join(clean_stems[:3]) or "facebook-spend"
    if len(clean_stems) > 3:
        batch = f"{batch}-plus-{len(clean_stems) - 3}"
    return f"{batch[:96].strip('-_.')}-multi"


def multipart_param(header: str, name: str) -> str:
    match = re.search(rf'{name}="([^"]*)"', header)
    if match:
        return match.group(1)
    match = re.search(rf"{name}=([^;]+)", header)
    return match.group(1).strip() if match else ""


class DashboardRequestHandler(BaseHTTPRequestHandler):
    server_version = "KeitaroDashboard/0.1"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_get(parsed.path, parse_qs(parsed.query))
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown route")
            return
        try:
            if parsed.path == "/api/upload-spend":
                self.handle_spend_upload()
                return
            payload = self.read_json()
            self.handle_api_post(parsed.path, payload)
        except Exception as exc:  # noqa: BLE001 - API should return JSON errors.
            traceback.print_exc()
            self.write_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)

    def handle_api_get(self, path: str, params: dict[str, list[str]]) -> None:
        try:
            if path == "/api/health":
                self.write_json({"ok": True, "upload_spend": True})
                return

            if path == "/api/config":
                config = resolve_keitaro_config()
                profile = self.profile_settings(include_secret=True)
                api_key_present = config["api_key_present"] or bool(profile["keitaro_api_key"])
                self.write_json({
                    "db_path": str(self.store.path),
                    "keitaro": {
                        "configured": bool(config["base_url"] and api_key_present),
                        "api_key_present": api_key_present,
                        "profile_api_key_present": bool(profile["keitaro_api_key"]),
                    },
                    "periods": SUPPORTED_PERIODS,
                })
                return

            if path == "/api/settings":
                self.write_json({"settings": self.store.get_setting("dashboard_visibility", {})})
                return

            if path == "/api/profile-settings":
                config = resolve_keitaro_config()
                settings = self.profile_settings(include_secret=True)
                self.write_json({"settings": public_profile_settings(settings, config)})
                return

            if path == "/api/keitaro-refresh-settings":
                settings = normalize_keitaro_refresh_settings(
                    self.store.get_setting("keitaro_refresh", DEFAULT_KEITARO_REFRESH_SETTINGS)
                )
                self.write_json({"settings": settings})
                return

            if path == "/api/summary":
                payload = self.query_payload(params)
                self.write_json(self.store.summary(payload))
                return

            if path == "/api/query":
                payload = self.query_payload(params)
                self.write_json(self.store.query(payload))
                return

            if path == "/api/roi-table":
                payload = self.query_payload(params)
                payload["q"] = params.get("q", [""])[0]
                payload["sort_by"] = params.get("sort_by", params.get("order_by", ["profit"]))[0]
                payload["sort_order"] = params.get("sort_order", params.get("order", ["DESC"]))[0]
                payload["limit"] = int(params.get("limit", ["500"])[0])
                self.write_json(self.store.roi_table(payload))
                return

            if path == "/api/sub5-report":
                payload = self.sub5_payload(params)
                if parse_bool(params.get("live", [None])[0], False) or int(payload.get("start_hour") or 0) != 0:
                    payload.setdefault("timezone", self.profile_timezone())
                    client = self.keitaro_client()
                    self.write_json(build_sub5_report(client, payload))
                    return
                self.write_json(self.store.sub5_report(payload))
                return

            if path == "/api/todos":
                payload = {
                    "status": params.get("status", [None])[0],
                    "period_key": params.get("period_key", [None])[0],
                    "date_from": params.get("date_from", [None])[0],
                    "date_to": params.get("date_to", [None])[0],
                    "priority": params.get("priority", [None])[0],
                    "category": params.get("category", [None])[0],
                    "source": params.get("source", [None])[0],
                    "test_id": params.get("test_id", params.get("testId", [None]))[0],
                    "test_key": params.get("test_key", params.get("testKey", [None]))[0],
                    "q": params.get("q", [None])[0],
                    "include_done": parse_bool(params.get("include_done", [None])[0], True),
                    "include_archived": parse_bool(params.get("include_archived", [None])[0], False),
                    "limit": int(params.get("limit", ["100"])[0]),
                }
                self.write_json(self.store.list_todos(clean_payload(payload)))
                return

            if path == "/api/codex/context":
                payload = self.query_payload(params)
                payload["todo_limit"] = int(params.get("todo_limit", params.get("limit", ["30"]))[0])
                self.write_json(self.store.codex_context(payload))
                return

            if path == "/api/geo/overview":
                payload = self.query_payload(params)
                payload["limit"] = int(params.get("limit", ["80"])[0])
                self.write_json(self.store.geo_overview(payload))
                return

            if path == "/api/geo/manual":
                payload = {
                    "status": params.get("status", [None])[0],
                    "q": params.get("q", [None])[0],
                    "include_done": parse_bool(params.get("include_done", [None])[0], True),
                    "limit": int(params.get("limit", ["500"])[0]),
                }
                self.write_json(self.store.list_geo_manual(clean_payload(payload)))
                return

            if path == "/api/geo/tests":
                payload = {
                    "geo": params.get("geo", [None])[0],
                    "status": params.get("status", [None])[0],
                    "include_finished": parse_bool(params.get("include_finished", [None])[0], True),
                    "include_todos": parse_bool(params.get("include_todos", [None])[0], True),
                    "limit": int(params.get("limit", ["200"])[0]),
                }
                self.write_json(self.store.list_geo_tests(clean_payload(payload)))
                return

            self.write_json({"error": f"Unknown API route: {path}"}, status=HTTPStatus.NOT_FOUND)
        except Exception as exc:  # noqa: BLE001 - API should return JSON errors.
            traceback.print_exc()
            self.write_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)

    def handle_api_post(self, path: str, payload: dict[str, Any]) -> None:
        payload = clean_payload(payload)

        if path == "/api/refresh":
            instance = str(payload.get("instance") or "default")
            payload.setdefault("timezone", self.profile_timezone())
            client = self.keitaro_client()
            self.write_json(refresh_keitaro_reports(client, instance, payload))
            return

        if path == "/api/ingest-spend":
            rows = payload.get("rows")
            if not isinstance(rows, list):
                raise ValueError("rows must be a JSON array")
            self.write_json(self.store.ingest_spend_rows(
                rows,
                batch_id=payload.get("batch_id"),
                replace_batch=parse_bool(payload.get("replace_batch"), False),
                replace_dates=parse_bool(payload.get("replace_dates"), False),
            ))
            return

        if path == "/api/offer-map":
            rows = payload.get("rows")
            if not isinstance(rows, list):
                raise ValueError("rows must be a JSON array")
            self.write_json(self.store.upsert_offer_map(rows))
            return

        if path == "/api/roi/manual":
            self.write_json(self.store.upsert_roi_manual(payload))
            return

        if path == "/api/roi/manual/delete":
            self.write_json(self.store.delete_roi_manual(payload))
            return

        if path == "/api/roi/settings":
            self.write_json(self.store.save_roi_settings(payload))
            return

        if path == "/api/roi/sub5-map":
            self.write_json(self.store.upsert_roi_sub5_map(payload))
            return

        if path == "/api/settings":
            settings = payload.get("settings")
            if not isinstance(settings, dict):
                raise ValueError("settings must be a JSON object")
            self.write_json({"settings": self.store.set_setting("dashboard_visibility", settings)})
            return

        if path == "/api/profile-settings":
            incoming = payload.get("settings") if isinstance(payload.get("settings"), dict) else payload
            current = self.profile_settings(include_secret=True)
            settings = normalize_profile_settings(incoming, current)
            saved = self.store.set_setting(PROFILE_SETTING_KEY, settings)
            config = resolve_keitaro_config()
            self.write_json({"settings": public_profile_settings(saved, config)})
            return

        if path == "/api/keitaro-refresh-settings":
            settings = normalize_keitaro_refresh_settings(payload.get("settings") or payload)
            self.write_json({"settings": self.store.set_setting("keitaro_refresh", settings)})
            return

        if path == "/api/todos":
            self.write_json(self.store.create_todo(payload))
            return

        if path == "/api/todos/update":
            self.write_json(self.store.update_todo(payload))
            return

        if path == "/api/todos/delete":
            self.write_json(self.store.delete_todo(payload))
            return

        if path == "/api/geo/manual":
            self.write_json(self.store.upsert_geo_manual(payload))
            return

        if path == "/api/geo/manual/delete":
            self.write_json(self.store.delete_geo_manual(payload))
            return

        if path == "/api/geo/tests":
            self.write_json(self.store.upsert_geo_test(payload))
            return

        if path == "/api/geo/tests/delete":
            self.write_json(self.store.delete_geo_test(payload))
            return

        self.write_json({"error": f"Unknown API route: {path}"}, status=HTTPStatus.NOT_FOUND)

    def handle_spend_upload(self) -> None:
        fields, files = self.read_multipart()
        uploads = files.get("file", []) + files.get("files", [])
        if not uploads:
            raise ValueError("Выбери один или несколько файлов в поле file")

        batch_id = fields.get("batch_id") or default_upload_batch_id(uploads)
        replace_batch = fields.get("replace_batch", "true").lower() in {"1", "true", "yes", "on"}
        replace_dates = fields.get("replace_dates", str(replace_batch)).lower() in {"1", "true", "yes", "on"}
        parsed_files = []
        rows = []
        warnings = []

        for upload in uploads:
            filename = upload["filename"]
            try:
                parsed = parse_spend_file(filename, upload["content"])
                rows.extend(parsed["rows"])
                parsed_files.append({
                    "filename": parsed["filename"],
                    "source_rows": parsed["source_rows"],
                    "importable_rows": parsed["importable_rows"],
                    "headers": parsed["headers"],
                    "warnings": parsed["warnings"],
                    "preview": parsed["preview"],
                })
                warnings.extend(f"{filename}: {warning}" for warning in parsed["warnings"])
            except Exception as exc:  # noqa: BLE001 - keep valid files importable.
                message = str(exc)
                parsed_files.append({
                    "filename": filename,
                    "source_rows": 0,
                    "importable_rows": 0,
                    "headers": [],
                    "warnings": [message],
                    "preview": [],
                    "error": message,
                })
                warnings.append(f"{filename}: {message}")

        result = (
            self.store.ingest_spend_rows(
                rows,
                batch_id=batch_id,
                replace_batch=replace_batch,
                replace_dates=replace_dates,
            )
            if rows
            else {"db_path": str(self.store.path), "inserted": 0, "batch_id": batch_id}
        )
        response = {
            **result,
            "replace_dates": replace_dates,
            "file_count": len(uploads),
            "imported_file_count": sum(1 for item in parsed_files if item["importable_rows"]),
            "filenames": [item["filename"] for item in parsed_files],
            "files": parsed_files,
            "source_rows": sum(item["source_rows"] for item in parsed_files),
            "importable_rows": len(rows),
            "warnings": warnings,
            "preview": rows[:8],
        }
        if len(parsed_files) == 1:
            response.update({
                "filename": parsed_files[0]["filename"],
                "headers": parsed_files[0]["headers"],
            })
        self.write_json(response)

    def query_payload(self, params: dict[str, list[str]]) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "source": params.get("source", ["spend"])[0],
            "period_key": params.get("period_key", [None])[0],
            "date_from": params.get("date_from", [None])[0],
            "date_to": params.get("date_to", [None])[0],
            "as_of_date": params.get("as_of_date", [None])[0],
            "report_name": params.get("report_name", [None])[0],
            "order_by": params.get("order_by", ["profit"])[0],
            "order": params.get("order", ["DESC"])[0],
            "limit": int(params.get("limit", ["50"])[0]),
            "target_daily_profit": float(params.get("target_daily_profit", ["1000"])[0]),
            "target_roi": float(params.get("target_roi", ["0.6"])[0]),
        }
        group_by = parse_list(params, "group_by")
        metrics = parse_list(params, "metric") or parse_list(params, "metrics")
        if group_by:
            payload["group_by"] = group_by
        if metrics:
            payload["metrics"] = metrics
        return clean_payload(payload)

    def sub5_payload(self, params: dict[str, list[str]]) -> dict[str, Any]:
        return clean_payload({
            "date": params.get("date", [None])[0],
            "period_key": params.get("period_key", [None])[0],
            "group_by": params.get("group_by", ["sub5"])[0],
            "start_hour": int(params.get("start_hour", ["0"])[0]),
            "limit": int(params.get("limit", ["100"])[0]),
            "sub5": params.get("sub5", [None])[0],
            "order_by": params.get("order_by", ["deps"])[0],
            "order": params.get("order", ["desc"])[0],
            "timezone": params.get("timezone", [None])[0],
            "registration_days": int(params.get("registration_days", ["30"])[0]),
        })

    @property
    def store(self) -> DashboardStore:
        return self.server.store  # type: ignore[attr-defined]

    def profile_settings(self, *, include_secret: bool = False) -> dict[str, Any]:
        settings = normalize_profile_settings(
            self.store.get_setting(PROFILE_SETTING_KEY, DEFAULT_PROFILE_SETTINGS)
        )
        if include_secret:
            return settings
        return public_profile_settings(settings)

    def profile_timezone(self) -> str:
        return self.profile_settings(include_secret=True)["timezone"]

    def keitaro_client(self) -> KeitaroDashboardClient:
        config = resolve_keitaro_config()
        profile = self.profile_settings(include_secret=True)
        base_url = config["base_url"]
        api_key = profile["keitaro_api_key"] or config["api_key"]
        if not base_url or not api_key:
            raise ValueError("Set KEITARO_URL and KEITARO_API_KEY, or save a Keitaro token in profile.")
        return KeitaroDashboardClient(base_url=base_url, api_key=api_key)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("JSON body must be an object")
        return data

    def read_multipart(self) -> tuple[dict[str, str], dict[str, list[dict[str, Any]]]]:
        content_type = self.headers.get("Content-Type", "")
        boundary_match = re.search(r"boundary=(.+)", content_type)
        if "multipart/form-data" not in content_type or not boundary_match:
            raise ValueError("Ожидался multipart/form-data")

        boundary = boundary_match.group(1).strip().strip('"').encode("utf-8")
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise ValueError("Пустой upload")
        body = self.rfile.read(length)

        fields: dict[str, str] = {}
        files: dict[str, list[dict[str, Any]]] = {}
        delimiter = b"--" + boundary
        for part in body.split(delimiter):
            part = part.strip()
            if not part or part == b"--":
                continue
            if part.endswith(b"--"):
                part = part[:-2].strip()
            if b"\r\n\r\n" not in part:
                continue
            raw_headers, content = part.split(b"\r\n\r\n", 1)
            content = content.rstrip(b"\r\n")
            headers = raw_headers.decode("utf-8", errors="replace")
            disposition = next(
                (line for line in headers.split("\r\n") if line.lower().startswith("content-disposition:")),
                "",
            )
            name = multipart_param(disposition, "name")
            filename = multipart_param(disposition, "filename")
            if not name:
                continue
            if filename:
                files.setdefault(name, []).append({"filename": filename, "content": content})
            else:
                fields[name] = content.decode("utf-8", errors="replace")
        return fields, files

    def write_json(self, data: Any, *, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_static(self, path: str) -> None:
        relative = "index.html" if path in ("", "/") else path.lstrip("/")
        target = (STATIC_DIR / relative).resolve()
        if not str(target).startswith(str(STATIC_DIR.resolve())) or not target.exists() or target.is_dir():
            target = STATIC_DIR / "index.html"
        body = target.read_bytes()
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}")


class DashboardHTTPServer(ThreadingHTTPServer):
    def __init__(self, server_address: tuple[str, int], handler_class: type[BaseHTTPRequestHandler], store: DashboardStore):
        super().__init__(server_address, handler_class)
        self.store = store


def serve(host: str = "127.0.0.1", port: int = 8765, db_path: str | None = None) -> None:
    store = DashboardStore(db_path)
    server = DashboardHTTPServer((host, port), DashboardRequestHandler, store)
    print(f"Keitaro dashboard: http://{host}:{port}")
    print(f"SQLite database: {store.path}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping dashboard server")
    finally:
        server.server_close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the Keitaro dashboard web server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--db-path")
    args = parser.parse_args(argv)
    serve(host=args.host, port=args.port, db_path=args.db_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
