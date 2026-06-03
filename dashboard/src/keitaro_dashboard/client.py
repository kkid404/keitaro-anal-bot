"""Minimal Keitaro Admin API client for the standalone dashboard project."""

from __future__ import annotations

import json
import os
import subprocess
import urllib.parse
from pathlib import Path
from typing import Any


class KeitaroDashboardError(RuntimeError):
    """Raised when Keitaro returns an error response."""


class KeitaroDashboardClient:
    """Small curl-based client for dashboard report refreshes."""

    def __init__(self, base_url: str, api_key: str, timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    @classmethod
    def from_env(cls) -> "KeitaroDashboardClient":
        config = resolve_keitaro_config()
        base_url = config["base_url"]
        api_key = config["api_key"]
        if not base_url or not api_key:
            raise ValueError("Set KEITARO_URL and KEITARO_API_KEY before refreshing dashboard reports.")
        return cls(base_url=base_url, api_key=api_key)

    def _request(
        self,
        method: str,
        path: str,
        data: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any] | list[Any]:
        url = f"{self.base_url}/admin_api/v1{path}"
        if params:
            filtered = {key: value for key, value in params.items() if value is not None}
            if filtered:
                url = f"{url}?{urllib.parse.urlencode(filtered)}"

        cmd = [
            "curl",
            "-s",
            "-S",
            "--fail-with-body",
            "-X",
            method,
            "-H",
            f"Api-Key: {self.api_key}",
            "-H",
            "Content-Type: application/json",
            "-H",
            "Accept: application/json",
            "--max-time",
            str(self.timeout),
            "-w",
            "\n%{http_code}",
        ]
        if data is not None:
            cmd += ["-d", json.dumps(data, ensure_ascii=False)]
        cmd.append(url)

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=self.timeout + 5)
        except subprocess.TimeoutExpired as exc:
            raise KeitaroDashboardError(f"Request timed out: {url}") from exc

        output = result.stdout.rstrip()
        lines = output.rsplit("\n", 1)
        body = lines[0] if len(lines) > 1 else ""
        status = int(lines[-1]) if lines and lines[-1].isdigit() else 0

        if status >= 400 or result.returncode != 0:
            raise KeitaroDashboardError(f"Keitaro API error HTTP {status}: {body or result.stderr}")

        return json.loads(body) if body else {}

    def build_report(self, data: dict[str, Any]) -> dict[str, Any] | list[Any]:
        return self._request("POST", "/report/build", data=data)

    def get_conversions(self, data: dict[str, Any]) -> dict[str, Any] | list[Any]:
        return self._request("POST", "/conversions/log", data=data)

    def get_campaigns(self) -> dict[str, Any] | list[Any]:
        return self._request("GET", "/campaigns", params={"limit": 10000, "offset": 0})

    def list_streams(self, campaign_id: int) -> dict[str, Any] | list[Any]:
        return self._request("GET", f"/campaigns/{campaign_id}/streams")

    def list_offers(self) -> dict[str, Any] | list[Any]:
        return self._request("GET", "/offers", params={"limit": 10000, "offset": 0})

    def update_click_costs(self, data: dict[str, Any]) -> dict[str, Any] | list[Any]:
        return self._request("POST", "/clicks/update_costs", data=data)


def read_dotenv() -> dict[str, str]:
    """Read simple KEY=VALUE pairs from nearby .env files."""
    values: dict[str, str] = {}
    project_root = Path(__file__).resolve().parents[2]
    for path in (Path.cwd() / ".env", Path.cwd().parent / ".env", project_root / ".env", project_root.parent / ".env"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            trimmed = line.strip()
            if not trimmed or trimmed.startswith("#") or "=" not in trimmed:
                continue
            key, value = trimmed.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
    return values


def resolve_keitaro_config() -> dict[str, Any]:
    """Resolve Keitaro credentials from env or the shared project .env."""
    dotenv = read_dotenv()
    base_url = (
        os.environ.get("KEITARO_URL", "")
        or os.environ.get("KEITARO_BASE_URL", "")
        or dotenv.get("KEITARO_URL", "")
        or dotenv.get("KEITARO_BASE_URL", "")
    )
    api_key = os.environ.get("KEITARO_API_KEY", "") or dotenv.get("KEITARO_API_KEY", "")
    return {
        "configured": bool(base_url and api_key),
        "base_url": base_url,
        "api_key": api_key,
        "api_key_present": bool(api_key),
    }
