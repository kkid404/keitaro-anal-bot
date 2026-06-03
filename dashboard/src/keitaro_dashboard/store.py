"""Local storage and analytics for the Keitaro kill/scale dashboard.

The dashboard needs repeatable period slices, so this module stores report rows
as SQLite facts instead of only returning one-off API responses.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import sqlite3
import uuid
from pathlib import Path
from typing import Any, Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "keitaro-dashboard.sqlite3"
DEFAULT_TIMEZONE = "Asia/Tbilisi"
FULL_PERIOD_START = "2026-03-20"
FULL_PERIOD_END: str | None = None

SUPPORTED_PERIODS = [
    "today",
    "yesterday",
    "last_3_days",
    "last_7_days",
    "last_14_days",
    "month_to_date",
    "full_period",
]
DEFAULT_PERIODS = ["today", "yesterday", "last_7_days", "last_14_days", "month_to_date"]
STANDARD_MEASURES = [
    "clicks",
    "conversions",
    "revenue",
    "cost",
    "profit",
    "roi",
    "cr",
    "cpc",
    "cpa",
    "epc",
    "bot_share",
]
TRACKING_QUALITY_MEASURES = STANDARD_MEASURES + ["campaign_unique_clicks"]
REPORT_DEFINITIONS = {
    "daily": ["day"],
    "offer": ["offer"],
    "campaign": ["campaign"],
    "creative": ["offer", "sub_id_6"],
    "placement": ["offer", "sub_id_6", "sub_id_8"],
    "tracking_quality": ["offer", "campaign", "sub_id_4", "sub_id_5", "sub_id_6"],
}
EXACT_DEPOSITS_REPORT = "deposits"
DEFAULT_REPORTS = list(REPORT_DEFINITIONS.keys()) + [EXACT_DEPOSITS_REPORT]
DEPOSIT_REGISTRATION_DAYS = 30
DEPOSIT_PAGE_SIZE = 5000
CONVERSION_LOG_PAGE_SIZE = 5000
SUB5_CONVERSION_COLUMNS = [
    "conversion_id",
    "postback_datetime",
    "sale_datetime",
    "status",
    "original_status",
    "previous_status",
    "sub_id",
    "campaign",
    "offer",
    "revenue",
    "sub_id_1",
    "sub_id_2",
    "sub_id_3",
    "sub_id_4",
    "sub_id_5",
    "sub_id_6",
]
IGNORED_OFFER_MARKERS = ("pwa pro",)
TODO_ENTITY_TYPE = "todo"
TODO_STATUSES = {"open", "in_progress", "done", "archived"}
TODO_PRIORITIES = {"low", "normal", "high", "urgent"}
TODO_GEO_TAG_IGNORES = {"GEO", "GEOS", "COUNTRY", "COUNTRIES", "DASHBOARD", "ГЕО"}
GEO_MANUAL_STATUSES = {"planned", "in_work", "testing", "scaling", "paused", "done"}
GEO_ACTIVE_STATUSES = {"in_work", "testing", "scaling"}
GEO_TEST_STATUSES = {"planned", "running", "finished", "paused", "failed"}
DEFAULT_TARGET_ROI = 0.6
TARGET_CPA_EVENT_RATIOS = {
    "click": 0.02,
    "install": 0.10,
    "reg": 0.20,
    "dep": 0.80,
}

SUM_METRICS = {
    "clicks",
    "conversions",
    "deposits",
    "revenue",
    "cost",
    "profit",
    "acc_spend",
    "pwa_spend",
    "total_spend",
    "campaign_unique_clicks",
}
DERIVED_METRICS = {"roi", "cpa", "rpd", "epc", "cr", "bot_share", "cpc"}
DIMENSION_COLUMNS = {
    "date",
    "row_date",
    "offer",
    "normalized_offer",
    "campaign",
    "creative",
    "placement",
    "sub_id_4",
    "sub_id_5",
    "sub_id_6",
    "sub_id_8",
    "country",
    "geo",
    "network",
    "brand",
    "offer_raw",
    "payout",
    "report_name",
    "period_key",
    "spend_source",
    "spend_level",
    "spend_campaign",
    "spend_split_source",
    "spend_split_campaign",
    "spend_split_share",
}


def default_db_path() -> Path:
    """Return the SQLite path used for dashboard data."""
    return Path(os.environ.get("KEITARO_DASHBOARD_DB", str(DEFAULT_DB_PATH))).expanduser()


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def parse_date(value: str) -> dt.date:
    return dt.date.fromisoformat(value)


def date_str(value: dt.date) -> str:
    return value.isoformat()


def to_float(value: Any) -> float:
    """Best-effort numeric coercion for API/spreadsheet values."""
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return 0.0
    text = text.replace("%", "").replace("$", "").replace(" ", "")
    if "," in text and "." in text:
        text = text.replace(",", "")
    else:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return 0.0


def safe_div(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0


def percent_points(value: float) -> float:
    """Normalize fractions such as 0.12 to 12 percentage points."""
    if -1.0 <= value <= 1.0:
        return value * 100
    return value


def first_value(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


def normalize_text(value: Any) -> str:
    return str(value).strip() if value not in (None, "") else ""


def parse_tags(value: Any) -> list[str]:
    if value in (None, ""):
        return []
    if isinstance(value, list):
        raw_items = value
    else:
        raw_items = str(value).replace(";", ",").split(",")
    tags = []
    for item in raw_items:
        tag = normalize_text(item).strip("#")
        if tag and tag not in tags:
            tags.append(tag)
    return tags


def parse_text_list(value: Any) -> list[str]:
    if value in (None, ""):
        return []
    if isinstance(value, list):
        raw_items = value
    else:
        raw_items = re.split(r"[\n\r,;]+", str(value))
    items = []
    for item in raw_items:
        text = normalize_text(item)
        if text and text not in items:
            items.append(text)
    return items


def parse_boolish(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return normalize_text(value).lower() in {"1", "true", "yes", "on", "done", "checked"}


def parse_checklist(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    items = []
    for item in value:
        if isinstance(item, dict):
            text = normalize_text(item.get("text") or item.get("title") or item.get("name"))
            checked = parse_boolish(item.get("checked") if "checked" in item else item.get("done"))
        else:
            text = normalize_text(item)
            checked = False
        if text:
            items.append({"text": text, "checked": checked})
    return items


def roi_row_key(value: Any) -> str:
    text = normalize_text(value) or "empty"
    digest = hashlib.sha1(text.casefold().encode("utf-8")).hexdigest()[:16]
    return f"auto:{digest}"


def canonical_roi_offer(value: Any) -> str:
    text = normalize_text(value)
    if not text or looks_like_sub5(text):
        return ""
    parts = [part.strip() for part in text.split("|") if part.strip()]
    if len(parts) >= 3:
        return " | ".join(part.upper() for part in parts[:3])
    return text


def roi_row_has_activity(row: dict[str, Any]) -> bool:
    if row.get("is_manual") or normalize_text(row.get("notes")):
        return True
    return any(
        to_float(row.get(metric))
        for metric in ("deposits", "revenue", "acc_spend", "pwa_spend", "total_spend")
    )


def date_part(value: Any) -> str:
    if value in (None, ""):
        return ""
    text = str(value).strip()
    if not text:
        return ""
    return re_split_date(text)


def re_split_date(text: str) -> str:
    return text.replace("T", " ").split(" ")[0]


def is_macro_value(value: Any) -> bool:
    text = normalize_text(value)
    return bool(text and text.startswith("{") and text.endswith("}"))


def looks_like_sub5(value: Any) -> bool:
    text = normalize_text(value)
    if not text or is_macro_value(text) or "|" not in text:
        return False
    parts = [part.strip() for part in text.split("|")]
    return bool(
        len(parts) >= 6
        and parts[0].isdigit()
        and len(parts[1]) in {2, 3}
        and parts[1].isalpha()
        and parts[2]
    )


def effective_sub5(row: dict[str, Any]) -> str:
    primary = normalize_text(first_value(row, "sub_id_5", "sub5", "sub_id5"))
    if primary and not is_macro_value(primary):
        return primary
    campaign = normalize_text(first_value(row, "campaign", "campaign_name"))
    return campaign if looks_like_sub5(campaign) else ""


def parse_sub5(value: Any) -> dict[str, str]:
    parts = normalize_text(value).split("|")
    return {
        "sub5": normalize_text(value),
        "launch_date": parts[0] if len(parts) > 0 else "",
        "geo": parts[1] if len(parts) > 1 else "",
        "buyer": parts[2] if len(parts) > 2 else "",
        "account_id": parts[3] if len(parts) > 3 else "",
        "creative": parts[4] if len(parts) > 4 else "",
        "funnel": parts[5] if len(parts) > 5 else "",
        "campaign_type": parts[6] if len(parts) > 6 else "",
        "ad_number": parts[7] if len(parts) > 7 else "",
    }


def derive_geo_test_key(value: Any) -> str:
    parts = [part.strip() for part in normalize_text(value).split("|")]
    if len(parts) >= 9 and looks_like_sub5(value):
        common_parts = [
            parts[1],
            parts[2],
            parts[5],
            parts[6],
            parts[7],
            parts[8],
        ]
        return "|".join(part for part in common_parts if part)
    if len(parts) >= 7 and looks_like_sub5(value):
        common_parts = [parts[1], parts[2], parts[5], parts[6]]
        return "|".join(part for part in common_parts if part)
    return normalize_text(value)


def normalize_account_id(value: Any) -> str:
    text = normalize_text(value).replace("\u00a0", " ")
    for marker in ("\u200b", "\u200c", "\u200d", "\ufeff"):
        text = text.replace(marker, "")
    text = text.strip()
    if not text or is_macro_value(text):
        return ""
    candidate = text[4:] if text.lower().startswith("act_") else text
    compact = re.sub(r"[\s_-]+", "", candidate)
    return compact if compact.isdigit() else text


def sub5_account_id(row: dict[str, Any]) -> str:
    explicit = first_value(row, "account_id", "accountId", "ad_account_id", "account")
    parsed = parse_sub5(effective_sub5(row)).get("account_id")
    return normalize_account_id(explicit) or normalize_account_id(parsed)


def clean_geo_code(value: Any) -> str:
    text = normalize_text(value).upper()
    if len(text) == 2 and text.isalpha():
        return text
    return ""


GEO_TOKEN_PATTERN = re.compile(r"(?<![A-Z])([A-Z]{2})(?=\d|[_\-\s|/]|$)")


def derive_geo_from_text(value: Any) -> str:
    text = normalize_text(value).upper()
    if not text:
        return ""
    for match in GEO_TOKEN_PATTERN.finditer(text):
        geo = clean_geo_code(match.group(1))
        if geo:
            return geo
    return ""


def derive_geo(row: dict[str, Any]) -> str:
    source_candidates = [
        effective_sub5(row),
        first_value(row, "sub_id_5", "sub5", "sub_id5"),
        first_value(row, "normalized_offer", "offer", "offer_name"),
        first_value(row, "campaign", "campaign_name"),
    ]
    for value in source_candidates:
        if looks_like_sub5(value):
            geo = clean_geo_code(parse_sub5(value).get("geo"))
            if geo:
                return geo
    for value in source_candidates:
        text = normalize_text(value)
        if "|" not in text:
            continue
        for part in text.split("|")[:2]:
            geo = clean_geo_code(part)
            if geo:
                return geo
    for value in source_candidates:
        geo = derive_geo_from_text(value)
        if geo:
            return geo

    for key in ("geo", "country_code", "country"):
        geo = clean_geo_code(row.get(key))
        if geo:
            return geo
    return ""


def derive_creative(row: dict[str, Any]) -> str:
    explicit = normalize_text(first_value(row, "creative", "sub_id_6"))
    if explicit and not is_macro_value(explicit):
        return explicit
    sub5 = effective_sub5(row)
    if sub5:
        return parse_sub5(sub5).get("creative", "")
    return ""


def parse_datetime(value: Any) -> dt.datetime | None:
    text = normalize_text(value)
    if not text:
        return None
    source = text.replace("T", " ").replace("Z", "+00:00")
    if len(source) > 19 and source[19] == ".":
        source = source[:19]
    try:
        parsed = dt.datetime.fromisoformat(source)
    except ValueError:
        try:
            parsed = dt.datetime.strptime(source[:19], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None
    if parsed.tzinfo:
        parsed = parsed.replace(tzinfo=None)
    return parsed


def day_window(target_date: str, start_hour: int = 0) -> dict[str, Any]:
    hour = min(23, max(0, int(start_hour or 0)))
    start_date = parse_date(target_date)
    start = dt.datetime.combine(start_date, dt.time(hour=hour))
    end = start + dt.timedelta(days=1) - dt.timedelta(seconds=1)
    return {
        "date": target_date,
        "start_hour": hour,
        "start": start,
        "end": end,
        "start_datetime": start.strftime("%Y-%m-%d %H:%M:%S"),
        "end_datetime": end.strftime("%Y-%m-%d %H:%M:%S"),
        "query_to_date": date_str(end.date()),
    }


def is_in_day_window(value: Any, window: dict[str, Any]) -> bool:
    parsed = parse_datetime(value)
    return bool(parsed and window["start"] <= parsed <= window["end"])


def row_status(row: dict[str, Any]) -> str:
    return normalize_text(first_value(row, "status", "original_status")).lower()


def previous_status(row: dict[str, Any]) -> str:
    return normalize_text(first_value(row, "previous_status")).lower()


def is_lead_or_sale(row: dict[str, Any]) -> bool:
    return row_status(row) in {"lead", "sale"}


def is_sale(row: dict[str, Any]) -> bool:
    return row_status(row) == "sale"


def is_recovered_sale(row: dict[str, Any]) -> bool:
    return previous_status(row) == "sale" and not is_sale(row)


def has_positive_revenue(row: dict[str, Any]) -> bool:
    return to_float(row.get("revenue")) > 0


def is_normal_deposit_in_period(row: dict[str, Any], date_from: str, date_to: str) -> bool:
    return is_date_between(row.get("sale_datetime"), date_from, date_to) and has_positive_revenue(row)


def is_overwritten_deposit_in_period(row: dict[str, Any], date_from: str, date_to: str) -> bool:
    return (
        previous_status(row) == "sale"
        and not normalize_text(row.get("sale_datetime"))
        and is_date_between(row.get("postback_datetime"), date_from, date_to)
        and has_positive_revenue(row)
    )


def is_normal_deposit_in_window(row: dict[str, Any], window: dict[str, Any]) -> bool:
    return is_in_day_window(row.get("sale_datetime"), window) and has_positive_revenue(row)


def is_overwritten_deposit_in_window(row: dict[str, Any], window: dict[str, Any]) -> bool:
    return (
        previous_status(row) == "sale"
        and not normalize_text(row.get("sale_datetime"))
        and is_in_day_window(row.get("postback_datetime"), window)
        and has_positive_revenue(row)
    )


def conversion_key(row: dict[str, Any]) -> str:
    return normalize_text(first_value(row, "conversion_id", "sub_id")) or "|".join([
        effective_sub5(row),
        normalize_text(row.get("postback_datetime")),
        normalize_text(row.get("sale_datetime")),
    ])


def is_date_between(value: Any, date_from: str, date_to: str) -> bool:
    part = date_part(value)
    return bool(part and date_from <= part <= date_to)


def extract_rows(result: Any) -> list[dict[str, Any]]:
    """Extract rows from common Keitaro response shapes."""
    if isinstance(result, list):
        return [row for row in result if isinstance(row, dict)]
    if not isinstance(result, dict):
        return []
    for key in ("rows", "data", "items"):
        rows = result.get(key)
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    nested = result.get("result")
    if isinstance(nested, dict):
        return extract_rows(nested)
    return []


def period_bounds(
    period_key: str,
    *,
    as_of_date: str | None = None,
    full_period_start: str = FULL_PERIOD_START,
    full_period_end: str | None = FULL_PERIOD_END,
) -> tuple[str, str]:
    """Resolve a named dashboard period to inclusive date bounds."""
    today = parse_date(as_of_date) if as_of_date else dt.date.today()
    yesterday = today - dt.timedelta(days=1)

    match period_key:
        case "today":
            start = end = today
        case "yesterday":
            start = end = yesterday
        case "last_3_days":
            start, end = yesterday - dt.timedelta(days=2), yesterday
        case "last_7_days":
            start, end = yesterday - dt.timedelta(days=6), yesterday
        case "last_14_days":
            start, end = yesterday - dt.timedelta(days=13), yesterday
        case "month_to_date":
            start, end = today.replace(day=1), yesterday
        case "full_period":
            start = parse_date(full_period_start)
            end = parse_date(full_period_end) if full_period_end else yesterday
        case _:
            raise ValueError(f"Unknown dashboard period: {period_key}")

    return date_str(start), date_str(end)


def resolve_requested_periods(arguments: dict[str, Any]) -> list[dict[str, str]]:
    if arguments.get("date_from") and arguments.get("date_to"):
        return [{
            "period_key": arguments.get("period_key") or "custom",
            "date_from": arguments["date_from"],
            "date_to": arguments["date_to"],
        }]

    periods = arguments.get("periods") or DEFAULT_PERIODS
    resolved = []
    for period_key in periods:
        date_from, date_to = period_bounds(
            period_key,
            as_of_date=arguments.get("as_of_date"),
            full_period_start=arguments.get("full_period_start", FULL_PERIOD_START),
            full_period_end=arguments.get("full_period_end", FULL_PERIOD_END),
        )
        resolved.append({
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
        })
    return resolved


class DashboardStore:
    """SQLite-backed storage for dashboard facts."""

    def __init__(self, path: str | Path | None = None):
        self.path = Path(path).expanduser() if path else default_db_path()

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        self.init_schema(conn)
        return conn

    def init_schema(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS dashboard_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                instance TEXT,
                timezone TEXT NOT NULL,
                period_key TEXT NOT NULL,
                date_from TEXT NOT NULL,
                date_to TEXT NOT NULL,
                source TEXT NOT NULL,
                notes TEXT
            );

            CREATE TABLE IF NOT EXISTS keitaro_report_rows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id INTEGER NOT NULL REFERENCES dashboard_snapshots(id),
                inserted_at TEXT NOT NULL,
                instance TEXT,
                report_name TEXT NOT NULL,
                period_key TEXT NOT NULL,
                date_from TEXT NOT NULL,
                date_to TEXT NOT NULL,
                row_date TEXT,
                offer TEXT,
                normalized_offer TEXT,
                campaign TEXT,
                creative TEXT,
                placement TEXT,
                sub_id_4 TEXT,
                sub_id_5 TEXT,
                sub_id_6 TEXT,
                sub_id_8 TEXT,
                country TEXT,
                geo TEXT,
                clicks REAL DEFAULT 0,
                conversions REAL DEFAULT 0,
                deposits REAL DEFAULT 0,
                revenue REAL DEFAULT 0,
                cost REAL DEFAULT 0,
                profit REAL DEFAULT 0,
                roi REAL DEFAULT 0,
                cr REAL DEFAULT 0,
                cpc REAL DEFAULT 0,
                cpa REAL DEFAULT 0,
                epc REAL DEFAULT 0,
                bot_share REAL DEFAULT 0,
                raw_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS spend_rows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                imported_at TEXT NOT NULL,
                batch_id TEXT,
                date TEXT NOT NULL,
                offer_raw TEXT,
                normalized_offer TEXT,
                geo TEXT,
                network TEXT,
                brand TEXT,
                payout REAL DEFAULT 0,
                deposits REAL DEFAULT 0,
                revenue REAL DEFAULT 0,
                acc_spend REAL DEFAULT 0,
                pwa_spend REAL DEFAULT 0,
                total_spend REAL DEFAULT 0,
                profit REAL DEFAULT 0,
                roi REAL DEFAULT 0,
                cpa REAL DEFAULT 0,
                rpd REAL DEFAULT 0,
                raw_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS offer_map (
                normalized_offer TEXT NOT NULL,
                spend_offer_raw TEXT NOT NULL DEFAULT '',
                keitaro_offer_pattern TEXT NOT NULL DEFAULT '',
                geo TEXT,
                network TEXT,
                brand TEXT,
                payout REAL DEFAULT 0,
                status TEXT,
                notes TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (normalized_offer, spend_offer_raw, keitaro_offer_pattern)
            );

            CREATE TABLE IF NOT EXISTS dashboard_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                period_key TEXT NOT NULL,
                date_from TEXT NOT NULL,
                date_to TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_name TEXT NOT NULL,
                metrics_json TEXT NOT NULL,
                decision TEXT NOT NULL,
                budget_action TEXT,
                reason TEXT,
                owner TEXT,
                deadline TEXT,
                status TEXT NOT NULL DEFAULT 'open'
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS roi_manual_rows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                row_key TEXT NOT NULL,
                period_key TEXT NOT NULL,
                date_from TEXT NOT NULL,
                date_to TEXT NOT NULL,
                is_manual INTEGER NOT NULL DEFAULT 0,
                offer TEXT NOT NULL,
                deposits REAL,
                revenue REAL,
                acc_spend REAL,
                pwa_spend REAL,
                notes TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(row_key, period_key, date_from, date_to)
            );

            CREATE TABLE IF NOT EXISTS roi_sub5_offer_map (
                sub5 TEXT PRIMARY KEY,
                offer TEXT NOT NULL,
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS campaign_offer_splits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instance TEXT NOT NULL,
                campaign_id INTEGER NOT NULL,
                campaign TEXT NOT NULL,
                campaign_alias TEXT,
                stream_id INTEGER NOT NULL DEFAULT 0,
                stream TEXT,
                offer_id INTEGER NOT NULL DEFAULT 0,
                offer TEXT NOT NULL,
                normalized_offer TEXT NOT NULL,
                share REAL NOT NULL DEFAULT 0,
                state TEXT,
                raw_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(instance, campaign_id, stream_id, offer_id, normalized_offer)
            );

            CREATE TABLE IF NOT EXISTS geo_manual (
                geo TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'planned',
                priority TEXT NOT NULL DEFAULT 'normal',
                owner TEXT,
                action TEXT,
                daily_budget REAL DEFAULT 0,
                cap REAL DEFAULT 0,
                target_roi REAL DEFAULT 0,
                payout REAL DEFAULT 0,
                notes TEXT,
                tags_json TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS geo_tests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                geo TEXT NOT NULL,
                title TEXT NOT NULL,
                test_key TEXT,
                status TEXT NOT NULL DEFAULT 'planned',
                start_date TEXT,
                end_date TEXT,
                sub5 TEXT,
                sub5_values_json TEXT NOT NULL DEFAULT '[]',
                targeting TEXT,
                hypothesis TEXT,
                planned_budget REAL DEFAULT 0,
                creatives_json TEXT NOT NULL DEFAULT '[]',
                result TEXT,
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_keitaro_period
                ON keitaro_report_rows(instance, report_name, period_key, date_from, date_to);
            CREATE INDEX IF NOT EXISTS idx_keitaro_row_date
                ON keitaro_report_rows(row_date);
            CREATE INDEX IF NOT EXISTS idx_keitaro_offer
                ON keitaro_report_rows(normalized_offer, offer);
            CREATE INDEX IF NOT EXISTS idx_spend_date
                ON spend_rows(date);
            CREATE INDEX IF NOT EXISTS idx_spend_offer
                ON spend_rows(normalized_offer, offer_raw);
            CREATE INDEX IF NOT EXISTS idx_roi_manual_period
                ON roi_manual_rows(period_key, date_from, date_to, enabled);
            CREATE INDEX IF NOT EXISTS idx_campaign_offer_splits_campaign
                ON campaign_offer_splits(instance, campaign, campaign_alias);
            CREATE INDEX IF NOT EXISTS idx_campaign_offer_splits_offer
                ON campaign_offer_splits(normalized_offer, offer);
            CREATE INDEX IF NOT EXISTS idx_geo_manual_status
                ON geo_manual(status);
            CREATE INDEX IF NOT EXISTS idx_geo_tests_geo_status
                ON geo_tests(geo, status);
            CREATE INDEX IF NOT EXISTS idx_geo_tests_dates
                ON geo_tests(start_date, end_date);
            """
        )
        self._ensure_geo_test_columns(conn)
        conn.commit()

    def _ensure_geo_test_columns(self, conn: sqlite3.Connection) -> None:
        cursor = conn.execute("PRAGMA table_info(geo_tests)")
        columns = {normalize_text(row["name"]) for row in cursor.fetchall()}
        if "test_key" not in columns:
            conn.execute("ALTER TABLE geo_tests ADD COLUMN test_key TEXT")
        if "sub5_values_json" not in columns:
            conn.execute("ALTER TABLE geo_tests ADD COLUMN sub5_values_json TEXT NOT NULL DEFAULT '[]'")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_geo_tests_test_key ON geo_tests(test_key)")

    def get_setting(self, key: str, default: Any = None) -> Any:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT value_json FROM app_settings WHERE key = ?", (key,)
            ).fetchone()
        if row is None:
            return default
        try:
            return json.loads(row["value_json"])
        except (TypeError, ValueError):
            return default

    def set_setting(self, key: str, value: Any) -> Any:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO app_settings (key, value_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value_json = excluded.value_json,
                    updated_at = excluded.updated_at
                """,
                (key, json.dumps(value, ensure_ascii=False), utc_now()),
            )
            conn.commit()
        return value

    def insert_snapshot(
        self,
        conn: sqlite3.Connection,
        *,
        instance: str,
        timezone: str,
        period_key: str,
        date_from: str,
        date_to: str,
        source: str,
        notes: str | None = None,
    ) -> int:
        cursor = conn.execute(
            """
            INSERT INTO dashboard_snapshots
                (created_at, instance, timezone, period_key, date_from, date_to, source, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (utc_now(), instance, timezone, period_key, date_from, date_to, source, notes),
        )
        return int(cursor.lastrowid)

    def upsert_report_rows(
        self,
        *,
        instance: str,
        timezone: str,
        period_key: str,
        date_from: str,
        date_to: str,
        report_name: str,
        rows: Iterable[dict[str, Any]],
    ) -> int:
        rows = list(rows)
        with self.connect() as conn:
            snapshot_id = self.insert_snapshot(
                conn,
                instance=instance,
                timezone=timezone,
                period_key=period_key,
                date_from=date_from,
                date_to=date_to,
                source=f"keitaro:{report_name}",
            )
            conn.execute(
                """
                DELETE FROM keitaro_report_rows
                WHERE instance = ?
                  AND report_name = ?
                  AND period_key = ?
                  AND date_from = ?
                  AND date_to = ?
                """,
                (instance, report_name, period_key, date_from, date_to),
            )
            offer_maps = self._load_offer_maps(conn)
            conn.executemany(
                """
                INSERT INTO keitaro_report_rows (
                    snapshot_id, inserted_at, instance, report_name, period_key,
                    date_from, date_to, row_date, offer, normalized_offer, campaign,
                    creative, placement, sub_id_4, sub_id_5, sub_id_6, sub_id_8,
                    country, geo, clicks, conversions, deposits, revenue, cost,
                    profit, roi, cr, cpc, cpa, epc, bot_share, raw_json
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
                """,
                [
                    self._report_record(
                        snapshot_id,
                        instance,
                        report_name,
                        period_key,
                        date_from,
                        date_to,
                        row,
                        offer_maps,
                    )
                    for row in rows
                ],
            )
            conn.commit()
        return len(rows)

    def _report_record(
        self,
        snapshot_id: int,
        instance: str,
        report_name: str,
        period_key: str,
        date_from: str,
        date_to: str,
        row: dict[str, Any],
        offer_maps: list[dict[str, Any]],
    ) -> tuple[Any, ...]:
        offer = normalize_text(first_value(row, "offer", "offer_name"))
        normalized_offer = self._mapped_offer(offer, offer_maps, source="keitaro") or offer
        sub_id_5 = normalize_text(first_value(row, "sub_id_5", "sub5", "sub_id5")) or effective_sub5(row)
        creative = derive_creative(row)
        sub_id_6 = normalize_text(first_value(row, "sub_id_6")) or creative
        sub_id_8 = normalize_text(first_value(row, "sub_id_8"))
        row_date = normalize_text(first_value(row, "row_date", "day", "date", "datetime", "sale_datetime", "postback_datetime"))[:10] or None
        revenue = to_float(first_value(row, "revenue"))
        cost = to_float(first_value(row, "cost"))
        conversions = to_float(first_value(row, "conversions", "sales", "leads"))
        country = normalize_text(first_value(row, "country", "country_code"))
        geo = derive_geo({**row, "normalized_offer": normalized_offer, "sub_id_5": sub_id_5}) or clean_geo_code(country)

        return (
            snapshot_id,
            utc_now(),
            instance,
            report_name,
            period_key,
            date_from,
            date_to,
            row_date,
            offer,
            normalized_offer,
            normalize_text(first_value(row, "campaign", "campaign_name")),
            creative,
            sub_id_8,
            normalize_text(first_value(row, "sub_id_4")),
            sub_id_5,
            sub_id_6,
            sub_id_8,
            country,
            geo,
            to_float(first_value(row, "clicks")),
            conversions,
            conversions,
            revenue,
            cost,
            revenue,
            0.0,
            to_float(first_value(row, "cr")),
            0.0,
            0.0,
            to_float(first_value(row, "epc")),
            to_float(first_value(row, "bot_share")),
            json.dumps(row, ensure_ascii=False, default=str),
        )

    def ingest_spend_rows(
        self,
        rows: Iterable[dict[str, Any]],
        *,
        batch_id: str | None = None,
        replace_batch: bool = False,
        replace_dates: bool = False,
    ) -> dict[str, Any]:
        rows = list(rows)
        deleted = 0
        with self.connect() as conn:
            offer_maps = self._load_offer_maps(conn)
            records = [self._spend_record(row, batch_id, offer_maps) for row in rows]
            if replace_batch and batch_id:
                deleted += conn.execute("DELETE FROM spend_rows WHERE batch_id = ?", (batch_id,)).rowcount
            if replace_dates and rows:
                dates = sorted({normalize_text(first_value(row, "date", "day"))[:10] for row in rows})
                dates = [date for date in dates if date]
                if dates:
                    deleted += self._delete_spend_rows_for_dates(conn, dates, rows)
            conn.executemany(
                """
                INSERT INTO spend_rows (
                    imported_at, batch_id, date, offer_raw, normalized_offer, geo,
                    network, brand, payout, deposits, revenue, acc_spend, pwa_spend,
                    total_spend, profit, roi, cpa, rpd, raw_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                records,
            )
            conn.commit()
        return {"db_path": str(self.path), "inserted": len(records), "deleted": deleted, "batch_id": batch_id}

    def _delete_spend_rows_for_dates(
        self,
        conn: sqlite3.Connection,
        dates: list[str],
        rows: list[dict[str, Any]],
    ) -> int:
        placeholders = ",".join("?" for _ in dates)
        sources = sorted({
            normalize_text(first_value(row, "source"))
            for row in rows
            if normalize_text(first_value(row, "source"))
        })
        if not sources:
            return conn.execute(
                f"DELETE FROM spend_rows WHERE date IN ({placeholders})",
                dates,
            ).rowcount

        clauses = []
        params: list[Any] = list(dates)
        for source in sources:
            clauses.append("(raw_json LIKE ? OR raw_json LIKE ?)")
            params.extend([f'%"source": "{source}"%', f'%"source":"{source}"%'])
        clauses.append("raw_json NOT LIKE ?")
        params.append('%"source"%')
        return conn.execute(
            f"""
            DELETE FROM spend_rows
            WHERE date IN ({placeholders})
              AND ({" OR ".join(clauses)})
            """,
            params,
        ).rowcount

    def _spend_record(
        self,
        row: dict[str, Any],
        batch_id: str | None,
        offer_maps: list[dict[str, Any]],
    ) -> tuple[Any, ...]:
        offer_raw = normalize_text(first_value(row, "offer_raw", "offer", "name"))
        normalized_offer = (
            normalize_text(first_value(row, "normalized_offer"))
            or self._mapped_offer(offer_raw, offer_maps, source="spend")
            or offer_raw
        )
        deposits = to_float(first_value(row, "deposits", "deps"))
        revenue = to_float(first_value(row, "revenue"))
        acc_spend = to_float(first_value(row, "acc_spend", "account_spend"))
        pwa_spend = to_float(first_value(row, "pwa_spend"))
        total_spend_raw = first_value(row, "total_spend", "spend")
        total_spend = to_float(total_spend_raw) if total_spend_raw not in (None, "") else acc_spend + pwa_spend
        profit_raw = first_value(row, "profit")
        profit = to_float(profit_raw) if profit_raw not in (None, "") else revenue - total_spend
        roi_raw = first_value(row, "roi")
        roi = to_float(roi_raw) if roi_raw not in (None, "") else safe_div(profit, total_spend)
        cpa_raw = first_value(row, "cpa")
        cpa = to_float(cpa_raw) if cpa_raw not in (None, "") else safe_div(total_spend, deposits)
        rpd_raw = first_value(row, "rpd")
        rpd = to_float(rpd_raw) if rpd_raw not in (None, "") else safe_div(revenue, deposits)
        geo = (
            derive_geo({**row, "normalized_offer": normalized_offer, "offer": offer_raw})
            or normalize_text(first_value(row, "geo", "country"))
        )

        return (
            utc_now(),
            batch_id,
            normalize_text(first_value(row, "date", "day"))[:10],
            offer_raw,
            normalized_offer,
            geo,
            normalize_text(first_value(row, "network", "affiliate_network")),
            normalize_text(first_value(row, "brand")),
            to_float(first_value(row, "payout")),
            deposits,
            revenue,
            acc_spend,
            pwa_spend,
            total_spend,
            profit,
            roi,
            cpa,
            rpd,
            json.dumps(row, ensure_ascii=False, default=str),
        )

    def _load_offer_maps(self, conn: sqlite3.Connection) -> list[dict[str, Any]]:
        cursor = conn.execute(
            """
            SELECT normalized_offer, spend_offer_raw, keitaro_offer_pattern
            FROM offer_map
            ORDER BY length(keitaro_offer_pattern) DESC, length(spend_offer_raw) DESC
            """
        )
        return [dict(row) for row in cursor.fetchall()]

    def _mapped_offer(
        self,
        value: str,
        offer_maps: list[dict[str, Any]],
        *,
        source: str,
    ) -> str:
        candidate = normalize_text(value).lower()
        if not candidate:
            return ""
        for row in offer_maps:
            if source == "keitaro":
                pattern = normalize_text(row.get("keitaro_offer_pattern")).lower()
            else:
                pattern = normalize_text(row.get("spend_offer_raw")).lower()
            if pattern and (pattern == candidate or pattern in candidate):
                return normalize_text(row.get("normalized_offer"))
        return ""

    def upsert_offer_map(self, rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
        rows = list(rows)
        records = []
        for row in rows:
            records.append((
                normalize_text(row.get("normalized_offer")),
                normalize_text(row.get("spend_offer_raw")),
                normalize_text(row.get("keitaro_offer_pattern")),
                normalize_text(row.get("geo")),
                normalize_text(row.get("network")),
                normalize_text(row.get("brand")),
                to_float(row.get("payout")),
                normalize_text(row.get("status")),
                normalize_text(row.get("notes")),
                utc_now(),
            ))
        with self.connect() as conn:
            conn.executemany(
                """
                INSERT INTO offer_map (
                    normalized_offer, spend_offer_raw, keitaro_offer_pattern, geo,
                    network, brand, payout, status, notes, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(normalized_offer, spend_offer_raw, keitaro_offer_pattern)
                DO UPDATE SET
                    geo = excluded.geo,
                    network = excluded.network,
                    brand = excluded.brand,
                    payout = excluded.payout,
                    status = excluded.status,
                    notes = excluded.notes,
                    updated_at = excluded.updated_at
                """,
                records,
            )
            conn.commit()
        return {"db_path": str(self.path), "upserted": len(records)}

    def list_todos(self, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        arguments = arguments or {}
        status = normalize_text(arguments.get("status")).lower()
        include_done = bool(arguments.get("include_done", True))
        include_archived = bool(arguments.get("include_archived", False))
        period_key = normalize_text(arguments.get("period_key"))
        date_from = normalize_text(arguments.get("date_from"))
        date_to = normalize_text(arguments.get("date_to"))
        priority = normalize_text(arguments.get("priority")).lower()
        category = normalize_text(arguments.get("category")).lower()
        source = normalize_text(arguments.get("source")).lower()
        test_id = int(to_float(arguments.get("test_id") or arguments.get("testId")))
        test_key = normalize_text(arguments.get("test_key") or arguments.get("testKey"))
        query_text = normalize_text(arguments.get("q") or arguments.get("query")).lower()
        limit = int(arguments.get("limit") or 100)

        where = ["entity_type = ?"]
        params: list[Any] = [TODO_ENTITY_TYPE]
        if status == "active":
            where.append("status IN (?, ?)")
            params.extend(["open", "in_progress"])
        elif status and status != "all":
            where.append("status = ?")
            params.append(status)
        elif not include_done:
            where.append("status NOT IN (?, ?)")
            params.extend(["done", "archived"])
        elif not include_archived:
            where.append("status != ?")
            params.append("archived")
        if date_from and date_to:
            where.append("date_from = ? AND date_to = ?")
            params.extend([date_from, date_to])
        elif period_key and period_key != "all":
            where.append("period_key = ?")
            params.append(period_key)

        with self.connect() as conn:
            cursor = conn.execute(
                f"""
                SELECT *
                FROM dashboard_actions
                WHERE {' AND '.join(where)}
                ORDER BY
                    CASE status
                        WHEN 'open' THEN 0
                        WHEN 'done' THEN 1
                        ELSE 2
                    END,
                    CASE WHEN deadline IS NULL OR deadline = '' THEN 1 ELSE 0 END,
                    deadline ASC,
                    created_at DESC,
                    id DESC
                """,
                params,
            )
            todos = [self._todo_from_row(row) for row in cursor.fetchall()]
        if priority and priority != "all":
            todos = [todo for todo in todos if todo["priority"] == priority]
        if category and category != "all":
            todos = [todo for todo in todos if todo["category"].lower() == category]
        if source and source != "all":
            todos = [todo for todo in todos if todo["source"].lower() == source]
        if test_id > 0:
            todos = [todo for todo in todos if int(todo.get("test_id") or 0) == test_id]
        if test_key:
            todos = [todo for todo in todos if normalize_text(todo.get("test_key")) == test_key]
        if query_text:
            todos = [todo for todo in todos if self._todo_matches_query(todo, query_text)]

        todos.sort(key=self._todo_sort_key)
        stats = self._todo_stats(todos)
        todos = todos[:limit]
        return {
            "db_path": str(self.path),
            "count": len(todos),
            "stats": stats,
            "todos": todos,
        }

    def create_todo(self, payload: dict[str, Any]) -> dict[str, Any]:
        title = normalize_text(payload.get("title") or payload.get("entity_name"))
        if not title:
            raise ValueError("Название задачи обязательно")

        period_key = normalize_text(payload.get("period_key") or payload.get("period") or "today")
        date_from = normalize_text(payload.get("date_from"))
        date_to = normalize_text(payload.get("date_to"))
        if not date_from or not date_to:
            date_from, date_to, period_key = self._resolve_query_dates({
                "period_key": period_key,
                "as_of_date": payload.get("as_of_date"),
            })

        status = normalize_text(payload.get("status") or "open").lower()
        if status not in TODO_STATUSES:
            status = "open"

        metrics = self._todo_metrics_from_payload(payload)
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO dashboard_actions (
                    created_at, period_key, date_from, date_to, entity_type,
                    entity_name, metrics_json, decision, budget_action,
                    reason, owner, deadline, status
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    utc_now(),
                    period_key,
                    date_from,
                    date_to,
                    TODO_ENTITY_TYPE,
                    title,
                    json.dumps(metrics, ensure_ascii=False),
                    "todo",
                    normalize_text(payload.get("source") or payload.get("budget_action") or "manual"),
                    normalize_text(payload.get("note") or payload.get("reason")),
                    normalize_text(payload.get("owner")),
                    normalize_text(payload.get("deadline")),
                    status,
                ),
            )
            todo_id = int(cursor.lastrowid)
            conn.commit()
            todo = self._get_todo(conn, todo_id)

        return {"db_path": str(self.path), "todo": todo}

    def update_todo(self, payload: dict[str, Any]) -> dict[str, Any]:
        todo_id = int(payload.get("id") or payload.get("todo_id") or 0)
        if todo_id <= 0:
            raise ValueError("id задачи обязателен")

        updates: list[str] = []
        params: list[Any] = []
        metrics_payload_keys = {
            "metrics", "priority", "category", "tags", "context", "link", "entity",
            "checklist", "test_id", "testId", "test_key", "testKey", "test_title",
            "testTitle",
        }
        should_update_metrics = any(key in payload for key in metrics_payload_keys)

        if "title" in payload or "entity_name" in payload:
            title = normalize_text(payload.get("title") or payload.get("entity_name"))
            if not title:
                raise ValueError("Название задачи обязательно")
            updates.append("entity_name = ?")
            params.append(title)

        if "note" in payload or "reason" in payload:
            updates.append("reason = ?")
            params.append(normalize_text(payload.get("note") or payload.get("reason")))

        for payload_key, column in (("owner", "owner"), ("deadline", "deadline")):
            if payload_key in payload:
                updates.append(f"{column} = ?")
                params.append(normalize_text(payload.get(payload_key)))

        if "source" in payload or "budget_action" in payload:
            updates.append("budget_action = ?")
            params.append(normalize_text(payload.get("source") or payload.get("budget_action")))

        if "status" in payload:
            status = normalize_text(payload.get("status")).lower()
            if status not in TODO_STATUSES:
                raise ValueError("status должен быть open, in_progress, done или archived")
            updates.append("status = ?")
            params.append(status)

        if "date_from" in payload or "date_to" in payload or "period_key" in payload:
            date_from, date_to, period_key = self._resolve_query_dates(payload)
            updates.extend(["period_key = ?", "date_from = ?", "date_to = ?"])
            params.extend([period_key, date_from, date_to])

        with self.connect() as conn:
            current = self._get_todo(conn, todo_id)
            if not current:
                raise ValueError(f"Задача {todo_id} не найдена")
            if should_update_metrics:
                metrics = self._todo_metrics_from_payload(payload, base=current.get("metrics") or {})
                updates.append("metrics_json = ?")
                params.append(json.dumps(metrics, ensure_ascii=False))
            if updates:
                params.append(todo_id)
                conn.execute(
                    f"""
                    UPDATE dashboard_actions
                    SET {', '.join(updates)}
                    WHERE id = ? AND entity_type = ?
                    """,
                    [*params, TODO_ENTITY_TYPE],
                )
                conn.commit()
            todo = self._get_todo(conn, todo_id)

        return {"db_path": str(self.path), "todo": todo}

    def delete_todo(self, payload: dict[str, Any]) -> dict[str, Any]:
        todo_id = int(payload.get("id") or payload.get("todo_id") or 0)
        if todo_id <= 0:
            raise ValueError("id задачи обязателен")
        with self.connect() as conn:
            cursor = conn.execute(
                "DELETE FROM dashboard_actions WHERE id = ? AND entity_type = ?",
                (todo_id, TODO_ENTITY_TYPE),
            )
            conn.commit()
        return {"db_path": str(self.path), "deleted": cursor.rowcount, "id": todo_id}

    def list_geo_manual(self, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        arguments = arguments or {}
        status = normalize_text(arguments.get("status")).lower()
        query_text = normalize_text(arguments.get("q") or arguments.get("query")).lower()
        include_done = bool(arguments.get("include_done", True))
        limit = int(arguments.get("limit") or 500)

        where = []
        params: list[Any] = []
        if status and status != "all":
            where.append("status = ?")
            params.append(status)
        elif not include_done:
            where.append("status != ?")
            params.append("done")

        sql = "SELECT * FROM geo_manual"
        if where:
            sql += f" WHERE {' AND '.join(where)}"
        sql += """
            ORDER BY
                CASE status
                    WHEN 'in_work' THEN 0
                    WHEN 'testing' THEN 1
                    WHEN 'scaling' THEN 2
                    WHEN 'planned' THEN 3
                    WHEN 'paused' THEN 4
                    ELSE 5
                END,
                updated_at DESC,
                geo ASC
        """

        with self.connect() as conn:
            cursor = conn.execute(sql, params)
            geos = [self._geo_manual_from_row(row) for row in cursor.fetchall()]

        if query_text:
            geos = [
                geo for geo in geos
                if query_text in " ".join([
                    geo.get("geo", ""),
                    geo.get("owner", ""),
                    geo.get("action", ""),
                    geo.get("notes", ""),
                    " ".join(geo.get("tags", [])),
                ]).lower()
            ]

        return {
            "db_path": str(self.path),
            "count": len(geos[:limit]),
            "geos": geos[:limit],
        }

    def upsert_geo_manual(self, payload: dict[str, Any]) -> dict[str, Any]:
        geo = self._normalize_geo(payload.get("geo"))
        if not self._is_geo_code(geo):
            raise ValueError("GEO должен быть двухбуквенным кодом, например ZM")

        with self.connect() as conn:
            current = self._get_geo_manual(conn, geo) or self._empty_geo_manual(geo)
            status = normalize_text(payload.get("status") if "status" in payload else current.get("status")).lower()
            if status not in GEO_MANUAL_STATUSES:
                status = "planned"
            priority = normalize_text(payload.get("priority") if "priority" in payload else current.get("priority")).lower()
            if priority not in TODO_PRIORITIES:
                priority = "normal"
            tags = parse_tags(payload.get("tags") if "tags" in payload else current.get("tags"))
            record = {
                "geo": geo,
                "status": status,
                "priority": priority,
                "owner": normalize_text(payload.get("owner") if "owner" in payload else current.get("owner")),
                "action": normalize_text(payload.get("action") if "action" in payload else current.get("action")),
                "daily_budget": to_float(payload.get("daily_budget") if "daily_budget" in payload else current.get("daily_budget")),
                "cap": to_float(payload.get("cap") if "cap" in payload else current.get("cap")),
                "target_roi": to_float(payload.get("target_roi") if "target_roi" in payload else current.get("target_roi")),
                "payout": to_float(payload.get("payout") if "payout" in payload else current.get("payout")),
                "notes": normalize_text(payload.get("notes") if "notes" in payload else current.get("notes")),
                "tags": tags,
                "updated_at": utc_now(),
            }
            conn.execute(
                """
                INSERT INTO geo_manual (
                    geo, status, priority, owner, action, daily_budget, cap,
                    target_roi, payout, notes, tags_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(geo) DO UPDATE SET
                    status = excluded.status,
                    priority = excluded.priority,
                    owner = excluded.owner,
                    action = excluded.action,
                    daily_budget = excluded.daily_budget,
                    cap = excluded.cap,
                    target_roi = excluded.target_roi,
                    payout = excluded.payout,
                    notes = excluded.notes,
                    tags_json = excluded.tags_json,
                    updated_at = excluded.updated_at
                """,
                (
                    record["geo"],
                    record["status"],
                    record["priority"],
                    record["owner"],
                    record["action"],
                    record["daily_budget"],
                    record["cap"],
                    record["target_roi"],
                    record["payout"],
                    record["notes"],
                    json.dumps(record["tags"], ensure_ascii=False),
                    record["updated_at"],
                ),
            )
            conn.commit()
            saved = self._get_geo_manual(conn, geo)

        return {"db_path": str(self.path), "geo": saved}

    def delete_geo_manual(self, payload: dict[str, Any]) -> dict[str, Any]:
        geo = self._normalize_geo(payload.get("geo"))
        if geo == "UNKNOWN":
            raise ValueError("GEO обязателен")
        with self.connect() as conn:
            cursor = conn.execute("DELETE FROM geo_manual WHERE geo = ?", (geo,))
            conn.commit()
        return {"db_path": str(self.path), "deleted": cursor.rowcount, "geo": geo}

    def list_geo_tests(self, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        arguments = arguments or {}
        geo = self._normalize_geo(arguments.get("geo")) if arguments.get("geo") else ""
        status = normalize_text(arguments.get("status")).lower()
        include_finished = bool(arguments.get("include_finished", True))
        limit = int(arguments.get("limit") or 200)

        where = []
        params: list[Any] = []
        if geo:
            where.append("geo = ?")
            params.append(geo)
        if status and status != "all":
            where.append("status = ?")
            params.append(status)
        elif not include_finished:
            where.append("status NOT IN (?, ?)")
            params.extend(["finished", "failed"])

        sql = "SELECT * FROM geo_tests"
        if where:
            sql += f" WHERE {' AND '.join(where)}"
        sql += """
            ORDER BY
                CASE status
                    WHEN 'running' THEN 0
                    WHEN 'planned' THEN 1
                    WHEN 'paused' THEN 2
                    WHEN 'finished' THEN 3
                    ELSE 4
                END,
                COALESCE(start_date, created_at) DESC,
                id DESC
        """

        with self.connect() as conn:
            rows = [self._geo_test_from_row(row) for row in conn.execute(sql, params).fetchall()]
        if bool(arguments.get("include_todos", True)):
            todos = self.list_todos({
                "include_done": True,
                "include_archived": False,
                "limit": 1000,
            })["todos"]
            rows = self._attach_geo_test_todos(rows, todos)
        return {"db_path": str(self.path), "count": len(rows[:limit]), "tests": rows[:limit]}

    def upsert_geo_test(self, payload: dict[str, Any]) -> dict[str, Any]:
        test_id = int(payload.get("id") or payload.get("test_id") or 0)
        geo = self._normalize_geo(payload.get("geo"))
        if not self._is_geo_code(geo):
            raise ValueError("GEO должен быть двухбуквенным кодом, например ZM")
        title = normalize_text(payload.get("title") or payload.get("name"))
        if not title:
            raise ValueError("Название теста обязательно")
        status = normalize_text(payload.get("status") or "planned").lower()
        if status not in GEO_TEST_STATUSES:
            status = "planned"

        now = utc_now()
        sub5_values = parse_text_list(
            payload.get("sub5_values")
            or payload.get("sub5_variants")
            or payload.get("sub5Variants")
        )
        sub5 = normalize_text(payload.get("sub5"))
        if sub5 and sub5 not in sub5_values:
            sub5_values.insert(0, sub5)
        elif not sub5 and sub5_values:
            sub5 = sub5_values[0]
        test_key = normalize_text(payload.get("test_key") or payload.get("testKey"))
        if not test_key:
            test_key = derive_geo_test_key(sub5_values[0] if sub5_values else sub5)
        record = {
            "geo": geo,
            "title": title,
            "test_key": test_key,
            "status": status,
            "start_date": date_part(payload.get("start_date")),
            "end_date": date_part(payload.get("end_date")),
            "sub5": sub5,
            "sub5_values": sub5_values,
            "targeting": normalize_text(payload.get("targeting")),
            "hypothesis": normalize_text(payload.get("hypothesis")),
            "planned_budget": to_float(payload.get("planned_budget")),
            "creatives": parse_tags(payload.get("creatives")),
            "result": normalize_text(payload.get("result") or payload.get("result_summary")),
            "notes": normalize_text(payload.get("notes")),
            "updated_at": now,
        }
        with self.connect() as conn:
            if test_id > 0:
                current = self._get_geo_test(conn, test_id)
                if not current:
                    raise ValueError(f"GEO-тест {test_id} не найден")
                merged = {**current, **record}
                conn.execute(
                    """
                    UPDATE geo_tests
                    SET geo = ?, title = ?, test_key = ?, status = ?, start_date = ?, end_date = ?,
                        sub5 = ?, sub5_values_json = ?, targeting = ?, hypothesis = ?, planned_budget = ?,
                        creatives_json = ?, result = ?, notes = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        merged["geo"],
                        merged["title"],
                        merged["test_key"],
                        merged["status"],
                        merged["start_date"],
                        merged["end_date"],
                        merged["sub5"],
                        json.dumps(merged["sub5_values"], ensure_ascii=False),
                        merged["targeting"],
                        merged["hypothesis"],
                        merged["planned_budget"],
                        json.dumps(merged["creatives"], ensure_ascii=False),
                        merged["result"],
                        merged["notes"],
                        now,
                        test_id,
                    ),
                )
            else:
                cursor = conn.execute(
                    """
                    INSERT INTO geo_tests (
                        geo, title, test_key, status, start_date, end_date, sub5,
                        sub5_values_json, targeting, hypothesis, planned_budget,
                        creatives_json, result, notes,
                        created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        record["geo"],
                        record["title"],
                        record["test_key"],
                        record["status"],
                        record["start_date"],
                        record["end_date"],
                        record["sub5"],
                        json.dumps(record["sub5_values"], ensure_ascii=False),
                        record["targeting"],
                        record["hypothesis"],
                        record["planned_budget"],
                        json.dumps(record["creatives"], ensure_ascii=False),
                        record["result"],
                        record["notes"],
                        now,
                        now,
                    ),
                )
                test_id = int(cursor.lastrowid)
            conn.commit()
            test = self._get_geo_test(conn, test_id)
        return {"db_path": str(self.path), "test": test}

    def delete_geo_test(self, payload: dict[str, Any]) -> dict[str, Any]:
        test_id = int(payload.get("id") or payload.get("test_id") or 0)
        if test_id <= 0:
            raise ValueError("id GEO-теста обязателен")
        with self.connect() as conn:
            cursor = conn.execute("DELETE FROM geo_tests WHERE id = ?", (test_id,))
            conn.commit()
        return {"db_path": str(self.path), "deleted": cursor.rowcount, "id": test_id}

    def _get_geo_manual(self, conn: sqlite3.Connection, geo: str) -> dict[str, Any] | None:
        cursor = conn.execute("SELECT * FROM geo_manual WHERE geo = ?", (geo,))
        row = cursor.fetchone()
        return self._geo_manual_from_row(row) if row else None

    def _geo_manual_from_row(self, row: sqlite3.Row) -> dict[str, Any]:
        try:
            tags = json.loads(row["tags_json"] or "[]")
        except json.JSONDecodeError:
            tags = []
        return {
            "geo": row["geo"],
            "status": row["status"] or "planned",
            "priority": row["priority"] or "normal",
            "owner": row["owner"] or "",
            "action": row["action"] or "",
            "daily_budget": to_float(row["daily_budget"]),
            "cap": to_float(row["cap"]),
            "target_roi": to_float(row["target_roi"]),
            "payout": to_float(row["payout"]),
            "notes": row["notes"] or "",
            "tags": parse_tags(tags),
            "updated_at": row["updated_at"] or "",
        }

    def _empty_geo_manual(self, geo: str) -> dict[str, Any]:
        return {
            "geo": geo,
            "status": "",
            "priority": "normal",
            "owner": "",
            "action": "",
            "daily_budget": 0.0,
            "cap": 0.0,
            "target_roi": 0.0,
            "payout": 0.0,
            "notes": "",
            "tags": [],
            "updated_at": "",
        }

    def _get_geo_test(self, conn: sqlite3.Connection, test_id: int) -> dict[str, Any] | None:
        cursor = conn.execute("SELECT * FROM geo_tests WHERE id = ?", (test_id,))
        row = cursor.fetchone()
        return self._geo_test_from_row(row) if row else None

    def _geo_test_from_row(self, row: sqlite3.Row) -> dict[str, Any]:
        try:
            creatives = json.loads(row["creatives_json"] or "[]")
        except json.JSONDecodeError:
            creatives = []
        try:
            sub5_values = json.loads(row["sub5_values_json"] or "[]")
        except (IndexError, KeyError, json.JSONDecodeError):
            sub5_values = []
        sub5 = row["sub5"] or ""
        sub5_values = parse_text_list(sub5_values)
        if sub5 and sub5 not in sub5_values:
            sub5_values.insert(0, sub5)
        try:
            test_key = row["test_key"] or ""
        except (IndexError, KeyError):
            test_key = ""
        if not test_key:
            test_key = derive_geo_test_key(sub5_values[0] if sub5_values else sub5)
        return {
            "id": row["id"],
            "geo": row["geo"],
            "title": row["title"],
            "test_key": test_key,
            "status": row["status"] or "planned",
            "start_date": row["start_date"] or "",
            "end_date": row["end_date"] or "",
            "sub5": sub5,
            "sub5_values": sub5_values,
            "sub5_count": len(sub5_values),
            "targeting": row["targeting"] or "",
            "hypothesis": row["hypothesis"] or "",
            "planned_budget": to_float(row["planned_budget"]),
            "creatives": parse_tags(creatives),
            "result": row["result"] or "",
            "notes": row["notes"] or "",
            "created_at": row["created_at"] or "",
            "updated_at": row["updated_at"] or "",
        }

    def _get_todo(self, conn: sqlite3.Connection, todo_id: int) -> dict[str, Any] | None:
        cursor = conn.execute(
            "SELECT * FROM dashboard_actions WHERE id = ? AND entity_type = ?",
            (todo_id, TODO_ENTITY_TYPE),
        )
        row = cursor.fetchone()
        return self._todo_from_row(row) if row else None

    def _todo_from_row(self, row: sqlite3.Row) -> dict[str, Any]:
        try:
            metrics = json.loads(row["metrics_json"] or "{}")
        except json.JSONDecodeError:
            metrics = {}
        metrics = metrics if isinstance(metrics, dict) else {}
        priority = normalize_text(metrics.get("priority") or "normal").lower()
        if priority not in TODO_PRIORITIES:
            priority = "normal"
        category = normalize_text(metrics.get("category") or "ops")
        tags = parse_tags(metrics.get("tags"))
        return {
            "id": row["id"],
            "created_at": row["created_at"],
            "period_key": row["period_key"],
            "date_from": row["date_from"],
            "date_to": row["date_to"],
            "title": row["entity_name"],
            "note": row["reason"] or "",
            "owner": row["owner"] or "",
            "deadline": row["deadline"] or "",
            "status": row["status"] or "open",
            "source": row["budget_action"] or "",
            "priority": priority,
            "category": category,
            "tags": tags,
            "link": normalize_text(metrics.get("link")),
            "entity": normalize_text(metrics.get("entity")),
            "test_id": int(to_float(metrics.get("test_id"))),
            "test_key": normalize_text(metrics.get("test_key")),
            "test_title": normalize_text(metrics.get("test_title")),
            "checklist": parse_checklist(metrics.get("checklist")),
            "metrics": metrics,
        }

    def _todo_metrics_from_payload(self, payload: dict[str, Any], base: dict[str, Any] | None = None) -> dict[str, Any]:
        metrics = dict(base or {})
        raw_metrics = payload.get("metrics")
        if isinstance(raw_metrics, dict):
            metrics.update(raw_metrics)

        if "priority" in payload:
            priority = normalize_text(payload.get("priority")).lower()
            metrics["priority"] = priority if priority in TODO_PRIORITIES else "normal"
        else:
            metrics.setdefault("priority", "normal")

        if "category" in payload:
            metrics["category"] = normalize_text(payload.get("category") or "ops")
        else:
            metrics.setdefault("category", "ops")

        if "tags" in payload:
            metrics["tags"] = parse_tags(payload.get("tags"))
        else:
            metrics["tags"] = parse_tags(metrics.get("tags"))

        for key in ("context", "link", "entity"):
            if key in payload:
                metrics[key] = normalize_text(payload.get(key))

        if "test_id" in payload or "testId" in payload:
            test_id = int(to_float(payload.get("test_id") or payload.get("testId")))
            if test_id > 0:
                metrics["test_id"] = test_id
            else:
                metrics.pop("test_id", None)

        if "test_key" in payload or "testKey" in payload:
            test_key = normalize_text(payload.get("test_key") or payload.get("testKey"))
            if test_key:
                metrics["test_key"] = test_key
            else:
                metrics.pop("test_key", None)

        if "test_title" in payload or "testTitle" in payload:
            test_title = normalize_text(payload.get("test_title") or payload.get("testTitle"))
            if test_title:
                metrics["test_title"] = test_title
            else:
                metrics.pop("test_title", None)

        if "checklist" in payload:
            checklist = payload.get("checklist")
            if isinstance(checklist, list):
                metrics["checklist"] = parse_checklist(checklist)

        return metrics

    def _todo_matches_query(self, todo: dict[str, Any], query_text: str) -> bool:
        haystack = " ".join([
            normalize_text(todo.get("title")),
            normalize_text(todo.get("note")),
            normalize_text(todo.get("owner")),
            normalize_text(todo.get("category")),
            normalize_text(todo.get("source")),
            normalize_text(todo.get("entity")),
            normalize_text(todo.get("test_key")),
            normalize_text(todo.get("test_title")),
            " ".join(todo.get("tags") or []),
        ]).lower()
        return query_text in haystack

    def _todo_sort_key(self, todo: dict[str, Any]) -> tuple[Any, ...]:
        status_order = {"open": 0, "in_progress": 1, "done": 2, "archived": 3}
        priority_order = {"urgent": 0, "high": 1, "normal": 2, "low": 3}
        deadline = normalize_text(todo.get("deadline"))
        has_no_deadline = 1 if not deadline else 0
        return (
            status_order.get(todo.get("status"), 9),
            has_no_deadline,
            deadline or "9999-12-31",
            priority_order.get(todo.get("priority"), 9),
            -int(todo.get("id") or 0),
        )

    def _todo_stats(self, todos: list[dict[str, Any]]) -> dict[str, Any]:
        today = dt.date.today().isoformat()
        stats = {
            "total": len(todos),
            "open": 0,
            "in_progress": 0,
            "done": 0,
            "archived": 0,
            "urgent": 0,
            "high": 0,
            "overdue": 0,
            "due_today": 0,
            "by_source": {},
        }
        for todo in todos:
            status = todo.get("status") or "open"
            if status in stats:
                stats[status] += 1
            priority = todo.get("priority")
            if priority in ("urgent", "high"):
                stats[priority] += 1
            deadline = normalize_text(todo.get("deadline"))
            if deadline:
                if deadline < today and status not in {"done", "archived"}:
                    stats["overdue"] += 1
                if deadline == today and status not in {"done", "archived"}:
                    stats["due_today"] += 1
            source = normalize_text(todo.get("source") or "manual")
            stats["by_source"][source] = stats["by_source"].get(source, 0) + 1
        return stats

    def query(self, arguments: dict[str, Any]) -> dict[str, Any]:
        source = arguments.get("source", "spend")
        date_from, date_to, period_key = self._resolve_query_dates(arguments)
        group_by = arguments.get("group_by") or []
        default_metrics = ["revenue", "total_spend", "profit", "roi", "deposits", "cpa", "rpd"]
        if source == "keitaro":
            default_metrics = ["clicks", "conversions", "revenue", "cost", "profit", "roi", "cr", "cpa", "epc", "bot_share"]
        metrics = arguments.get("metrics") or default_metrics
        limit = int(arguments.get("limit", 50))
        order_by = arguments.get("order_by", "profit")
        order = str(arguments.get("order", "DESC")).upper()

        with self.connect() as conn:
            rows = self._load_rows(
                conn,
                source=source,
                date_from=date_from,
                date_to=date_to,
                period_key=period_key,
                report_name=arguments.get("report_name"),
            )

        include_technical = bool(arguments.get("include_technical_offers", False))
        rows = [
            row
            for row in rows
            if self._matches_filters(row, arguments.get("filters") or [])
            and (include_technical or not is_ignored_offer_row(row))
        ]
        grouped = aggregate_rows(rows, group_by, metrics)
        reverse = order != "ASC"
        grouped.sort(key=lambda row: to_float(row.get(order_by)), reverse=reverse)

        return {
            "db_path": str(self.path),
            "source": source,
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "group_by": group_by,
            "metrics": metrics,
            "row_count": len(rows),
            "rows": grouped[:limit],
        }

    def summary(self, arguments: dict[str, Any]) -> dict[str, Any]:
        date_from, date_to, period_key = self._resolve_query_dates(arguments)
        target_daily_profit = to_float(arguments.get("target_daily_profit", 1000))
        target_roi = to_float(arguments.get("target_roi", 0.6)) or 0.6

        spend_metrics = [
            "revenue",
            "acc_spend",
            "pwa_spend",
            "total_spend",
            "profit",
            "roi",
            "deposits",
            "cpa",
            "rpd",
        ]
        tracking_by_campaign = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": "tracking_quality",
            "group_by": ["sub_id_5", "campaign", "normalized_offer"],
            "metrics": ["campaign_unique_clicks", "clicks", "conversions", "revenue"],
            "limit": 10000,
        })["rows"]
        spend_detail_rows = self._spend_rows_for_offer_join(date_from, date_to, tracking_rows=tracking_by_campaign)
        spend = aggregate_rows(spend_detail_rows, ["normalized_offer"], spend_metrics)
        sub5_spend_rows = [
            row for row in spend
            if effective_sub5(row) or looks_like_sub5(row.get("normalized_offer") or row.get("offer") or row.get("offer_raw"))
        ]
        offers = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": "offer",
            "group_by": ["normalized_offer"],
            "metrics": ["clicks", "conversions", "revenue", "cost", "profit", "roi", "cr", "cpa", "epc", "bot_share"],
            "limit": 10000,
        })["rows"]
        deposits = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": EXACT_DEPOSITS_REPORT,
            "group_by": ["normalized_offer"],
            "metrics": ["conversions", "deposits", "revenue"],
            "limit": 10000,
        })["rows"]
        deposit_by_sub5 = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": EXACT_DEPOSITS_REPORT,
            "group_by": ["sub_id_5", "normalized_offer"],
            "metrics": ["conversions", "deposits", "revenue"],
            "limit": 10000,
        })["rows"]
        sub5_offer_map = self._build_sub5_offer_map(deposit_by_sub5 + tracking_by_campaign)
        with self.connect() as conn:
            sub5_offer_map.update(self._load_roi_sub5_offer_map(conn))
        spend, unmapped_sub5_rows = self._map_spend_sub5_to_offers(spend, sub5_offer_map)
        sub5_check_rows = self._format_unmapped_sub5_rows(
            sub5_spend_rows,
            period_key,
            date_from,
            date_to,
            exact_deposit_rows=deposit_by_sub5,
            tracking_rows=tracking_by_campaign,
        )
        unmapped_sub5_rows = self._format_unmapped_sub5_rows(
            unmapped_sub5_rows,
            period_key,
            date_from,
            date_to,
            exact_deposit_rows=deposit_by_sub5,
            tracking_rows=tracking_by_campaign,
        )
        creatives = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": "creative",
            "group_by": ["normalized_offer", "creative"],
            "metrics": ["clicks", "conversions", "revenue", "profit", "cr", "epc", "bot_share"],
            "limit": 10000,
        })["rows"]
        offers = self._canonicalize_roi_rows(
            offers,
            ["clicks", "conversions", "revenue", "cost", "profit", "roi", "cr", "cpa", "epc", "bot_share"],
        )
        deposits = self._canonicalize_roi_rows(deposits, ["conversions", "deposits", "revenue"])

        combined = combine_offer_rows(
            spend,
            offers,
            deposits,
        )
        kpis = aggregate_rows(combined, [], ["revenue", "total_spend", "profit", "roi", "deposits", "cpa", "rpd"])[0]
        kpis = add_unmapped_sub5_spend_to_kpis(kpis, unmapped_sub5_rows)
        spend_sources = {row.get("spend_source") for row in combined if to_float(row.get("total_spend"))}
        kpis["spend_source_label"] = (
            "FB + PWA"
            if {"spend", "campaign_split"} & spend_sources or to_float(kpis.get("unmapped_sub5_spend"))
            else "нет расхода"
        )
        kpis["required_spend_for_target_profit"] = round(safe_div(target_daily_profit, target_roi), 4)
        kpis["profit_gap"] = round(target_daily_profit - to_float(kpis.get("profit")), 4)

        offer_rows = [
            row for row in combined
            if not looks_like_sub5(row.get("normalized_offer") or row.get("offer") or row.get("offer_raw"))
        ]
        top_offers = [
            row for row in offer_rows
            if not is_empty_offer(normalize_text(row.get("normalized_offer") or row.get("offer")))
        ]
        decisions = [decision_for_offer(row, target_roi=target_roi) for row in offer_rows]
        sub5_candidates = [
            decision_for_offer(row, target_roi=target_roi)
            for row in sub5_check_rows
            if to_float(row.get("total_spend"))
        ]
        scale_candidates = [row for row in decisions if row["decision"] == "scale"]
        kill_candidates = [row for row in decisions if row["decision"] == "kill"]
        hold_candidates = [row for row in decisions if row["decision"] == "hold"]

        return {
            "db_path": str(self.path),
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "kpis": kpis,
            "top_offers": sorted(top_offers, key=lambda row: to_float(row.get("profit")), reverse=True)[:12],
            "scale_candidates": sorted(scale_candidates, key=lambda row: to_float(row["metrics"].get("profit")), reverse=True)[:5],
            "kill_candidates": sorted(kill_candidates, key=lambda row: to_float(row["metrics"].get("profit")))[:5],
            "hold_candidates": sorted(hold_candidates, key=lambda row: to_float(row["metrics"].get("profit")), reverse=True)[:10],
            "sub5_candidates": sorted(sub5_candidates, key=lambda row: to_float(row["metrics"].get("spend")), reverse=True)[:10],
            "creative_refresh": creative_refresh_candidates(creatives)[:10],
            "tracking_issues": self.tracking_issues(period_key, date_from, date_to)[:50],
        }

    def roi_table(self, arguments: dict[str, Any]) -> dict[str, Any]:
        date_from, date_to, period_key = self._resolve_query_dates(arguments)
        limit = int(arguments.get("limit") or 500)
        sort_by = normalize_text(arguments.get("sort_by") or arguments.get("order_by") or "profit")
        sort_order = normalize_text(arguments.get("sort_order") or arguments.get("order") or "DESC").upper()
        search = normalize_text(arguments.get("q")).casefold()

        spend_metrics = ["deposits", "revenue", "acc_spend", "pwa_spend", "total_spend", "profit", "roi", "cpa", "rpd"]
        tracking_by_campaign = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": "tracking_quality",
            "group_by": ["sub_id_5", "campaign", "normalized_offer"],
            "metrics": ["campaign_unique_clicks", "clicks", "conversions", "revenue"],
            "limit": 10000,
        })["rows"]
        spend_detail_rows = self._spend_rows_for_offer_join(date_from, date_to, tracking_rows=tracking_by_campaign)
        spend = aggregate_rows(spend_detail_rows, ["normalized_offer"], spend_metrics)
        deposit_by_sub5 = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": EXACT_DEPOSITS_REPORT,
            "group_by": ["sub_id_5", "normalized_offer"],
            "metrics": ["conversions", "deposits", "revenue"],
            "limit": 10000,
        })["rows"]
        sub5_offer_map = self._build_sub5_offer_map(deposit_by_sub5 + tracking_by_campaign)
        with self.connect() as conn:
            sub5_offer_map.update(self._load_roi_sub5_offer_map(conn))
        spend, unmapped_sub5_rows = self._map_spend_sub5_to_offers(spend, sub5_offer_map)
        unmapped_sub5_rows = self._format_unmapped_sub5_rows(
            unmapped_sub5_rows,
            period_key,
            date_from,
            date_to,
            exact_deposit_rows=deposit_by_sub5,
        )
        offers = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": "offer",
            "group_by": ["normalized_offer"],
            "metrics": ["clicks", "conversions", "revenue", "cost", "profit", "roi", "cr", "cpa", "epc", "bot_share"],
            "limit": 10000,
        })["rows"]
        offers = self._canonicalize_roi_rows(
            offers,
            ["clicks", "conversions", "revenue", "cost", "profit", "roi", "cr", "cpa", "epc", "bot_share"],
        )
        deposits = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": EXACT_DEPOSITS_REPORT,
            "group_by": ["normalized_offer"],
            "metrics": ["conversions", "deposits", "revenue"],
            "limit": 10000,
        })["rows"]
        deposits = self._canonicalize_roi_rows(deposits, ["conversions", "deposits", "revenue"])

        combined = combine_offer_rows(
            spend,
            offers,
            deposits,
        )
        with self.connect() as conn:
            manual_rows = self._load_roi_manual_rows(conn, period_key, date_from, date_to)

        manual_by_key = {row["row_key"]: row for row in manual_rows if row.get("enabled")}
        rows = []
        seen_keys = set()
        for source_row in combined:
            offer = canonical_roi_offer(source_row.get("normalized_offer") or source_row.get("offer") or source_row.get("offer_raw"))
            if not offer:
                continue
            key = roi_row_key(offer)
            row = self._roi_base_row(source_row, key, period_key, date_from, date_to)
            manual = manual_by_key.get(key)
            if manual:
                row = self._apply_roi_manual(row, manual)
            rows.append(row)
            seen_keys.add(key)

        for manual in manual_rows:
            if not manual.get("enabled") or not manual.get("is_manual") or manual["row_key"] in seen_keys:
                continue
            rows.append(self._roi_manual_to_row(manual, period_key, date_from, date_to))

        rows = [row for row in rows if roi_row_has_activity(row)]
        if search:
            rows = [
                row for row in rows
                if search in normalize_text(row.get("offer")).casefold()
                or search in normalize_text(row.get("notes")).casefold()
            ]

        agency_commission_percent = self._roi_agency_commission_percent(arguments)
        rows, agency_commission_amount = self._apply_roi_agency_commission(rows, agency_commission_percent)

        text_sorts = {"offer", "source", "notes"}
        reverse = sort_order != "ASC"
        rows.sort(
            key=lambda row: normalize_text(row.get(sort_by)).casefold()
            if sort_by in text_sorts
            else to_float(row.get(sort_by)),
            reverse=reverse,
        )

        kpis = aggregate_rows(
            rows,
            [],
            ["deposits", "revenue", "acc_spend", "pwa_spend", "total_spend", "profit", "roi", "cpa", "rpd"],
        )[0]
        kpis = add_unmapped_sub5_spend_to_kpis(kpis, unmapped_sub5_rows)
        unmapped_kpis = aggregate_rows(
            unmapped_sub5_rows,
            [],
            ["deposits", "revenue", "acc_spend", "pwa_spend", "total_spend", "profit", "roi", "cpa", "rpd"],
        )[0]
        return {
            "db_path": str(self.path),
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "row_count": len(rows),
            "manual_count": sum(1 for row in rows if row.get("is_manual")),
            "edited_count": sum(1 for row in rows if row.get("is_edited")),
            "unmapped_sub5_count": len(unmapped_sub5_rows),
            "unmapped_sub5_spend": unmapped_kpis.get("total_spend", 0),
            "unmapped_sub5_rows": unmapped_sub5_rows[:100],
            "agency_commission_percent": agency_commission_percent,
            "agency_commission_amount": agency_commission_amount,
            "kpis": kpis,
            "rows": rows[:max(1, min(limit, 5000))],
        }

    def upsert_roi_manual(self, payload: dict[str, Any]) -> dict[str, Any]:
        date_from, date_to, period_key = self._resolve_query_dates(payload)
        row_key = normalize_text(payload.get("row_key"))
        is_manual = parse_bool_arg(payload.get("is_manual"), not row_key or row_key.startswith("manual:"))
        if not row_key:
            row_key = f"manual:{uuid.uuid4().hex}"
            is_manual = True

        offer = canonical_roi_offer(payload.get("offer") or payload.get("normalized_offer"))
        if not offer:
            raise ValueError("offer is required")

        def metric_value(name: str) -> float | None:
            value = payload.get(name)
            return None if value in (None, "") else to_float(value)

        now = utc_now()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO roi_manual_rows (
                    row_key, period_key, date_from, date_to, is_manual, offer,
                    deposits, revenue, acc_spend, pwa_spend, notes, enabled,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT(row_key, period_key, date_from, date_to) DO UPDATE SET
                    is_manual = excluded.is_manual,
                    offer = excluded.offer,
                    deposits = excluded.deposits,
                    revenue = excluded.revenue,
                    acc_spend = excluded.acc_spend,
                    pwa_spend = excluded.pwa_spend,
                    notes = excluded.notes,
                    enabled = 1,
                    updated_at = excluded.updated_at
                """,
                (
                    row_key,
                    period_key,
                    date_from,
                    date_to,
                    1 if is_manual else 0,
                    offer,
                    metric_value("deposits"),
                    metric_value("revenue"),
                    metric_value("acc_spend"),
                    metric_value("pwa_spend"),
                    normalize_text(payload.get("notes")),
                    now,
                    now,
                ),
            )
            conn.commit()
        return {"saved": True, "row_key": row_key, "period_key": period_key, "date_from": date_from, "date_to": date_to}

    def delete_roi_manual(self, payload: dict[str, Any]) -> dict[str, Any]:
        date_from, date_to, period_key = self._resolve_query_dates(payload)
        row_key = normalize_text(payload.get("row_key"))
        if not row_key:
            raise ValueError("row_key is required")
        with self.connect() as conn:
            deleted = conn.execute(
                """
                DELETE FROM roi_manual_rows
                WHERE row_key = ? AND period_key = ? AND date_from = ? AND date_to = ?
                """,
                (row_key, period_key, date_from, date_to),
            ).rowcount
            conn.commit()
        return {"deleted": deleted, "row_key": row_key, "period_key": period_key, "date_from": date_from, "date_to": date_to}

    def roi_settings(self) -> dict[str, Any]:
        return {
            "agency_commission_percent": to_float(self.get_setting("roi_agency_commission_percent", 0)),
        }

    def save_roi_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        percent = max(0.0, to_float(payload.get("agency_commission_percent")))
        self.set_setting("roi_agency_commission_percent", round(percent, 4))
        return self.roi_settings()

    def upsert_roi_sub5_map(self, payload: dict[str, Any]) -> dict[str, Any]:
        raw_rows = payload.get("rows")
        rows = raw_rows if isinstance(raw_rows, list) else [payload]
        now = utc_now()
        saved = []
        with self.connect() as conn:
            for row in rows:
                if not isinstance(row, dict):
                    continue
                sub5 = normalize_text(row.get("sub5") or row.get("sub_id_5") or row.get("campaign"))
                offer = canonical_roi_offer(row.get("offer") or row.get("normalized_offer"))
                if not sub5:
                    raise ValueError("sub5 is required")
                if not offer:
                    raise ValueError("offer is required")
                conn.execute(
                    """
                    INSERT INTO roi_sub5_offer_map (
                        sub5, offer, notes, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(sub5) DO UPDATE SET
                        offer = excluded.offer,
                        notes = excluded.notes,
                        updated_at = excluded.updated_at
                    """,
                    (
                        sub5,
                        offer,
                        normalize_text(row.get("notes")),
                        now,
                        now,
                    ),
                )
                saved.append({"sub5": sub5, "offer": offer})
            conn.commit()
        return {"saved": len(saved), "rows": saved}

    def _load_roi_manual_rows(
        self,
        conn: sqlite3.Connection,
        period_key: str,
        date_from: str,
        date_to: str,
    ) -> list[dict[str, Any]]:
        cursor = conn.execute(
            """
            SELECT *
            FROM roi_manual_rows
            WHERE period_key = ? AND date_from = ? AND date_to = ?
            ORDER BY updated_at DESC, id DESC
            """,
            (period_key, date_from, date_to),
        )
        return [dict(row) for row in cursor.fetchall()]

    def _roi_base_row(
        self,
        source_row: dict[str, Any],
        row_key: str,
        period_key: str,
        date_from: str,
        date_to: str,
    ) -> dict[str, Any]:
        offer = canonical_roi_offer(source_row.get("normalized_offer") or source_row.get("offer") or source_row.get("offer_raw"))
        acc_spend = to_float(source_row.get("acc_spend"))
        pwa_spend = to_float(source_row.get("pwa_spend"))
        explicit_spend = to_float(source_row.get("total_spend"))
        if not (acc_spend or pwa_spend) and explicit_spend:
            acc_spend = explicit_spend
        source_label = {
            "spend": "FB/PWA",
            "campaign_split": "FB/PWA split",
        }.get(normalize_text(source_row.get("spend_source")), "auto")
        row = self._finalize_roi_row({
            "row_key": row_key,
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "offer": offer,
            "deposits": to_float(source_row.get("deposits")),
            "revenue": to_float(source_row.get("revenue")),
            "acc_spend": acc_spend,
            "pwa_spend": pwa_spend,
            "source": source_label,
            "notes": "",
            "is_manual": False,
            "is_edited": False,
            "updated_at": "",
        })
        for metric in ("deposits", "revenue", "acc_spend", "pwa_spend"):
            row[f"auto_{metric}"] = row[metric]
        return row

    def _apply_roi_manual(self, row: dict[str, Any], manual: dict[str, Any]) -> dict[str, Any]:
        row = dict(row)
        row["offer"] = canonical_roi_offer(manual.get("offer")) or row["offer"]
        for metric in ("deposits", "revenue", "acc_spend", "pwa_spend"):
            if manual.get(metric) is not None:
                row[metric] = to_float(manual.get(metric))
        row["notes"] = normalize_text(manual.get("notes"))
        row["is_edited"] = True
        row["manual_id"] = manual.get("id")
        row["updated_at"] = manual.get("updated_at") or ""
        return self._finalize_roi_row(row)

    def _roi_manual_to_row(
        self,
        manual: dict[str, Any],
        period_key: str,
        date_from: str,
        date_to: str,
    ) -> dict[str, Any]:
        return self._finalize_roi_row({
            "row_key": manual["row_key"],
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "offer": canonical_roi_offer(manual.get("offer")),
            "deposits": to_float(manual.get("deposits")),
            "revenue": to_float(manual.get("revenue")),
            "acc_spend": to_float(manual.get("acc_spend")),
            "pwa_spend": to_float(manual.get("pwa_spend")),
            "source": "manual",
            "notes": normalize_text(manual.get("notes")),
            "is_manual": True,
            "is_edited": False,
            "manual_id": manual.get("id"),
            "updated_at": manual.get("updated_at") or "",
        })

    def _finalize_roi_row(self, row: dict[str, Any]) -> dict[str, Any]:
        deposits = to_float(row.get("deposits"))
        revenue = to_float(row.get("revenue"))
        acc_spend = to_float(row.get("acc_spend"))
        pwa_spend = to_float(row.get("pwa_spend"))
        total_spend = acc_spend + pwa_spend
        profit = revenue - total_spend
        finalized = {
            **row,
            "deposits": round(deposits, 4),
            "revenue": round(revenue, 4),
            "acc_spend": round(acc_spend, 4),
            "pwa_spend": round(pwa_spend, 4),
            "total_spend": round(total_spend, 4),
            "profit": round(profit, 4),
            "roi": round(safe_div(profit, total_spend), 4),
            "cpa": round(safe_div(total_spend, deposits), 4),
            "rpd": round(safe_div(revenue, deposits), 4),
        }
        return finalized

    def _roi_agency_commission_percent(self, arguments: dict[str, Any]) -> float:
        if arguments.get("agency_commission_percent") not in (None, ""):
            return max(0.0, to_float(arguments.get("agency_commission_percent")))
        return to_float(self.get_setting("roi_agency_commission_percent", 0))

    def _apply_roi_agency_commission(
        self,
        rows: list[dict[str, Any]],
        percent: float,
    ) -> tuple[list[dict[str, Any]], float]:
        if percent <= 0:
            return rows, 0.0

        adjusted = []
        total_commission = 0.0
        for row in rows:
            base_acc_spend = to_float(row.get("acc_spend"))
            commission = round(base_acc_spend * percent / 100, 4)
            if commission <= 0:
                adjusted.append(row)
                continue

            total_commission += commission
            total_spend = to_float(row.get("total_spend")) + commission
            revenue = to_float(row.get("revenue"))
            deposits = to_float(row.get("deposits")) or to_float(row.get("conversions"))
            profit = revenue - total_spend
            adjusted.append({
                **row,
                "agency_commission_percent": round(percent, 4),
                "agency_commission_amount": commission,
                "total_spend": round(total_spend, 4),
                "profit": round(profit, 4),
                "roi": round(safe_div(profit, total_spend), 4),
                "cpa": round(safe_div(total_spend, deposits), 4),
                "rpd": round(safe_div(revenue, deposits), 4),
            })
        return adjusted, round(total_commission, 4)

    def _load_roi_sub5_offer_map(self, conn: sqlite3.Connection) -> dict[str, dict[str, Any]]:
        cursor = conn.execute(
            """
            SELECT sub5, offer, notes
            FROM roi_sub5_offer_map
            """
        )
        mapping: dict[str, dict[str, Any]] = {}
        for row in cursor.fetchall():
            sub5 = normalize_text(row["sub5"])
            offer = canonical_roi_offer(row["offer"])
            if sub5 and offer:
                mapping[sub5] = {
                    "offer": offer,
                    "score": 10**12,
                    "manual": True,
                    "notes": normalize_text(row["notes"]),
                }
        return mapping

    def replace_campaign_offer_splits(
        self,
        *,
        instance: str,
        rows: Iterable[dict[str, Any]],
    ) -> dict[str, Any]:
        records = []
        now = utc_now()
        for row in rows:
            campaign = normalize_text(row.get("campaign") or row.get("campaign_name"))
            offer = normalize_text(row.get("offer") or row.get("offer_name"))
            normalized_offer = canonical_roi_offer(row.get("normalized_offer") or offer) or offer
            share = to_float(row.get("share"))
            campaign_id = int(to_float(row.get("campaign_id")))
            if not campaign or not normalized_offer or share <= 0:
                continue
            records.append((
                instance,
                campaign_id,
                campaign,
                normalize_text(row.get("campaign_alias") or row.get("alias")),
                int(to_float(row.get("stream_id"))),
                normalize_text(row.get("stream") or row.get("stream_name")),
                int(to_float(row.get("offer_id"))),
                offer or normalized_offer,
                normalized_offer,
                share,
                normalize_text(row.get("state")),
                json.dumps(row, ensure_ascii=False, default=str),
                now,
            ))

        with self.connect() as conn:
            conn.execute("DELETE FROM campaign_offer_splits WHERE instance = ?", (instance,))
            conn.executemany(
                """
                INSERT INTO campaign_offer_splits (
                    instance, campaign_id, campaign, campaign_alias, stream_id, stream,
                    offer_id, offer, normalized_offer, share, state, raw_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                records,
            )
            conn.commit()
        return {"instance": instance, "rows": len(records)}

    def _load_spend_rows_for_period(
        self,
        conn: sqlite3.Connection,
        date_from: str,
        date_to: str,
    ) -> list[dict[str, Any]]:
        cursor = conn.execute(
            "SELECT * FROM spend_rows WHERE date BETWEEN ? AND ?",
            (date_from, date_to),
        )
        return [self._enrich_spend_row(dict(row)) for row in cursor.fetchall()]

    def _enrich_spend_row(self, row: dict[str, Any]) -> dict[str, Any]:
        raw = {}
        try:
            parsed = json.loads(row.get("raw_json") or "{}")
            raw = parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            raw = {}
        candidate = dict(row)
        candidate["_raw_spend_json"] = raw
        for key, value in raw.items():
            if candidate.get(key) in (None, ""):
                candidate[key] = value
        total_spend = to_float(candidate.get("total_spend"))
        if total_spend <= 0:
            candidate["total_spend"] = to_float(candidate.get("acc_spend")) + to_float(candidate.get("pwa_spend"))
        return candidate

    def _load_campaign_offer_split_index(
        self,
        conn: sqlite3.Connection,
        instance: str | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        params: list[Any] = []
        sql = """
            SELECT *
            FROM campaign_offer_splits
            WHERE share > 0
        """
        if instance:
            sql += " AND instance = ?"
            params.append(instance)
        cursor = conn.execute(sql, params)
        grouped: dict[str, dict[str, dict[str, Any]]] = {}

        def add_key(value: Any, row: sqlite3.Row) -> None:
            key = normalize_lookup_key(value)
            if not key:
                return
            campaign_bucket = grouped.setdefault(key, {})
            offer = normalize_text(row["normalized_offer"])
            offer_bucket = campaign_bucket.setdefault(offer, {
                "campaign": normalize_text(row["campaign"]),
                "campaign_id": row["campaign_id"],
                "normalized_offer": offer,
                "offer": normalize_text(row["offer"]) or offer,
                "share": 0.0,
            })
            offer_bucket["share"] += to_float(row["share"])

        for row in cursor.fetchall():
            add_key(row["campaign"], row)
            add_key(row["campaign_alias"], row)
            add_key(row["campaign_id"], row)

        index: dict[str, list[dict[str, Any]]] = {}
        for key, offers in grouped.items():
            total_share = sum(to_float(row.get("share")) for row in offers.values())
            if total_share <= 0:
                continue
            index[key] = [
                {**row, "share": to_float(row.get("share")) / total_share}
                for row in offers.values()
                if to_float(row.get("share")) > 0
            ]
        return index

    def _spend_campaign_candidates(self, row: dict[str, Any]) -> list[str]:
        candidates = []
        for key in (
            "facebook_campaign",
            "facebook_campaign_name",
            "campaign",
            "campaign_name",
            "ad_campaign",
            "ad_campaign_name",
            "offer_raw",
            "normalized_offer",
        ):
            value = normalize_text(row.get(key))
            if value and value not in candidates:
                candidates.append(value)

        raw = row.get("_raw_spend_json")
        raw_table = raw.get("raw") if isinstance(raw, dict) and isinstance(raw.get("raw"), dict) else {}
        for key, value in raw_table.items():
            if "campaign" not in normalize_lookup_key(key):
                continue
            value = normalize_text(value)
            if value and value not in candidates:
                candidates.append(value)
        return candidates

    def _split_spend_row_by_campaign(
        self,
        row: dict[str, Any],
        split_index: dict[str, list[dict[str, Any]]],
        click_index: dict[str, dict[str, float]] | None = None,
    ) -> list[dict[str, Any]] | None:
        if normalize_text(row.get("spend_level")).lower() == "offer":
            return None
        splits = None
        matched_campaign = ""
        for candidate in self._spend_campaign_candidates(row):
            splits = split_index.get(normalize_lookup_key(candidate))
            if splits:
                matched_campaign = candidate
                break
        if not splits:
            return None

        clicks_by_offer = (click_index or {}).get(normalize_lookup_key(matched_campaign), {})
        if not clicks_by_offer:
            for split in splits:
                clicks_by_offer = (click_index or {}).get(normalize_lookup_key(split.get("campaign")), {})
                if clicks_by_offer:
                    break
        matched_clicks = {
            split["normalized_offer"]: to_float(clicks_by_offer.get(split["normalized_offer"]))
            for split in splits
        }
        total_matched_clicks = sum(matched_clicks.values())
        use_click_weights = total_matched_clicks > 0

        split_rows = []
        for split in splits:
            configured_share = to_float(split.get("share"))
            click_count = matched_clicks.get(split["normalized_offer"], 0.0)
            share = safe_div(click_count, total_matched_clicks) if use_click_weights else configured_share
            if share <= 0:
                continue
            next_row = dict(row)
            for metric in ("deposits", "revenue", "acc_spend", "pwa_spend", "total_spend"):
                next_row[metric] = to_float(row.get(metric)) * share
            spend = row_total_spend(next_row)
            revenue = to_float(next_row.get("revenue"))
            deposits = to_float(next_row.get("deposits"))
            next_row.update({
                "normalized_offer": split["normalized_offer"],
                "offer": split["normalized_offer"],
                "spend_campaign": matched_campaign or split.get("campaign"),
                "spend_split_campaign": split.get("campaign"),
                "spend_split_source": "campaign_offer_clicks" if use_click_weights else "campaign_offer_splits",
                "spend_split_share": share,
                "spend_split_config_share": configured_share,
                "spend_split_clicks": click_count,
                "spend_source": "campaign_split",
                "profit": revenue - spend,
                "roi": safe_div(revenue - spend, spend),
                "cpa": safe_div(spend, deposits),
                "rpd": safe_div(revenue, deposits),
            })
            split_rows.append(next_row)
        return split_rows or None

    def _campaign_offer_click_index(self, rows: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
        index: dict[str, dict[str, float]] = {}
        for row in rows:
            campaign = normalize_lookup_key(row.get("campaign") or row.get("campaign_name"))
            offer = canonical_roi_offer(row.get("normalized_offer") or row.get("offer"))
            clicks = to_float(first_value(row, "campaign_unique_clicks", "unique_clicks", "uniques", "clicks"))
            if not campaign or not offer or clicks <= 0:
                continue
            bucket = index.setdefault(campaign, {})
            bucket[offer] = to_float(bucket.get(offer)) + clicks
        return index

    def _spend_rows_for_offer_join(
        self,
        date_from: str,
        date_to: str,
        tracking_rows: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = self._load_spend_rows_for_period(conn, date_from, date_to)
            split_index = self._load_campaign_offer_split_index(conn)
        if not split_index:
            return rows

        click_index = self._campaign_offer_click_index(tracking_rows or [])
        output = []
        for row in rows:
            split_rows = self._split_spend_row_by_campaign(row, split_index, click_index)
            output.extend(split_rows or [row])
        return output

    def campaign_names_for_split_refresh(self, periods: list[dict[str, str]]) -> list[str]:
        spend_names = []
        report_names = []
        with self.connect() as conn:
            for period in periods:
                date_from = period["date_from"]
                date_to = period["date_to"]
                period_key = period["period_key"]
                for row in self._load_spend_rows_for_period(conn, date_from, date_to):
                    spend_names.extend(self._spend_campaign_candidates(row))
                for report_name in ("campaign", "tracking_quality"):
                    for row in self._load_rows(
                        conn,
                        source="keitaro",
                        date_from=date_from,
                        date_to=date_to,
                        period_key=period_key,
                        report_name=report_name,
                    ):
                        campaign = normalize_text(row.get("campaign") or row.get("campaign_name"))
                        if campaign:
                            report_names.append(campaign)
        names = spend_names or report_names
        seen = set()
        result = []
        for name in names:
            key = normalize_lookup_key(name)
            if not key or key in seen:
                continue
            seen.add(key)
            result.append(name)
        return result

    def _build_sub5_offer_map(self, rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        mapping: dict[str, dict[str, Any]] = {}
        for row in rows:
            sub5 = effective_sub5(row)
            if not sub5 and looks_like_sub5(row.get("campaign")):
                sub5 = normalize_text(row.get("campaign"))
            offer = canonical_roi_offer(row.get("normalized_offer") or row.get("offer"))
            if not sub5 or not offer:
                continue
            score = (
                to_float(row.get("deposits")) * 100000
                + to_float(row.get("conversions")) * 10000
                + to_float(row.get("revenue")) * 100
                + to_float(row.get("clicks"))
            )
            current = mapping.get(sub5)
            if not current or score >= current["score"]:
                mapping[sub5] = {"offer": offer, "score": score}
        return mapping

    def _canonicalize_roi_rows(self, rows: list[dict[str, Any]], metrics: list[str]) -> list[dict[str, Any]]:
        canonical_rows = []
        for row in rows:
            offer = canonical_roi_offer(row.get("normalized_offer") or row.get("offer") or row.get("offer_raw"))
            if not offer:
                continue
            canonical_rows.append({**row, "normalized_offer": offer, "offer": offer})
        return aggregate_rows(canonical_rows, ["normalized_offer"], metrics)

    def _map_spend_sub5_to_offers(
        self,
        spend_rows: list[dict[str, Any]],
        sub5_offer_map: dict[str, dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        remapped = []
        unmapped = []
        for row in spend_rows:
            sub5 = effective_sub5(row)
            if not sub5 and looks_like_sub5(row.get("normalized_offer")):
                sub5 = normalize_text(row.get("normalized_offer"))
            if not sub5:
                offer = canonical_roi_offer(row.get("normalized_offer") or row.get("offer") or row.get("offer_raw"))
                if offer:
                    remapped.append({**row, "normalized_offer": offer, "offer": offer})
                continue
            mapped = sub5_offer_map.get(sub5)
            if not mapped:
                unmapped.append(row)
                continue
            remapped.append({
                **row,
                "normalized_offer": mapped["offer"],
                "offer": mapped["offer"],
                "spend_sub5": sub5,
                "spend_offer_raw": row.get("normalized_offer") or row.get("offer_raw"),
            })
        mapped_rows = aggregate_rows(
            remapped,
            ["normalized_offer"],
            ["deposits", "revenue", "acc_spend", "pwa_spend", "total_spend", "profit", "roi", "cpa", "rpd"],
        )
        unmapped_rows = aggregate_rows(
            unmapped,
            ["normalized_offer"],
            ["deposits", "revenue", "acc_spend", "pwa_spend", "total_spend", "profit", "roi", "cpa", "rpd"],
        )
        return mapped_rows, unmapped_rows

    def _sub5_exact_deposits_by_key(self, rows: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
        grouped: dict[str, dict[str, float]] = {}
        for row in rows:
            sub5 = effective_sub5(row)
            if not sub5 and looks_like_sub5(row.get("sub_id_5")):
                sub5 = normalize_text(row.get("sub_id_5"))
            if not sub5:
                continue
            bucket = grouped.setdefault(sub5, {"deposits": 0.0, "conversions": 0.0, "revenue": 0.0})
            conversions = to_float(row.get("conversions"))
            deposits = to_float(row.get("deposits")) or conversions
            bucket["deposits"] += deposits
            bucket["conversions"] += conversions
            bucket["revenue"] += to_float(row.get("revenue"))
        return grouped

    def _sub5_tracking_events_by_key(self, rows: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
        grouped: dict[str, dict[str, float]] = {}
        for row in rows:
            sub5 = effective_sub5(row)
            if not sub5 and looks_like_sub5(row.get("sub_id_5")):
                sub5 = normalize_text(row.get("sub_id_5"))
            if not sub5:
                continue
            bucket = grouped.setdefault(sub5, {"clicks": 0.0, "installs": 0.0, "regs": 0.0})
            clicks = to_float(row.get("clicks"))
            bucket["clicks"] += clicks
            bucket["installs"] += to_float(first_value(row, "campaign_unique_clicks")) or clicks
            bucket["regs"] += to_float(row.get("regs")) or to_float(row.get("conversions"))
        return grouped

    def _format_unmapped_sub5_rows(
        self,
        rows: list[dict[str, Any]],
        period_key: str,
        date_from: str,
        date_to: str,
        exact_deposit_rows: list[dict[str, Any]] | None = None,
        tracking_rows: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        exact_by_sub5 = self._sub5_exact_deposits_by_key(exact_deposit_rows or [])
        events_by_sub5 = self._sub5_tracking_events_by_key(tracking_rows or [])
        payout_hints = build_payout_hints(exact_deposit_rows or [])
        formatted = []
        for row in rows:
            sub5 = effective_sub5(row) or normalize_text(row.get("normalized_offer") or row.get("offer") or row.get("offer_raw"))
            if not sub5:
                continue
            parsed = parse_sub5(sub5) if looks_like_sub5(sub5) else {"sub5": sub5}
            exact = exact_by_sub5.get(sub5, {})
            events = events_by_sub5.get(sub5, {})
            exact_deposits = to_float(exact.get("deposits")) or to_float(exact.get("conversions"))
            exact_revenue = to_float(exact.get("revenue"))
            acc_spend = to_float(row.get("acc_spend"))
            pwa_spend = to_float(row.get("pwa_spend"))
            explicit_spend = to_float(row.get("total_spend"))
            if not (acc_spend or pwa_spend) and explicit_spend:
                acc_spend = explicit_spend
            payout_context = {
                **row,
                **parsed,
                "sub5": sub5,
                "sub_id_5": sub5,
            }
            payout = (
                to_float(row.get("payout"))
                or safe_div(exact_revenue, exact_deposits)
                or payout_hint_for_row(payout_context, payout_hints)
            )
            formatted.append(self._finalize_roi_row({
                **parsed,
                "row_key": f"unmapped:{hashlib.sha1(sub5.casefold().encode('utf-8')).hexdigest()[:16]}",
                "period_key": period_key,
                "date_from": date_from,
                "date_to": date_to,
                "offer": sub5,
                "normalized_offer": sub5,
                "sub5": sub5,
                "deposits": exact_deposits or to_float(row.get("deposits")),
                "revenue": exact_revenue or to_float(row.get("revenue")),
                "acc_spend": acc_spend,
                "pwa_spend": pwa_spend,
                "payout": payout,
                "clicks": to_float(events.get("clicks")) or to_float(row.get("clicks")),
                "installs": to_float(events.get("installs")) or to_float(row.get("installs")),
                "regs": to_float(events.get("regs")) or to_float(row.get("regs")),
                "source": "unmapped",
                "notes": "",
                "is_manual": False,
                "is_edited": False,
                "is_unmapped_sub5": True,
            }))
        formatted.sort(key=lambda item: to_float(item.get("total_spend")), reverse=True)
        return formatted

    def geo_overview(self, arguments: dict[str, Any]) -> dict[str, Any]:
        date_from, date_to, period_key = self._resolve_query_dates(arguments)
        limit = int(arguments.get("limit") or 80)
        metrics = ["revenue", "total_spend", "profit", "roi", "deposits", "cpa", "rpd"]
        lifetime_metrics_by_geo = self._geo_lifetime_metrics(metrics)
        geo_rows = self.query({
            "source": "spend",
            "date_from": date_from,
            "date_to": date_to,
            "group_by": ["geo"],
            "metrics": metrics,
            "order_by": "total_spend",
            "order": "DESC",
            "limit": 10000,
        })["rows"]
        history_rows = self.query({
            "source": "spend",
            "date_from": date_from,
            "date_to": date_to,
            "group_by": ["date", "geo"],
            "metrics": metrics,
            "order_by": "date",
            "order": "ASC",
            "limit": 10000,
        })["rows"]
        deposit_rows = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": EXACT_DEPOSITS_REPORT,
            "group_by": ["geo"],
            "metrics": ["deposits", "revenue"],
            "limit": 10000,
        })["rows"]
        deposit_history_rows = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": EXACT_DEPOSITS_REPORT,
            "group_by": ["row_date", "geo"],
            "metrics": ["deposits", "revenue"],
            "limit": 10000,
        })["rows"]
        deposits_by_geo = {}
        for row in deposit_rows:
            geo = self._normalize_geo(row.get("geo"))
            if self._is_geo_code(geo):
                deposits_by_geo[geo] = row
        deposits_by_day_geo = {}
        for row in deposit_history_rows:
            geo = self._normalize_geo(row.get("geo"))
            if not self._is_geo_code(geo):
                continue
            deposits_by_day_geo[(normalize_text(row.get("row_date")) or date_to, geo)] = row
        geo_todos = self.list_todos({
            "category": "geo",
            "include_done": True,
            "include_archived": False,
            "limit": 500,
        })["todos"]
        manual_geos = self.list_geo_manual({"include_done": True, "limit": 1000})["geos"]
        manual_by_geo = {
            geo: row
            for row in manual_geos
            if self._is_geo_code(geo := self._normalize_geo(row.get("geo")))
        }
        geo_tests = self.list_geo_tests({"include_finished": True, "include_todos": False, "limit": 500})["tests"]
        geo_creatives = self._geo_creatives(date_from, date_to, period_key)
        geo_creatives = [row for row in geo_creatives if self._is_geo_code(row.get("geo"))]
        creatives_by_geo: dict[str, list[dict[str, Any]]] = {}
        for creative in geo_creatives:
            creatives_by_geo.setdefault(self._normalize_geo(creative.get("geo")), []).append(creative)
        offer_breakdown = self._geo_offer_breakdown(date_from, date_to, period_key)
        offer_breakdown_rows = [
            row for row in offer_breakdown
            if row.get("source_type") != "sub5" and self._is_geo_code(row.get("geo"))
        ]
        sub5_breakdown_rows = [
            row for row in offer_breakdown
            if row.get("source_type") == "sub5" and self._is_geo_code(row.get("geo"))
        ]
        geo_tests = [test for test in geo_tests if self._is_geo_code(test.get("geo"))]
        geo_tests = self._attach_geo_test_metrics(geo_tests, sub5_breakdown_rows)
        geo_tests = self._attach_geo_test_todos(geo_tests, geo_todos)
        tests_by_geo: dict[str, list[dict[str, Any]]] = {}
        for test in geo_tests:
            tests_by_geo.setdefault(self._normalize_geo(test.get("geo")), []).append(test)
        offers_by_geo: dict[str, list[dict[str, Any]]] = {}
        for offer in offer_breakdown_rows:
            offers_by_geo.setdefault(self._normalize_geo(offer.get("geo")), []).append(offer)
        todos_by_geo: dict[str, list[dict[str, Any]]] = {}
        for todo in geo_todos:
            for geo in self._todo_geo_keys(todo):
                if self._is_geo_code(geo):
                    todos_by_geo.setdefault(geo, []).append(todo)

        rows = []
        seen_geos = set()
        for row in geo_rows:
            geo = self._normalize_geo(row.get("geo"))
            if not self._is_geo_code(geo):
                continue
            row = self._merge_geo_deposits(row, deposits_by_geo.get(geo))
            seen_geos.add(geo)
            active_todos = [
                todo for todo in todos_by_geo.get(geo, [])
                if todo.get("status") not in {"done", "archived"}
            ]
            manual = manual_by_geo.get(geo)
            recommendation = self._geo_recommendation(row, active_todos, manual)
            rows.append(self._geo_row_payload(
                row,
                geo,
                recommendation,
                active_todos,
                manual,
                tests_by_geo.get(geo, []),
                creatives_by_geo.get(geo, []),
                offers_by_geo.get(geo, []),
                lifetime_metrics_by_geo.get(geo),
            ))
        for geo, deposit_row in deposits_by_geo.items():
            if geo in seen_geos:
                continue
            row = self._merge_geo_deposits({"geo": geo, "total_spend": 0, "profit": 0}, deposit_row)
            seen_geos.add(geo)
            active_todos = [
                todo for todo in todos_by_geo.get(geo, [])
                if todo.get("status") not in {"done", "archived"}
            ]
            manual = manual_by_geo.get(geo)
            recommendation = self._geo_recommendation(row, active_todos, manual)
            rows.append(self._geo_row_payload(
                row,
                geo,
                recommendation,
                active_todos,
                manual,
                tests_by_geo.get(geo, []),
                creatives_by_geo.get(geo, []),
                offers_by_geo.get(geo, []),
                lifetime_metrics_by_geo.get(geo),
            ))
        for geo, manual in manual_by_geo.items():
            if geo in seen_geos:
                continue
            row = self._merge_geo_deposits({"geo": geo, "total_spend": 0, "revenue": 0, "deposits": 0, "profit": 0}, None)
            active_todos = [
                todo for todo in todos_by_geo.get(geo, [])
                if todo.get("status") not in {"done", "archived"}
            ]
            recommendation = self._geo_recommendation(row, active_todos, manual)
            rows.append(self._geo_row_payload(
                row,
                geo,
                recommendation,
                active_todos,
                manual,
                tests_by_geo.get(geo, []),
                creatives_by_geo.get(geo, []),
                offers_by_geo.get(geo, []),
                lifetime_metrics_by_geo.get(geo),
            ))
        for geo, tests in tests_by_geo.items():
            if any(row.get("geo") == geo for row in rows):
                continue
            row = self._merge_geo_deposits({"geo": geo, "total_spend": 0, "revenue": 0, "deposits": 0, "profit": 0}, None)
            active_todos = [
                todo for todo in todos_by_geo.get(geo, [])
                if todo.get("status") not in {"done", "archived"}
            ]
            manual = manual_by_geo.get(geo)
            recommendation = self._geo_recommendation(row, active_todos, manual)
            rows.append(self._geo_row_payload(
                row,
                geo,
                recommendation,
                active_todos,
                manual,
                tests,
                creatives_by_geo.get(geo, []),
                offers_by_geo.get(geo, []),
                lifetime_metrics_by_geo.get(geo),
            ))

        history = []
        for row in history_rows:
            geo = self._normalize_geo(row.get("geo"))
            if not self._is_geo_code(geo):
                continue
            date = normalize_text(row.get("date"))
            row = self._merge_geo_deposits(row, deposits_by_day_geo.get((date, geo)))
            history.append({
                **row,
                "geo": geo,
            })
        seen_history = {(row.get("date"), row.get("geo")) for row in history}
        for (date, geo), deposit_row in deposits_by_day_geo.items():
            if (date, geo) in seen_history:
                continue
            history.append(self._merge_geo_deposits({
                "date": date,
                "geo": geo,
                "total_spend": 0,
                "profit": 0,
            }, deposit_row))
        history.sort(key=lambda row: (row.get("date") or "", row.get("geo") or ""))
        rows.sort(key=lambda row: (row["recommendation"] != "scale", -to_float(row.get("total_spend"))))
        kpis = aggregate_rows(rows, [], metrics)[0] if rows else aggregate_rows([], [], metrics)[0]
        active_geo_keys = {
            geo for geo, todos in todos_by_geo.items()
            if self._is_geo_code(geo) and any(todo.get("status") not in {"done", "archived"} for todo in todos)
        }
        active_geo_keys.update(
            geo for geo, manual in manual_by_geo.items()
            if self._is_geo_code(geo) and manual.get("status") in GEO_ACTIVE_STATUSES
        )
        active_geo_keys.update(
            geo for geo, tests in tests_by_geo.items()
            if self._is_geo_code(geo) and any(test.get("status") in {"planned", "running"} for test in tests)
        )
        active_geos = [
            {
                "geo": geo,
                "todo_count": len([todo for todo in todos_by_geo.get(geo, []) if todo.get("status") not in {"done", "archived"}]),
                "todos": [todo for todo in todos_by_geo.get(geo, []) if todo.get("status") not in {"done", "archived"}][:6],
                "tests": [test for test in tests_by_geo.get(geo, []) if test.get("status") in {"planned", "running"}][:6],
                "test_count": len([test for test in tests_by_geo.get(geo, []) if test.get("status") in {"planned", "running"}]),
                "manual": manual_by_geo.get(geo) or self._empty_geo_manual(geo),
                "manual_status": (manual_by_geo.get(geo) or {}).get("status", ""),
                "manual_action": (manual_by_geo.get(geo) or {}).get("action", ""),
                "manual_owner": (manual_by_geo.get(geo) or {}).get("owner", ""),
                "top_creatives": creatives_by_geo.get(geo, [])[:3],
                "top_offers": offers_by_geo.get(geo, [])[:3],
                "lifetime_metrics": lifetime_metrics_by_geo.get(geo, {}),
            }
            for geo in sorted(active_geo_keys)
        ]
        return {
            "db_path": str(self.path),
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "kpis": kpis,
            "rows": rows[:limit],
            "history": history[-limit:],
            "active_geos": active_geos,
            "todos": geo_todos,
            "manual_geos": manual_geos,
            "geo_tests": geo_tests,
            "creatives": geo_creatives,
            "offer_breakdown": offer_breakdown_rows,
            "sub5_breakdown": sub5_breakdown_rows,
        }

    def _geo_lifetime_metrics(self, metrics: list[str]) -> dict[str, dict[str, Any]]:
        bounds = self._data_period_bounds()
        if not bounds:
            return {}
        date_from, date_to = bounds
        period_key = "full_period"
        geo_rows = self.query({
            "source": "spend",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "group_by": ["geo"],
            "metrics": metrics,
            "order_by": "total_spend",
            "order": "DESC",
            "limit": 10000,
        })["rows"]
        deposit_rows = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": EXACT_DEPOSITS_REPORT,
            "group_by": ["geo"],
            "metrics": ["deposits", "revenue"],
            "limit": 10000,
        })["rows"]
        deposits_by_geo = {}
        for row in deposit_rows:
            geo = self._normalize_geo(row.get("geo"))
            if self._is_geo_code(geo):
                deposits_by_geo[geo] = row

        output = {}

        def lifetime_payload(geo: str, row: dict[str, Any]) -> dict[str, Any]:
            return {
                "geo": geo,
                "revenue": round(to_float(row.get("revenue")), 4),
                "total_spend": round(to_float(row.get("total_spend")), 4),
                "profit": round(to_float(row.get("profit")), 4),
                "roi": round(to_float(row.get("roi")), 4),
                "deposits": round(to_float(row.get("deposits")), 4),
                "cpa": round(to_float(row.get("cpa")), 4),
                "rpd": round(to_float(row.get("rpd")), 4),
                "period_key": period_key,
                "date_from": date_from,
                "date_to": date_to,
            }

        for row in geo_rows:
            geo = self._normalize_geo(row.get("geo"))
            if not self._is_geo_code(geo):
                continue
            output[geo] = lifetime_payload(geo, self._merge_geo_deposits(row, deposits_by_geo.get(geo)))

        for geo, deposit_row in deposits_by_geo.items():
            if geo in output:
                continue
            output[geo] = lifetime_payload(
                geo,
                self._merge_geo_deposits({"geo": geo, "total_spend": 0, "revenue": 0, "deposits": 0, "profit": 0}, deposit_row),
            )
        return output

    def codex_context(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """Compact machine-readable context for Codex and local automation."""
        summary = self.summary(arguments)
        todo_limit = int(arguments.get("todo_limit") or arguments.get("limit") or 30)
        active_todos = self.list_todos({
            "status": "active",
            "include_done": False,
            "limit": todo_limit,
        })
        recent_todos = self.list_todos({
            "include_done": True,
            "include_archived": False,
            "limit": min(todo_limit, 20),
        })
        return {
            "db_path": str(self.path),
            "period_key": summary["period_key"],
            "date_from": summary["date_from"],
            "date_to": summary["date_to"],
            "kpis": summary["kpis"],
            "todos": {
                "active": active_todos["todos"],
                "recent": recent_todos["todos"],
                "stats": active_todos["stats"],
            },
            "decisions": {
                "scale_candidates": summary["scale_candidates"],
                "kill_candidates": summary["kill_candidates"],
                "creative_refresh": summary["creative_refresh"],
                "tracking_issues": summary["tracking_issues"],
            },
            "integration": {
                "todo_api": {
                    "list": "/api/todos?status=active",
                    "create": "POST /api/todos",
                    "update": "POST /api/todos/update",
                    "delete": "POST /api/todos/delete",
                },
                "cli_examples": [
                    "python -m keitaro_dashboard codex-context --period-key today",
                    "python -m keitaro_dashboard todo-list --status active",
                    "python -m keitaro_dashboard todo-add \"Проверить связку\" --priority high --source codex",
                ],
            },
        }

    def _normalize_geo(self, value: Any) -> str:
        geo = normalize_text(value).upper()
        return geo or "UNKNOWN"

    def _is_geo_code(self, value: Any) -> bool:
        geo = self._normalize_geo(value)
        return (
            geo != "UNKNOWN"
            and geo not in TODO_GEO_TAG_IGNORES
            and len(geo) == 2
            and geo.isascii()
            and geo.isalpha()
        )

    def _merge_geo_deposits(self, row: dict[str, Any], deposit_row: dict[str, Any] | None) -> dict[str, Any]:
        merged = dict(row)
        if deposit_row:
            merged["revenue"] = to_float(deposit_row.get("revenue"))
            merged["deposits"] = to_float(deposit_row.get("deposits")) or to_float(deposit_row.get("conversions"))
        spend = to_float(merged.get("total_spend"))
        revenue = to_float(merged.get("revenue"))
        deposits = to_float(merged.get("deposits"))
        profit = revenue - spend
        merged["profit"] = profit
        merged["roi"] = safe_div(profit, spend)
        merged["cpa"] = safe_div(spend, deposits)
        merged["rpd"] = safe_div(revenue, deposits)
        return merged

    def _geo_row_payload(
        self,
        row: dict[str, Any],
        geo: str,
        recommendation: dict[str, str],
        active_todos: list[dict[str, Any]],
        manual: dict[str, Any] | None,
        geo_tests: list[dict[str, Any]] | None = None,
        creatives: list[dict[str, Any]] | None = None,
        offers: list[dict[str, Any]] | None = None,
        lifetime_metrics: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        manual_view = manual or self._empty_geo_manual(geo)
        geo_tests = geo_tests or []
        creatives = creatives or []
        offers = offers or []
        lifetime_metrics = lifetime_metrics or {}
        active_tests = [test for test in geo_tests if test.get("status") in {"planned", "running"}]
        return {
            **row,
            "geo": geo,
            "recommendation": recommendation["code"],
            "recommendation_label": recommendation["label"],
            "reason": recommendation["reason"],
            "todo_count": len(active_todos),
            "todos": active_todos[:5],
            "manual": manual_view,
            "manual_status": manual_view.get("status", ""),
            "manual_priority": manual_view.get("priority", "normal"),
            "manual_owner": manual_view.get("owner", ""),
            "manual_action": manual_view.get("action", ""),
            "manual_daily_budget": to_float(manual_view.get("daily_budget")),
            "manual_cap": to_float(manual_view.get("cap")),
            "manual_target_roi": to_float(manual_view.get("target_roi")),
            "manual_payout": to_float(manual_view.get("payout")),
            "manual_notes": manual_view.get("notes", ""),
            "manual_tags": manual_view.get("tags", []),
            "test_count": len(geo_tests),
            "active_test_count": len(active_tests),
            "tests": geo_tests[:6],
            "top_creatives": creatives[:5],
            "offer_count": len(offers),
            "offers": offers[:12],
            "lifetime_metrics": lifetime_metrics,
        }

    def _attach_geo_test_metrics(
        self,
        geo_tests: list[dict[str, Any]],
        sub5_rows: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        rows_by_sub5 = {
            normalize_text(row.get("normalized_offer") or row.get("offer")): row
            for row in sub5_rows
        }
        output = []
        for test in geo_tests:
            sub5_values = parse_text_list(test.get("sub5_values"))
            primary_sub5 = normalize_text(test.get("sub5"))
            if primary_sub5 and primary_sub5 not in sub5_values:
                sub5_values.insert(0, primary_sub5)
            metrics = {
                "total_spend": 0.0,
                "revenue": 0.0,
                "profit": 0.0,
                "deposits": 0.0,
                "cpa": 0.0,
                "rpd": 0.0,
                "roi": 0.0,
            }
            matched = []
            for sub5 in sub5_values:
                row = rows_by_sub5.get(sub5)
                if not row:
                    continue
                matched.append(sub5)
                metrics["total_spend"] += to_float(row.get("total_spend"))
                metrics["revenue"] += to_float(row.get("revenue"))
                metrics["deposits"] += to_float(row.get("deposits"))
            metrics["profit"] = metrics["revenue"] - metrics["total_spend"]
            metrics["roi"] = safe_div(metrics["profit"], metrics["total_spend"])
            metrics["cpa"] = safe_div(metrics["total_spend"], metrics["deposits"])
            metrics["rpd"] = safe_div(metrics["revenue"], metrics["deposits"])
            rounded_metrics = {
                key: round(value, 4) for key, value in metrics.items()
            }
            output.append({
                **test,
                "sub5_values": sub5_values,
                "sub5_count": len(sub5_values),
                "matched_sub5_count": len(matched),
                "matched_sub5_values": matched,
                "metrics": rounded_metrics,
            })
        return output

    def _attach_geo_test_todos(
        self,
        geo_tests: list[dict[str, Any]],
        todos: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        todos_by_test_id: dict[int, list[dict[str, Any]]] = {}
        todos_by_test_key: dict[str, list[dict[str, Any]]] = {}
        for todo in todos:
            test_id = int(to_float(todo.get("test_id")))
            if test_id > 0:
                todos_by_test_id.setdefault(test_id, []).append(todo)
            test_key = normalize_text(todo.get("test_key"))
            if test_key:
                todos_by_test_key.setdefault(test_key, []).append(todo)

        output = []
        for test in geo_tests:
            related: list[dict[str, Any]] = []
            seen_ids: set[int] = set()
            test_id = int(to_float(test.get("id")))
            test_key = normalize_text(test.get("test_key"))

            def add_todo(todo: dict[str, Any]) -> None:
                todo_id = int(to_float(todo.get("id")))
                if todo_id in seen_ids:
                    return
                seen_ids.add(todo_id)
                related.append(todo)

            for todo in todos_by_test_id.get(test_id, []):
                add_todo(todo)
            if test_key:
                for todo in todos_by_test_key.get(test_key, []):
                    add_todo(todo)

            active_todos = [
                todo for todo in related
                if todo.get("status") not in {"done", "archived"}
            ]
            output.append({
                **test,
                "todos": related[:20],
                "todo_count": len(related),
                "active_todo_count": len(active_todos),
                "todo_stats": self._todo_stats(related),
            })
        return output

    def _geo_offer_breakdown(self, date_from: str, date_to: str, period_key: str) -> list[dict[str, Any]]:
        metrics = ["revenue", "total_spend", "profit", "roi", "deposits", "cpa", "rpd"]
        spend_rows = self.query({
            "source": "spend",
            "date_from": date_from,
            "date_to": date_to,
            "group_by": ["geo", "normalized_offer"],
            "metrics": metrics,
            "order_by": "total_spend",
            "order": "DESC",
            "limit": 10000,
        })["rows"]
        deposit_by_sub5 = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": EXACT_DEPOSITS_REPORT,
            "group_by": ["sub_id_5", "normalized_offer"],
            "metrics": ["conversions", "deposits", "revenue"],
            "limit": 10000,
        })["rows"]
        tracking_by_campaign = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": "tracking_quality",
            "group_by": ["sub_id_5", "campaign", "normalized_offer"],
            "metrics": ["clicks", "conversions", "revenue"],
            "limit": 10000,
        })["rows"]
        deposit_rows = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": EXACT_DEPOSITS_REPORT,
            "group_by": ["geo", "normalized_offer"],
            "metrics": ["deposits", "revenue"],
            "limit": 10000,
        })["rows"]

        sub5_offer_map = self._build_sub5_offer_map(deposit_by_sub5 + tracking_by_campaign)
        with self.connect() as conn:
            sub5_offer_map.update(self._load_roi_sub5_offer_map(conn))

        offer_buckets: dict[tuple[str, str], dict[str, Any]] = {}
        sub5_buckets: dict[tuple[str, str], dict[str, Any]] = {}

        def geo_for(row: dict[str, Any], offer: str = "") -> str:
            geo = self._normalize_geo(row.get("geo"))
            if geo != "UNKNOWN":
                return geo
            if offer:
                geo = clean_geo_code(offer.split("|", 1)[0])
                if geo:
                    return geo
            return self._normalize_geo(derive_geo(row))

        def raw_offer(row: dict[str, Any]) -> str:
            return normalize_text(row.get("normalized_offer") or row.get("offer") or row.get("offer_raw"))

        def mapped_offer(row: dict[str, Any]) -> str:
            raw = raw_offer(row)
            sub5 = effective_sub5(row)
            if not sub5 and looks_like_sub5(raw):
                sub5 = raw
            if sub5:
                mapped = sub5_offer_map.get(sub5)
                return mapped["offer"] if mapped else ""
            return canonical_roi_offer(raw)

        def bucket_for(
            buckets: dict[tuple[str, str], dict[str, Any]],
            row: dict[str, Any],
            offer: str,
            source_type: str,
        ) -> dict[str, Any]:
            geo = geo_for(row, offer)
            offer = offer or "(unknown)"
            return buckets.setdefault((geo, offer), {
                "geo": geo,
                "normalized_offer": offer,
                "offer": offer,
                "source_type": source_type,
                "revenue": 0,
                "total_spend": 0,
                "profit": 0,
                "deposits": 0,
                "spend_revenue": 0,
                "spend_deposits": 0,
                "exact_deposit_revenue": 0,
            })

        def add_spend(bucket: dict[str, Any], row: dict[str, Any]) -> None:
            bucket["total_spend"] = to_float(bucket.get("total_spend")) + to_float(row.get("total_spend"))
            bucket["spend_revenue"] = to_float(bucket.get("spend_revenue")) + to_float(row.get("revenue"))
            bucket["spend_deposits"] = to_float(bucket.get("spend_deposits")) + to_float(row.get("deposits"))

        def add_deposits(bucket: dict[str, Any], row: dict[str, Any]) -> None:
            revenue = to_float(row.get("revenue"))
            deposits = to_float(row.get("deposits")) or to_float(row.get("conversions"))
            bucket["revenue"] = to_float(bucket.get("revenue")) + revenue
            bucket["deposits"] = to_float(bucket.get("deposits")) + deposits
            bucket["exact_deposit_revenue"] = to_float(bucket.get("exact_deposit_revenue")) + revenue

        for row in spend_rows:
            raw = raw_offer(row)
            if looks_like_sub5(raw):
                add_spend(bucket_for(sub5_buckets, row, raw, "sub5"), row)
            offer = mapped_offer(row)
            if offer:
                add_spend(bucket_for(offer_buckets, row, offer, "offer"), row)

        sub5_deposit_keys: set[tuple[str, str]] = set()
        for row in deposit_by_sub5:
            sub5 = effective_sub5(row)
            if not sub5 and looks_like_sub5(row.get("sub_id_5")):
                sub5 = normalize_text(row.get("sub_id_5"))
            if not looks_like_sub5(sub5):
                continue
            bucket = bucket_for(sub5_buckets, {**row, "normalized_offer": sub5}, sub5, "sub5")
            add_deposits(bucket, row)
            sub5_deposit_keys.add((bucket["geo"], sub5))

        for row in deposit_rows:
            raw = raw_offer(row)
            if looks_like_sub5(raw):
                bucket = bucket_for(sub5_buckets, row, raw, "sub5")
                if (bucket["geo"], raw) not in sub5_deposit_keys:
                    add_deposits(bucket, row)
            offer = mapped_offer(row)
            if offer:
                add_deposits(bucket_for(offer_buckets, row, offer, "offer"), row)

        output = []
        for bucket in [*offer_buckets.values(), *sub5_buckets.values()]:
            if not to_float(bucket.get("revenue")) and to_float(bucket.get("spend_revenue")):
                bucket["revenue"] = to_float(bucket.get("spend_revenue"))
            if not to_float(bucket.get("deposits")) and to_float(bucket.get("spend_deposits")):
                bucket["deposits"] = to_float(bucket.get("spend_deposits"))
            merged = self._merge_geo_deposits(bucket, {
                "revenue": bucket.get("revenue"),
                "deposits": bucket.get("deposits"),
            })
            decision = decision_for_offer(merged)
            merged.update({
                "decision": decision["decision"],
                "budget_action": decision["budget_action"],
                "reason": decision["reason"],
                "metrics": decision["metrics"],
            })
            output.append(merged)

        output.sort(key=lambda row: (
            row.get("geo") or "",
            -max(to_float(row.get("total_spend")), to_float(row.get("revenue"))),
            -to_float(row.get("profit")),
            normalize_text(row.get("normalized_offer")).lower(),
        ))
        return output

    def _geo_creatives(self, date_from: str, date_to: str, period_key: str) -> list[dict[str, Any]]:
        metrics = [
            "clicks",
            "conversions",
            "revenue",
            "acc_spend",
            "pwa_spend",
            "total_spend",
            "profit",
            "roi",
            "cr",
            "cpc",
            "epc",
            "bot_share",
        ]
        rows = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": "creative",
            "group_by": ["geo", "creative"],
            "metrics": metrics,
            "order_by": "revenue",
            "order": "DESC",
            "limit": 10000,
        })["rows"]
        geo_scores_by_creative: dict[str, dict[str, float]] = {}
        for row in rows:
            creative = normalize_text(row.get("creative"))
            geo = self._normalize_geo(row.get("geo"))
            if not creative or geo == "UNKNOWN":
                continue
            weight = (
                max(to_float(row.get("revenue")), 0)
                + max(to_float(row.get("conversions")), 0)
                + max(to_float(row.get("clicks")), 0) / 1000
            )
            scores = geo_scores_by_creative.setdefault(creative, {})
            scores[geo] = scores.get(geo, 0) + weight

        best_geo_by_creative = {
            creative: self._best_creative_geo(scores)
            for creative, scores in geo_scores_by_creative.items()
        }
        adjusted_rows = []
        for row in rows:
            creative = normalize_text(row.get("creative"))
            if not creative:
                continue
            next_row = dict(row)
            geo = self._normalize_geo(next_row.get("geo"))
            best_geo = self._best_creative_geo(geo_scores_by_creative.get(creative))
            if geo == "UNKNOWN" or self._is_low_confidence_creative_geo(next_row, best_geo):
                geo = best_geo
            if geo == "UNKNOWN":
                continue
            next_row["geo"] = geo
            next_row["creative"] = creative
            adjusted_rows.append(next_row)

        spend_by_key = self._geo_creative_spend(date_from, date_to, best_geo_by_creative)
        rows = aggregate_rows(adjusted_rows, ["geo", "creative"], metrics)
        output = []
        for row in rows:
            geo = self._normalize_geo(row.get("geo"))
            creative = normalize_text(row.get("creative"))
            if not creative:
                continue
            next_row = self._with_creative_spend(row, spend_by_key.pop((geo, creative), None))
            if not to_float(next_row.get("total_spend")) and not to_float(next_row.get("revenue")) and not to_float(next_row.get("clicks")):
                continue
            burnout = self._creative_burnout(next_row)
            output.append({
                **next_row,
                "geo": geo,
                "creative": creative,
                **burnout,
                **self._creative_performance(next_row),
            })
        for (geo, creative), spend in spend_by_key.items():
            if not creative or geo == "UNKNOWN":
                continue
            row = self._with_creative_spend({
                "geo": geo,
                "creative": creative,
                "clicks": 0,
                "conversions": 0,
                "revenue": 0,
                "cr": 0,
                "epc": 0,
                "bot_share": 0,
            }, spend)
            burnout = self._creative_burnout(row)
            output.append({
                **row,
                "geo": geo,
                "creative": creative,
                **burnout,
                **self._creative_performance(row),
            })
        output.sort(
            key=lambda row: (
                row.get("burnout_score", 0) >= 60,
                -to_float(row.get("revenue")),
                -to_float(row.get("profit")),
                -to_float(row.get("clicks")),
            )
        )
        return output

    def _geo_creative_spend(
        self,
        date_from: str,
        date_to: str,
        best_geo_by_creative: dict[str, str],
    ) -> dict[tuple[str, str], dict[str, Any]]:
        with self.connect() as conn:
            spend_rows = self._load_rows(
                conn,
                source="spend",
                period_key="",
                date_from=date_from,
                date_to=date_to,
                report_name=None,
            )

        spend_by_key: dict[tuple[str, str], dict[str, Any]] = {}
        for row in spend_rows:
            total_spend = row_total_spend(row)
            if total_spend <= 0:
                continue
            prepared = sub5_spend_row(row)
            creative = normalize_text(prepared.get("creative")) or derive_creative(prepared)
            if not creative:
                continue
            geo = self._normalize_geo(prepared.get("geo") or derive_geo(prepared))
            if geo == "UNKNOWN":
                geo = best_geo_by_creative.get(creative, "UNKNOWN")
            if geo == "UNKNOWN":
                continue
            bucket = spend_by_key.setdefault((geo, creative), {
                "acc_spend": 0.0,
                "pwa_spend": 0.0,
                "total_spend": 0.0,
                "spend_source_rows": 0,
            })
            bucket["acc_spend"] += to_float(row.get("acc_spend"))
            bucket["pwa_spend"] += to_float(row.get("pwa_spend"))
            bucket["total_spend"] += total_spend
            bucket["spend_source_rows"] += 1
        return spend_by_key

    def _with_creative_spend(self, row: dict[str, Any], spend: dict[str, Any] | None) -> dict[str, Any]:
        next_row = dict(row)
        if spend:
            next_row["acc_spend"] = to_float(next_row.get("acc_spend")) + to_float(spend.get("acc_spend"))
            next_row["pwa_spend"] = to_float(next_row.get("pwa_spend")) + to_float(spend.get("pwa_spend"))
            next_row["total_spend"] = to_float(next_row.get("total_spend")) + to_float(spend.get("total_spend"))
            next_row["spend_source_rows"] = int(to_float(next_row.get("spend_source_rows")) + to_float(spend.get("spend_source_rows")))
            next_row["spend_source"] = "spend"

        revenue = to_float(next_row.get("revenue"))
        spend_total = to_float(next_row.get("total_spend"))
        clicks = to_float(next_row.get("clicks"))
        conversions = to_float(next_row.get("conversions")) or to_float(next_row.get("deposits"))
        profit = revenue - spend_total
        next_row["profit"] = profit
        next_row["roi"] = safe_div(profit, spend_total)
        next_row["cpa"] = safe_div(spend_total, conversions)
        next_row["cpc"] = safe_div(spend_total, clicks)
        next_row["epc"] = safe_div(revenue, clicks)
        next_row["cr"] = safe_div(conversions, clicks)
        return {
            key: round(value, 4) if isinstance(value, float) else value
            for key, value in next_row.items()
        }

    def _best_creative_geo(self, scores: dict[str, float] | None) -> str:
        if not scores:
            return "UNKNOWN"
        return max(scores.items(), key=lambda item: item[1])[0]

    def _is_low_confidence_creative_geo(self, row: dict[str, Any], best_geo: str) -> bool:
        if not best_geo or best_geo == "UNKNOWN":
            return False
        geo = self._normalize_geo(row.get("geo"))
        if geo in {"UNKNOWN", best_geo}:
            return False
        has_source_context = any(
            normalize_text(row.get(field))
            for field in ("sub_id_5", "offer", "normalized_offer", "campaign")
        )
        if has_source_context:
            return False
        return to_float(row.get("revenue")) == 0 and to_float(row.get("conversions")) == 0

    def _creative_burnout(self, row: dict[str, Any]) -> dict[str, Any]:
        bot_share = percent_points(to_float(row.get("bot_share")))
        clicks = to_float(row.get("clicks"))
        epc = to_float(row.get("epc"))
        cr = to_float(row.get("cr"))
        revenue = to_float(row.get("revenue"))
        score = 0
        reasons = []
        if clicks >= 100 and epc == 0:
            score += 35
            reasons.append("EPC ноль на объеме")
        if clicks >= 100 and cr == 0:
            score += 30
            reasons.append("CR ноль на объеме")
        if bot_share > 10:
            score += 25
            reasons.append("высокая ботность")
        if clicks >= 250 and revenue == 0:
            score += 20
            reasons.append("много кликов без revenue")
        score = min(score, 100)
        if score >= 80:
            return {"burnout_score": score, "burnout_label": "Пересобрать", "burnout_reason": ", ".join(reasons)}
        if score >= 60:
            return {"burnout_score": score, "burnout_label": "Обновить", "burnout_reason": ", ".join(reasons)}
        if score > 0:
            return {"burnout_score": score, "burnout_label": "Следить", "burnout_reason": ", ".join(reasons)}
        if revenue > 0:
            return {"burnout_score": 0, "burnout_label": "Тащит", "burnout_reason": "есть revenue без признаков выгорания"}
        return {"burnout_score": 0, "burnout_label": "Мало данных", "burnout_reason": "нет явных сигналов"}

    def _creative_performance(self, row: dict[str, Any]) -> dict[str, Any]:
        spend = to_float(row.get("total_spend"))
        revenue = to_float(row.get("revenue"))
        profit = to_float(row.get("profit")) if row.get("profit") not in (None, "") else revenue - spend
        roi = to_float(row.get("roi")) if row.get("roi") not in (None, "") else safe_div(profit, spend)

        if spend <= 0:
            if revenue > 0:
                return {
                    "performance_score": 0,
                    "performance_label": "Нет расхода",
                    "performance_reason": "есть revenue, но расход не привязан к креативу",
                }
            return {
                "performance_score": 0,
                "performance_label": "Мало данных",
                "performance_reason": "нет расхода и revenue для оценки ROI",
            }

        score = max(-100, min(100, round(roi * 100)))
        roi_percent = round(roi * 100, 1)
        if score >= 60:
            label = "Тащит"
        elif score >= 20:
            label = "Плюс"
        elif score > 0:
            label = "Слабый плюс"
        elif score == 0:
            label = "В ноль"
        elif score > -20:
            label = "Просадка"
        else:
            label = "Минус"
        return {
            "performance_score": score,
            "performance_label": label,
            "performance_reason": f"ROI {roi_percent}%, profit {round(profit, 2)}",
        }

    def _todo_geo_keys(self, todo: dict[str, Any]) -> list[str]:
        # Geo links come only from structured fields. Tokenizing the free-text
        # title turned any 2-letter word into a geo (e.g. the Russian preposition
        # "на" → "НА", or "GEO TZ:" → Tanzania), spawning bogus geos in the overview.
        keys = []
        metrics = todo.get("metrics") if isinstance(todo.get("metrics"), dict) else {}
        for value in (todo.get("entity"), metrics.get("geo")):
            self._add_todo_geo_key(keys, value, require_code=True)
        for value in todo.get("tags", []):
            self._add_todo_geo_key(keys, value, require_code=True)
        return keys or ["UNKNOWN"]

    def _add_todo_geo_key(self, keys: list[str], value: Any, *, require_code: bool = False) -> None:
        geo = self._normalize_geo(value)
        if geo == "UNKNOWN" or geo in TODO_GEO_TAG_IGNORES:
            return
        # A geo code is two ASCII letters. isalpha() alone accepts Cyrillic, so
        # guard with isascii() to reject "НА"/"ГЕО" and other non-Latin tokens.
        if require_code and not (len(geo) == 2 and geo.isascii() and geo.isalpha()):
            return
        if geo not in keys:
            keys.append(geo)

    def _geo_recommendation(
        self,
        row: dict[str, Any],
        active_todos: list[dict[str, Any]],
        manual: dict[str, Any] | None = None,
    ) -> dict[str, str]:
        geo = self._normalize_geo(row.get("geo"))
        spend = to_float(row.get("total_spend"))
        deposits = to_float(row.get("deposits"))
        profit = to_float(row.get("profit"))
        roi = to_float(row.get("roi"))
        if manual and manual.get("status") in GEO_ACTIVE_STATUSES:
            return {
                "code": "in_work",
                "label": "В работе",
                "reason": normalize_text(manual.get("action")) or "GEO отмечен вручную как активный",
            }
        if active_todos:
            return {"code": "in_work", "label": "В работе", "reason": "есть открытая задача по GEO"}
        if geo == "UNKNOWN":
            return {"code": "fix_geo", "label": "Починить GEO", "reason": "GEO не распознан в расходах"}
        if deposits >= 20 and roi >= 0.6 and profit > 0:
            return {"code": "scale", "label": "Масштабировать", "reason": "ROI и объем депозитов достаточные"}
        if spend > 0 and deposits == 0:
            return {"code": "stop_or_check", "label": "Стоп / проверка", "reason": "есть расход без депозитов"}
        if profit < 0 and roi < -0.2:
            return {"code": "cut", "label": "Сократить", "reason": "минусовой profit и ROI ниже -20%"}
        if deposits > 0 or roi >= 0.2:
            return {"code": "hold", "label": "Держать", "reason": "есть депозиты или приемлемый ROI"}
        return {"code": "watch", "label": "Наблюдать", "reason": "мало данных для уверенного действия"}

    def tracking_issues(self, period_key: str, date_from: str, date_to: str) -> list[dict[str, Any]]:
        rows = self.query({
            "source": "keitaro",
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "report_name": "tracking_quality",
            "group_by": ["offer", "campaign", "sub_id_4", "sub_id_6"],
            "metrics": ["clicks", "revenue", "cost", "bot_share"],
            "limit": 10000,
        })["rows"]
        issues = []
        for row in rows:
            flags = tracking_flags(row)
            for flag in flags:
                issues.append({
                    "issue": flag,
                    "severity": issue_severity(flag),
                    "offer": row.get("offer") or row.get("normalized_offer"),
                    "campaign": row.get("campaign"),
                    "sub_id_4": row.get("sub_id_4"),
                    "sub_id_6": row.get("sub_id_6"),
                    "clicks": row.get("clicks"),
                    "revenue": row.get("revenue"),
                    "bot_share": row.get("bot_share"),
                })
        return sorted(issues, key=lambda row: (row["severity"] != "high", -to_float(row.get("clicks"))))

    def _resolve_query_dates(self, arguments: dict[str, Any]) -> tuple[str, str, str]:
        period_key = arguments.get("period_key") or arguments.get("period")
        date_from = arguments.get("date_from")
        date_to = arguments.get("date_to")
        if date_from and date_to:
            return date_from, date_to, period_key or "custom"
        if not period_key:
            period_key = "last_7_days"
        if period_key == "full_period" and not arguments.get("full_period_start") and not arguments.get("full_period_end"):
            data_bounds = self._data_period_bounds()
            if data_bounds:
                return data_bounds[0], data_bounds[1], period_key
        date_from, date_to = period_bounds(
            period_key,
            as_of_date=arguments.get("as_of_date"),
            full_period_start=arguments.get("full_period_start", FULL_PERIOD_START),
            full_period_end=arguments.get("full_period_end", FULL_PERIOD_END),
        )
        return date_from, date_to, period_key

    def _data_period_bounds(self) -> tuple[str, str] | None:
        with self.connect() as conn:
            spend = conn.execute("SELECT MIN(date) AS min_date, MAX(date) AS max_date FROM spend_rows").fetchone()
            keitaro = conn.execute(
                """
                SELECT
                    MIN(COALESCE(NULLIF(row_date, ''), date_from)) AS min_date,
                    MAX(COALESCE(NULLIF(row_date, ''), date_to)) AS max_date
                FROM keitaro_report_rows
                """
            ).fetchone()
        starts = [
            normalize_text(row["min_date"])
            for row in (spend, keitaro)
            if row and normalize_text(row["min_date"])
        ]
        ends = [
            normalize_text(row["max_date"])
            for row in (spend, keitaro)
            if row and normalize_text(row["max_date"])
        ]
        if not starts or not ends:
            return None
        latest_allowed_end = date_str(dt.date.today() - dt.timedelta(days=1))
        return min(starts), min(max(ends), latest_allowed_end)

    def sub5_report(self, arguments: dict[str, Any]) -> dict[str, Any]:
        target_date = normalize_text(arguments.get("date") or arguments.get("date_ymd") or date_str(dt.date.today()))
        parse_date(target_date)
        start_hour = int(arguments.get("start_hour") or arguments.get("window_start_hour") or 0)
        group_by = normalize_sub5_group_by(arguments.get("group_by"))
        timezone = normalize_text(arguments.get("timezone")) or DEFAULT_TIMEZONE
        registration_days = int(arguments.get("registration_days") or DEPOSIT_REGISTRATION_DAYS)
        limit = int(arguments.get("limit") or 100)
        sub5_filter = normalize_text(arguments.get("sub5"))
        order_by = normalize_sub5_sort_field(arguments.get("order_by"), group_by)
        order = normalize_sub5_sort_order(arguments.get("order"))
        window = day_window(target_date, start_hour)
        registration_from = date_str(parse_date(target_date) - dt.timedelta(days=max(registration_days, 1) - 1))
        period_key = normalize_text(arguments.get("period_key")) or f"sub5_{target_date}"

        with self.connect() as conn:
            tracking_rows = self._load_rows(
                conn,
                source="keitaro",
                period_key=period_key,
                date_from=target_date,
                date_to=target_date,
                report_name="tracking_quality",
            )
            deposit_rows = self._load_rows(
                conn,
                source="keitaro",
                period_key=period_key,
                date_from=target_date,
                date_to=target_date,
                report_name=EXACT_DEPOSITS_REPORT,
            )
            if not tracking_rows:
                tracking_rows = self._load_latest_keitaro_rows_by_dates(
                    conn,
                    report_name="tracking_quality",
                    date_from=target_date,
                    date_to=target_date,
                )
            if not deposit_rows:
                deposit_rows = self._load_latest_keitaro_rows_by_dates(
                    conn,
                    report_name=EXACT_DEPOSITS_REPORT,
                    date_from=target_date,
                    date_to=target_date,
                )
            latest_refresh = self._latest_keitaro_snapshot(
                conn,
                report_names=["tracking_quality", EXACT_DEPOSITS_REPORT],
                date_from=target_date,
                date_to=target_date,
            )
            spend_rows = self._load_rows(
                conn,
                source="spend",
                period_key=period_key,
                date_from=target_date,
                date_to=target_date,
                report_name=None,
            )

        buckets: dict[str, dict[str, Any]] = {}
        tracking_source_rows = 0
        for row in tracking_rows:
            row_sub5 = effective_sub5(row)
            if sub5_filter and row_sub5 != sub5_filter:
                continue
            key = sub5_group_key(row, group_by)
            if not key or is_macro_value(key):
                continue
            tracking_source_rows += 1
            bucket = buckets.setdefault(key, empty_sub5_group(row, group_by, key))
            bucket["installs"] += to_float(first_value(row, "campaign_unique_clicks", "clicks"))
            bucket["regs"] += to_float(row.get("conversions"))
            bucket["keitaro_cost"] += to_float(row.get("cost"))

        deposit_source_rows = 0
        recovered_source_rows = 0
        for row in deposit_rows:
            row_sub5 = effective_sub5(row)
            if sub5_filter and row_sub5 != sub5_filter:
                continue
            key = sub5_group_key(row, group_by)
            if not key or is_macro_value(key):
                continue
            deposit_source_rows += 1
            bucket = buckets.setdefault(key, empty_sub5_group(row, group_by, key))
            deposits = to_float(row.get("deposits")) or to_float(row.get("conversions"))
            recovered = to_float(row.get("overwritten_deposits")) or to_float(row.get("recovered_deps"))
            bucket["deps"] += deposits
            bucket["normal_deps"] += max(0.0, deposits - recovered)
            bucket["recovered_deps"] += recovered
            bucket["revenue"] += to_float(row.get("revenue"))
            recovered_source_rows += int(recovered)

        spend_source_rows = add_sub5_spend_rows(
            buckets,
            spend_rows,
            group_by=group_by,
            sub5_filter=sub5_filter,
        )
        rows = [rounded_sub5_row(row) for row in buckets.values()]
        sort_sub5_rows(rows, group_by=group_by, order_by=order_by, order=order)
        totals = {
            "groups": len(rows),
            "installs": int(sum(to_float(row.get("installs")) for row in rows)),
            "regs": int(sum(to_float(row.get("regs")) for row in rows)),
            "deps": int(sum(to_float(row.get("deps")) for row in rows)),
            "recovered_deps": int(sum(to_float(row.get("recovered_deps")) for row in rows)),
            "late_deps": int(sum(to_float(row.get("late_deps")) for row in rows)),
            "revenue": round(sum(to_float(row.get("revenue")) for row in rows), 4),
            "total_spend": round(sum(to_float(row.get("total_spend")) for row in rows), 4),
        }
        totals["cr"] = round(safe_div(totals["deps"], totals["regs"]), 4)

        return {
            "date": target_date,
            "timezone": timezone,
            "source": "local_db",
            "period_key": period_key,
            "group_by": group_by,
            "sub5": sub5_filter,
            "order_by": order_by,
            "order": order,
            "latest_refresh": latest_refresh,
            "time_window": {
                "start_hour": window["start_hour"],
                "start_datetime": window["start_datetime"],
                "end_datetime": window["end_datetime"],
                "registration_from": registration_from,
            },
            "counts": {
                **totals,
                "raw_loaded_rows": len(tracking_rows) + len(deposit_rows),
                "reg_source_rows": tracking_source_rows,
                "sale_source_rows": deposit_source_rows,
                "recovered_source_rows": recovered_source_rows,
                "install_source_rows": tracking_source_rows,
                "spend_source_rows": spend_source_rows,
                "late_dep_rows": 0,
            },
            "rows": rows[:limit],
            "all_rows": rows,
            "csv": make_sub5_csv(rows, group_by),
        }

    def _load_rows(
        self,
        conn: sqlite3.Connection,
        *,
        source: str,
        date_from: str,
        date_to: str,
        period_key: str,
        report_name: str | None,
    ) -> list[dict[str, Any]]:
        if source == "spend":
            return self._load_spend_rows_for_period(conn, date_from, date_to)

        if source != "keitaro":
            raise ValueError("source must be 'spend' or 'keitaro'")

        rows = self._load_keitaro_rows_for_period(conn, period_key, date_from, date_to, report_name)
        if rows or not report_name:
            return rows

        cursor = conn.execute(
            """
            SELECT period_key
            FROM dashboard_snapshots
            WHERE date_from = ?
              AND date_to = ?
              AND source = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """,
            (date_from, date_to, f"keitaro:{report_name}"),
        )
        fallback = cursor.fetchone()
        if fallback:
            return self._load_keitaro_rows_for_period(conn, fallback["period_key"], date_from, date_to, report_name)
        rows = self._load_latest_keitaro_rows_by_dates(
            conn,
            report_name=report_name,
            date_from=date_from,
            date_to=date_to,
        )
        if rows:
            return rows
        return self._load_best_keitaro_rows_in_range(conn, report_name, date_from, date_to)

    def _load_keitaro_rows_for_period(
        self,
        conn: sqlite3.Connection,
        period_key: str,
        date_from: str,
        date_to: str,
        report_name: str | None,
    ) -> list[dict[str, Any]]:
        params: list[Any] = [period_key, date_from, date_to]
        sql = """
            SELECT * FROM keitaro_report_rows
            WHERE period_key = ? AND date_from = ? AND date_to = ?
        """
        if report_name:
            sql += " AND report_name = ?"
            params.append(report_name)
        cursor = conn.execute(sql, params)
        return [self._enrich_keitaro_row(dict(row)) for row in cursor.fetchall()]

    def _load_best_keitaro_rows_in_range(
        self,
        conn: sqlite3.Connection,
        report_name: str,
        date_from: str,
        date_to: str,
    ) -> list[dict[str, Any]]:
        cursor = conn.execute(
            """
            SELECT period_key, date_from, date_to
            FROM dashboard_snapshots
            WHERE source = ?
              AND date_from >= ?
              AND date_to <= ?
            ORDER BY
                julianday(date_to) - julianday(date_from) DESC,
                date_to DESC,
                created_at DESC,
                id DESC
            LIMIT 1
            """,
            (f"keitaro:{report_name}", date_from, date_to),
        )
        fallback = cursor.fetchone()
        if not fallback:
            return []
        return self._load_keitaro_rows_for_period(
            conn,
            fallback["period_key"],
            fallback["date_from"],
            fallback["date_to"],
            report_name,
        )

    def _load_latest_keitaro_rows_by_dates(
        self,
        conn: sqlite3.Connection,
        *,
        report_name: str,
        date_from: str,
        date_to: str,
    ) -> list[dict[str, Any]]:
        cursor = conn.execute(
            """
            SELECT DISTINCT k.row_date, k.snapshot_id, s.created_at
            FROM keitaro_report_rows k
            JOIN dashboard_snapshots s ON s.id = k.snapshot_id
            WHERE k.report_name = ?
              AND k.row_date BETWEEN ? AND ?
            ORDER BY k.row_date ASC, s.created_at DESC, k.snapshot_id DESC
            """,
            (report_name, date_from, date_to),
        )
        snapshot_by_date: dict[str, int] = {}
        for row in cursor.fetchall():
            row_date = normalize_text(row["row_date"])
            if not row_date or row_date in snapshot_by_date:
                continue
            snapshot_by_date[row_date] = int(row["snapshot_id"])

        rows = []
        for row_date, snapshot_id in snapshot_by_date.items():
            day_rows = conn.execute(
                """
                SELECT *
                FROM keitaro_report_rows
                WHERE report_name = ?
                  AND snapshot_id = ?
                  AND row_date = ?
                ORDER BY id ASC
                """,
                (report_name, snapshot_id, row_date),
            )
            rows.extend(self._enrich_keitaro_row(dict(row)) for row in day_rows.fetchall())
        return rows

    def _latest_keitaro_snapshot(
        self,
        conn: sqlite3.Connection,
        *,
        report_names: list[str],
        date_from: str,
        date_to: str,
    ) -> dict[str, Any] | None:
        sources = [f"keitaro:{name}" for name in report_names]
        placeholders = ",".join("?" for _ in sources)
        cursor = conn.execute(
            f"""
            SELECT created_at, period_key, date_from, date_to, source
            FROM dashboard_snapshots
            WHERE source IN ({placeholders})
              AND (
                (date_from = ? AND date_to = ?)
                OR (date_from <= ? AND date_to >= ?)
              )
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """,
            (*sources, date_from, date_to, date_from, date_to),
        )
        row = cursor.fetchone()
        return dict(row) if row else None

    def _enrich_keitaro_row(self, row: dict[str, Any]) -> dict[str, Any]:
        raw = {}
        try:
            parsed = json.loads(row.get("raw_json") or "{}")
            raw = parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            raw = {}
        candidate = dict(row)
        for key, value in raw.items():
            if candidate.get(key) in (None, ""):
                candidate[key] = value
            if row.get(key) in (None, ""):
                row[key] = value
        geo = derive_geo(candidate)
        if geo:
            row["geo"] = geo
        if not normalize_text(row.get("creative")):
            row["creative"] = derive_creative(candidate)
        if not normalize_text(row.get("sub_id_5")):
            row["sub_id_5"] = effective_sub5(candidate)
        return row

    def _matches_filters(self, row: dict[str, Any], filters: list[dict[str, Any]]) -> bool:
        for condition in filters:
            name = condition.get("name")
            operator = str(condition.get("operator", "EQUALS")).upper()
            expression = condition.get("expression", "")
            value = row.get(name)
            if operator == "EQUALS" and str(value) != str(expression):
                return False
            if operator == "CONTAINS" and str(expression).lower() not in str(value).lower():
                return False
            if operator == "IN_LIST":
                expected = expression if isinstance(expression, list) else str(expression).split(",")
                if str(value) not in [str(item).strip() for item in expected]:
                    return False
            if operator == "GREATER_THAN" and to_float(value) <= to_float(expression):
                return False
            if operator == "LESS_THAN" and to_float(value) >= to_float(expression):
                return False
        return True

    def _load_spend_rows_for_costs(
        self,
        conn: sqlite3.Connection,
        *,
        date_from: str,
        date_to: str,
        batch_id: str = "",
        limit: int = 10000,
    ) -> list[dict[str, Any]]:
        sql = "SELECT * FROM spend_rows WHERE date BETWEEN ? AND ?"
        params: list[Any] = [date_from, date_to]
        if batch_id:
            sql += " AND batch_id = ?"
            params.append(batch_id)
        sql += " ORDER BY date ASC, id ASC LIMIT ?"
        params.append(max(1, min(limit, 50000)))
        cursor = conn.execute(sql, params)
        return [dict(row) for row in cursor.fetchall()]

    def prepare_spend_costs(self, arguments: dict[str, Any]) -> dict[str, Any]:
        date_from, date_to, period_key = self._resolve_query_dates(arguments)
        batch_id = normalize_text(arguments.get("batch_id"))
        currency = normalize_text(arguments.get("currency") or "USD").upper()
        window_start_hour = int(arguments.get("window_start_hour") or 0)
        limit = int(arguments.get("source_limit") or 10000)
        with self.connect() as conn:
            db_rows = self._load_spend_rows_for_costs(
                conn,
                date_from=date_from,
                date_to=date_to,
                batch_id=batch_id,
                limit=limit,
            )

        cost_rows, skipped_rows = build_cost_rows_from_spend(
            db_rows,
            currency=currency,
            window_start_hour=window_start_hour,
        )
        return {
            "db_path": str(self.path),
            "period_key": period_key,
            "date_from": date_from,
            "date_to": date_to,
            "batch_id": batch_id,
            "currency": currency,
            "window_start_hour": max(0, min(23, window_start_hour)),
            "source_row_count": len(db_rows),
            "sendable_rows": len(cost_rows),
            "skipped_count": len(skipped_rows),
            "total_cost": round(sum(to_float(row.get("spend")) for row in cost_rows), 6),
            "cost_rows": cost_rows,
            "skipped_rows": skipped_rows,
        }

    def push_spend_costs(
        self,
        client: Any,
        arguments: dict[str, Any],
        progress: Any | None = None,
    ) -> dict[str, Any]:
        dry_run = parse_bool_arg(arguments.get("dry_run"), True)
        resolve = parse_bool_arg(arguments.get("resolve"), not dry_run)
        timezone = normalize_text(arguments.get("timezone")) or DEFAULT_TIMEZONE
        campaign_ids = parse_campaign_ids(arguments.get("campaign_ids"))
        campaign_group = normalize_text(arguments.get("campaign_group"))
        only_campaign_uniques = parse_bool_arg(arguments.get("only_campaign_uniques"), True)
        merge_campaign_ids = parse_bool_arg(arguments.get("merge_campaign_ids"), True)

        emit_cost_progress(progress, phase="preparing", message="Готовлю строки расходов", current=0, total=0)
        prepared = self.prepare_spend_costs(arguments)
        cost_rows = prepared.pop("cost_rows")
        skipped_rows = prepared.pop("skipped_rows")
        emit_cost_progress(
            progress,
            phase="prepared",
            message=f"Нашел {len(cost_rows)} строк для отправки",
            current=0,
            total=len(cost_rows),
            source_row_count=prepared["source_row_count"],
            sendable_rows=prepared["sendable_rows"],
            skipped_count=prepared["skipped_count"],
            total_cost=prepared["total_cost"],
        )
        if dry_run and not resolve:
            preview_rows = [
                {
                    **row,
                    "campaign_ids": [],
                    "target_campaign_group": target_campaign_group(row, campaign_group),
                    "campaign_id_source": "поиск при отправке",
                }
                for row in cost_rows
            ]
            return {
                **prepared,
                "timezone": timezone,
                "campaign_group": campaign_group,
                "campaign_ids": campaign_ids,
                "only_campaign_uniques": only_campaign_uniques,
                "dry_run": dry_run,
                "resolve": False,
                "local_preview": True,
                "resolved_count": 0,
                "unresolved_count": 0,
                "sent_rows": 0,
                "resolved_cost": 0,
                "job_count": 0,
                "jobs": [],
                "rows": preview_cost_rows(preview_rows),
                "unresolved_rows": [],
                "skipped_rows": preview_cost_rows(skipped_rows),
                "responses": [],
            }
        if client is None:
            raise ValueError("Keitaro client is required for resolving or sending costs.")
        emit_cost_progress(
            progress,
            phase="resolving",
            message="Ищу campaign_id в Keitaro",
            current=0,
            total=len(cost_rows),
            sendable_rows=len(cost_rows),
        )
        resolution = resolve_cost_campaigns(
            client,
            cost_rows,
            timezone=timezone,
            fallback_campaign_ids=campaign_ids,
            campaign_group=campaign_group,
            progress=progress,
        )
        jobs = build_cost_jobs(
            resolution["resolved_rows"],
            timezone=timezone,
            only_campaign_uniques=only_campaign_uniques,
            merge_campaign_ids=merge_campaign_ids,
        )
        if not dry_run and not jobs:
            raise ValueError(
                "Не нашел Campaign IDs для отправки costs. Укажи Campaign IDs в панели costs "
                "или в KEITARO_COST_CAMPAIGN_IDS."
            )

        responses = []
        sent_rows = 0
        resolved_rows = resolution["resolved_rows"]
        emit_cost_progress(
            progress,
            phase="resolved",
            message=f"Готово к отправке: {len(resolved_rows)} строк, bulk jobs: {len(jobs)}",
            current=len(cost_rows),
            total=len(cost_rows),
            resolved_count=len(resolved_rows),
            unresolved_count=len(resolution["unresolved_rows"]),
            job_count=len(jobs),
        )
        if not dry_run:
            total_send_rows = sum(len(job["costs"]) for job in jobs)
            for index, job in enumerate(jobs, start=1):
                emit_cost_progress(
                    progress,
                    phase="sending",
                    message=f"Отправляю bulk job {index}/{len(jobs)}",
                    current=sent_rows,
                    total=total_send_rows,
                    job_index=index,
                    job_count=len(jobs),
                    sent_rows=sent_rows,
                )
                responses.append({
                    "campaign_ids": job["campaign_ids"],
                    "data": client.update_click_costs(job),
                })
                sent_rows += len(job["costs"])
                emit_cost_progress(
                    progress,
                    phase="sending",
                    message=f"Отправлено {sent_rows}/{total_send_rows} строк",
                    current=sent_rows,
                    total=total_send_rows,
                    job_index=index,
                    job_count=len(jobs),
                    sent_rows=sent_rows,
                )

        emit_cost_progress(
            progress,
            phase="done" if not dry_run else "resolved",
            message=f"Отправлено {sent_rows} строк" if not dry_run else "Проверка готова",
            current=sent_rows if not dry_run else len(cost_rows),
            total=sum(len(job["costs"]) for job in jobs) if not dry_run else len(cost_rows),
            sent_rows=sent_rows,
            resolved_count=len(resolved_rows),
            unresolved_count=len(resolution["unresolved_rows"]),
            job_count=len(jobs),
        )
        return {
            **prepared,
            "timezone": timezone,
            "campaign_group": campaign_group,
            "campaign_ids": campaign_ids,
            "only_campaign_uniques": only_campaign_uniques,
            "merge_campaign_ids": merge_campaign_ids,
            "dry_run": dry_run,
            "resolve": True,
            "local_preview": False,
            "resolved_count": len(resolved_rows),
            "unresolved_count": len(resolution["unresolved_rows"]),
            "sent_rows": sent_rows,
            "resolved_cost": round(sum(to_float(row.get("spend")) for row in resolved_rows), 6),
            "job_count": len(jobs),
            "jobs": summarize_cost_jobs(jobs),
            "rows": preview_cost_rows(resolved_rows),
            "unresolved_rows": preview_cost_rows(resolution["unresolved_rows"]),
            "skipped_rows": preview_cost_rows(skipped_rows),
            "responses": responses,
        }


def emit_cost_progress(progress: Any, **payload: Any) -> None:
    if not callable(progress):
        return
    try:
        progress(payload)
    except Exception:
        pass


def parse_bool_arg(value: Any, default: bool = False) -> bool:
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def parse_campaign_ids(value: Any) -> list[int]:
    if value in (None, ""):
        return []
    if isinstance(value, list):
        raw_items = value
    else:
        raw_items = str(value).replace(";", ",").replace("\n", ",").split(",")
    ids = []
    for item in raw_items:
        try:
            campaign_id = int(str(item).strip())
        except ValueError:
            continue
        if campaign_id > 0 and campaign_id not in ids:
            ids.append(campaign_id)
    return ids


def normalize_api_rows(result: Any) -> list[dict[str, Any]]:
    if isinstance(result, list):
        return [row for row in result if isinstance(row, dict)]
    if not isinstance(result, dict):
        return []
    meta = result.get("meta")
    rows = result.get("rows")
    if isinstance(meta, list) and isinstance(rows, list):
        normalized = []
        for row in rows:
            if isinstance(row, dict):
                normalized.append(row)
            elif isinstance(row, list):
                normalized.append({str(key): row[index] if index < len(row) else None for index, key in enumerate(meta)})
        return normalized
    return extract_rows(result)


def parse_json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if value in (None, ""):
        return {}
    try:
        data = json.loads(str(value))
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def cost_row_sub5(db_row: dict[str, Any], raw: dict[str, Any]) -> str:
    nested_raw = raw.get("raw") if isinstance(raw.get("raw"), dict) else {}
    candidates = [
        raw.get("sub_id_5"),
        raw.get("sub5"),
        raw.get("sub_id5"),
        raw.get("facebook_campaign"),
        raw.get("campaign"),
        raw.get("campaign_name"),
        raw.get("offer_raw"),
        db_row.get("offer_raw"),
        nested_raw.get("campaign name"),
        nested_raw.get("campaign"),
    ]
    for candidate in candidates:
        value = normalize_text(candidate)
        if value and not is_macro_value(value):
            return value
    return ""


def cost_window(date_ymd: str, window_start_hour: int) -> dict[str, str]:
    hour = max(0, min(23, int(window_start_hour or 0)))
    start = dt.datetime.combine(parse_date(date_ymd), dt.time(hour=hour))
    end = start + dt.timedelta(days=1) - dt.timedelta(seconds=1)
    return {
        "start_datetime": start.strftime("%Y-%m-%d %H:%M:%S"),
        "end_datetime": end.strftime("%Y-%m-%d %H:%M:%S"),
    }


def spend_db_row_to_cost_row(
    db_row: dict[str, Any],
    *,
    row_number: int,
    currency: str,
    window_start_hour: int,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    raw = parse_json_object(db_row.get("raw_json"))
    date_ymd = normalize_text(db_row.get("date"))[:10]
    spend = to_float(db_row.get("total_spend")) or to_float(db_row.get("acc_spend")) + to_float(db_row.get("pwa_spend"))
    sub5 = cost_row_sub5(db_row, raw)
    base = {
        "row_id": db_row.get("id"),
        "row_number": row_number,
        "date_ymd": date_ymd,
        "sub5": sub5,
        "campaign_name": normalize_text(raw.get("facebook_campaign")) or normalize_text(db_row.get("offer_raw")),
        "offer_raw": normalize_text(db_row.get("offer_raw")),
        "spend": round(spend, 6),
        "currency": currency,
    }
    if not date_ymd:
        return None, {**base, "reason": "missing_date"}
    if spend <= 0:
        return None, {**base, "reason": "non_positive_spend"}
    if not sub5:
        return None, {**base, "reason": "missing_sub5"}
    try:
        window = cost_window(date_ymd, window_start_hour)
    except ValueError:
        return None, {**base, "reason": "invalid_date"}

    parsed = parse_sub5(sub5)
    return {
        **base,
        "start_date": window["start_datetime"],
        "end_date": window["end_datetime"],
        "buyer": parsed.get("buyer", ""),
        "geo": parsed.get("geo", "") or normalize_text(db_row.get("geo")),
        "account_id": parsed.get("account_id", ""),
        "creative": parsed.get("creative", ""),
    }, None


def build_cost_rows_from_spend(
    db_rows: list[dict[str, Any]],
    *,
    currency: str,
    window_start_hour: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows = []
    skipped = []
    for index, db_row in enumerate(db_rows, start=1):
        row, skip = spend_db_row_to_cost_row(
            db_row,
            row_number=index,
            currency=currency,
            window_start_hour=window_start_hour,
        )
        if row:
            rows.append(row)
        elif skip:
            skipped.append(skip)
    return rows, skipped


def normalize_group_name(value: Any) -> str:
    return " ".join(normalize_text(value).lower().split())


def normalize_lookup_key(value: Any) -> str:
    return " ".join(normalize_text(value).lower().split())


def normalize_campaign_row(row: dict[str, Any]) -> dict[str, Any]:
    group = first_value(row, "campaign_group", "group", "group_name")
    group_id = first_value(row, "campaign_group_id", "group_id")
    if isinstance(group, dict):
        group_id = group_id or first_value(group, "id")
        group = first_value(group, "name", "title", "alias")
    return {
        "campaign_id": int(to_float(first_value(row, "campaign_id", "id"))),
        "campaign": normalize_text(first_value(row, "campaign", "name", "alias")),
        "campaign_alias": normalize_text(first_value(row, "alias")),
        "campaign_group": normalize_text(group),
        "campaign_group_id": int(to_float(group_id)),
        "clicks": to_float(first_value(row, "clicks", "campaign_unique_clicks")),
    }


def is_keitaro_active_state(value: Any) -> bool:
    state = normalize_text(value).lower()
    return state not in {"disabled", "inactive", "deleted", "archive", "archived", "stopped"}


def stream_offer_id(row: dict[str, Any]) -> int:
    nested_offer = row.get("offer") if isinstance(row.get("offer"), dict) else {}
    return int(to_float(first_value(row, "offer_id", "offerId") or first_value(nested_offer, "id")))


def stream_offer_name(row: dict[str, Any], offer_names: dict[int, str]) -> str:
    nested_offer = row.get("offer") if isinstance(row.get("offer"), dict) else {}
    offer_id = stream_offer_id(row)
    return (
        normalize_text(first_value(row, "offer", "offer_name", "name"))
        if not isinstance(row.get("offer"), dict)
        else normalize_text(first_value(nested_offer, "name", "offer", "title"))
    ) or offer_names.get(offer_id, "") or (f"offer:{offer_id}" if offer_id else "")


def build_campaign_offer_split_rows(
    campaign: dict[str, Any],
    streams: list[dict[str, Any]],
    offer_names: dict[int, str],
) -> list[dict[str, Any]]:
    campaign_id = int(to_float(campaign.get("campaign_id")))
    campaign_name = normalize_text(campaign.get("campaign"))
    if not campaign_id or not campaign_name:
        return []

    stream_groups = []
    for stream in streams:
        if not is_keitaro_active_state(stream.get("state")):
            continue
        offers = stream.get("offers")
        if not isinstance(offers, list):
            continue
        active_offers = [
            offer for offer in offers
            if isinstance(offer, dict) and is_keitaro_active_state(offer.get("state"))
        ]
        if not active_offers:
            continue
        stream_groups.append({
            "stream": stream,
            "weight": to_float(first_value(stream, "weight", "share")),
            "offers": active_offers,
        })

    if not stream_groups:
        return []
    if not any(to_float(group.get("weight")) > 0 for group in stream_groups):
        for group in stream_groups:
            group["weight"] = 1.0

    weighted_rows = []
    for group in stream_groups:
        stream = group["stream"]
        stream_weight = to_float(group.get("weight"))
        if stream_weight <= 0:
            continue
        offer_weights = [to_float(first_value(offer, "share", "weight")) for offer in group["offers"]]
        if not any(weight > 0 for weight in offer_weights):
            offer_weights = [1.0 for _ in group["offers"]]
        offer_total = sum(weight for weight in offer_weights if weight > 0)
        if offer_total <= 0:
            continue

        for offer, offer_weight in zip(group["offers"], offer_weights, strict=False):
            if offer_weight <= 0:
                continue
            offer_name = stream_offer_name(offer, offer_names)
            normalized_offer = canonical_roi_offer(offer_name) or offer_name
            if not normalized_offer:
                continue
            weighted_rows.append({
                "campaign_id": campaign_id,
                "campaign": campaign_name,
                "campaign_alias": normalize_text(campaign.get("campaign_alias")),
                "stream_id": int(to_float(first_value(stream, "id", "stream_id"))),
                "stream": normalize_text(first_value(stream, "name", "stream", "title")),
                "offer_id": stream_offer_id(offer),
                "offer": offer_name,
                "normalized_offer": normalized_offer,
                "share": stream_weight * (offer_weight / offer_total),
                "state": normalize_text(stream.get("state")) or "active",
            })

    total = sum(to_float(row.get("share")) for row in weighted_rows)
    if total <= 0:
        return []
    return [{**row, "share": to_float(row.get("share")) / total} for row in weighted_rows]


def refresh_campaign_offer_splits(
    client: Any,
    store: DashboardStore,
    instance: str,
    campaign_names: list[str] | None = None,
) -> dict[str, Any]:
    campaign_filter_keys = {
        normalize_lookup_key(name)
        for name in (campaign_names or [])
        if normalize_lookup_key(name)
    }
    offer_names: dict[int, str] = {}
    if hasattr(client, "list_offers"):
        for offer in normalize_api_rows(client.list_offers()):
            offer_id = int(to_float(first_value(offer, "id", "offer_id")))
            offer_name = normalize_text(first_value(offer, "name", "offer", "title"))
            if offer_id and offer_name:
                offer_names[offer_id] = offer_name

    rows = []
    campaign_count = 0
    stream_count = 0
    for raw_campaign in normalize_api_rows(client.get_campaigns()):
        campaign = normalize_campaign_row(raw_campaign)
        campaign_id = int(to_float(campaign.get("campaign_id")))
        if not campaign_id:
            continue
        campaign_keys = {
            normalize_lookup_key(campaign.get("campaign")),
            normalize_lookup_key(campaign.get("campaign_alias")),
            normalize_lookup_key(campaign_id),
        }
        campaign_keys = {key for key in campaign_keys if key}
        if campaign_filter_keys and not (campaign_filter_keys & campaign_keys):
            continue
        campaign_count += 1
        streams = normalize_api_rows(client.list_streams(campaign_id))
        stream_count += len(streams)
        rows.extend(build_campaign_offer_split_rows(campaign, streams, offer_names))

    saved = store.replace_campaign_offer_splits(instance=instance, rows=rows)
    return {
        **saved,
        "campaigns": campaign_count,
        "streams": stream_count,
        "offers": len(offer_names),
        "campaign_filter_count": len(campaign_filter_keys),
    }


def campaign_lookup_keys(row: dict[str, Any]) -> set[str]:
    keys = {
        normalize_lookup_key(first_value(row, "sub5", "sub_id_5")),
        normalize_lookup_key(row.get("campaign_name")),
        normalize_lookup_key(row.get("offer_raw")),
    }
    return {key for key in keys if key}


def campaign_entity_lookup_keys(row: dict[str, Any]) -> set[str]:
    keys = {
        normalize_lookup_key(first_value(row, "campaign", "name")),
        normalize_lookup_key(first_value(row, "campaign_alias", "alias")),
    }
    return {key for key in keys if key}


def load_campaign_entity_rows(client: Any) -> list[dict[str, Any]]:
    return [
        campaign
        for campaign in (normalize_campaign_row(row) for row in normalize_api_rows(client.get_campaigns()))
        if campaign["campaign_id"] > 0
    ]


def index_campaign_entity_rows(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    index: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        for key in campaign_entity_lookup_keys(row):
            index.setdefault(key, []).append(row)
    return index


def build_campaign_entity_index(client: Any) -> dict[str, list[dict[str, Any]]]:
    return index_campaign_entity_rows(load_campaign_entity_rows(client))


def report_campaign_rows_by_sub5(client: Any, *, sub5: str, timezone: str, operator: str) -> list[dict[str, Any]]:
    result = client.build_report({
        "range": {
            "interval": "all_time",
            "timezone": timezone,
        },
        "dimensions": ["campaign_id", "campaign", "campaign_group_id", "campaign_group", "sub_id_5"],
        "measures": ["clicks"],
        "filters": [
            {"name": "sub_id_5", "operator": operator, "expression": sub5},
        ],
        "sort": [{"name": "clicks", "order": "DESC"}],
    })
    rows = normalize_api_rows(result)
    if operator == "EQUALS":
        rows = [row for row in rows if normalize_text(row.get("sub_id_5")) == sub5]
    return rows


def find_campaigns_by_sub5(client: Any, *, sub5: str, timezone: str) -> list[dict[str, Any]]:
    key = normalize_text(sub5)
    if not key:
        return []
    rows = []
    try:
        rows = report_campaign_rows_by_sub5(client, sub5=key, timezone=timezone, operator="EQUALS")
    except Exception as exc:  # noqa: BLE001 - Keitaro sometimes rejects EQUALS for this dimension.
        if "406" not in str(exc):
            raise
    if not rows:
        rows = [
            row for row in report_campaign_rows_by_sub5(client, sub5=key, timezone=timezone, operator="CONTAINS")
            if normalize_text(row.get("sub_id_5")) == key
        ]
    return [
        row
        for row in (normalize_campaign_row(item) for item in rows)
        if row["campaign_id"] > 0
    ]


def report_campaign_rows_by_sub5_bulk(client: Any, *, sub5_values: list[str], timezone: str) -> dict[str, list[dict[str, Any]]]:
    clean_values = []
    for value in sub5_values:
        sub5 = normalize_text(value)
        if sub5 and sub5 not in clean_values:
            clean_values.append(sub5)
    if not clean_values:
        return {}
    result = client.build_report({
        "range": {
            "interval": "all_time",
            "timezone": timezone,
        },
        "dimensions": ["campaign_id", "campaign", "campaign_group_id", "campaign_group", "sub_id_5"],
        "measures": ["clicks"],
        "filters": [
            {"name": "sub_id_5", "operator": "IN_LIST", "expression": ",".join(clean_values)},
        ],
        "sort": [{"name": "clicks", "order": "DESC"}],
    })
    wanted = set(clean_values)
    grouped: dict[str, list[dict[str, Any]]] = {sub5: [] for sub5 in clean_values}
    for row in normalize_api_rows(result):
        sub5 = normalize_text(row.get("sub_id_5"))
        if sub5 not in wanted:
            continue
        campaign = normalize_campaign_row(row)
        if campaign["campaign_id"] > 0:
            grouped.setdefault(sub5, []).append(campaign)
    return grouped


def target_campaign_group(row: dict[str, Any], campaign_group: str) -> str:
    return normalize_text(campaign_group) or normalize_text(row.get("buyer") or parse_sub5(row.get("sub5")).get("buyer"))


def select_campaign_rows(
    rows: list[dict[str, Any]],
    spend_row: dict[str, Any],
    campaign_group: str,
) -> list[dict[str, Any]]:
    target = target_campaign_group(spend_row, campaign_group)
    if not target:
        return rows
    normalized_target = normalize_group_name(target)
    selected = [row for row in rows if normalize_group_name(row.get("campaign_group")) == normalized_target]
    if selected:
        return selected
    if rows and not any(normalize_group_name(row.get("campaign_group")) for row in rows):
        return rows
    return []


def resolve_cost_campaigns(
    client: Any,
    cost_rows: list[dict[str, Any]],
    *,
    timezone: str,
    fallback_campaign_ids: list[int],
    campaign_group: str,
    progress: Any | None = None,
) -> dict[str, list[dict[str, Any]]]:
    cache: dict[str, list[dict[str, Any]]] = {}
    resolved_rows = []
    unresolved_rows = []
    total = len(cost_rows)
    if fallback_campaign_ids:
        for index, row in enumerate(cost_rows, start=1):
            resolved_rows.append({
                **row,
                "campaign_ids": fallback_campaign_ids,
                "target_campaign_group": target_campaign_group(row, campaign_group),
                "campaign_rows": [],
                "campaign_id_source": "configured_ids",
            })
            emit_cost_progress(
                progress,
                phase="resolving",
                message=f"Использую заданные Campaign IDs {index}/{total}",
                current=index,
                total=total,
                resolved_count=len(resolved_rows),
                unresolved_count=0,
            )
        return {"resolved_rows": resolved_rows, "unresolved_rows": []}

    campaign_entity_rows: list[dict[str, Any]] = []
    campaign_index: dict[str, list[dict[str, Any]]] = {}
    try:
        emit_cost_progress(
            progress,
            phase="resolving",
            message="Загружаю список кампаний Keitaro",
            current=0,
            total=total,
        )
        campaign_entity_rows = load_campaign_entity_rows(client)
        campaign_index = index_campaign_entity_rows(campaign_entity_rows)
    except Exception as exc:  # noqa: BLE001 - fall back to per-sub5 reports when /campaigns is unavailable.
        emit_cost_progress(
            progress,
            phase="resolving",
            message=f"Список кампаний недоступен, иду через reports: {exc}",
            current=0,
            total=total,
        )
    all_campaign_ids = parse_campaign_ids([row.get("campaign_id") for row in campaign_entity_rows])

    bulk_report_cache: dict[str, list[dict[str, Any]]] = {}
    bulk_report_ready = False
    if not all_campaign_ids:
        try:
            emit_cost_progress(
                progress,
                phase="resolving",
                message="Ищу campaign_id одним bulk report",
                current=0,
                total=total,
            )
            bulk_report_cache = report_campaign_rows_by_sub5_bulk(
                client,
                sub5_values=[normalize_text(row.get("sub5")) for row in cost_rows],
                timezone=timezone,
            )
            bulk_report_ready = True
        except Exception as exc:  # noqa: BLE001 - keep the accurate per-sub5 fallback.
            emit_cost_progress(
                progress,
                phase="resolving",
                message=f"Bulk report недоступен, fallback по строкам: {exc}",
                current=0,
                total=total,
            )

    for index, row in enumerate(cost_rows, start=1):
        sub5 = normalize_text(row.get("sub5"))
        if all_campaign_ids:
            resolved_rows.append({
                **row,
                "campaign_ids": all_campaign_ids,
                "target_campaign_group": target_campaign_group(row, campaign_group),
                "campaign_rows": [],
                "campaign_id_source": "all_campaign_scope",
            })
            emit_cost_progress(
                progress,
                phase="resolving",
                message=f"Использую все Campaign IDs как scope {index}/{total}",
                current=index,
                total=total,
                resolved_count=len(resolved_rows),
                unresolved_count=len(unresolved_rows),
            )
            continue
        direct_rows = []
        for key in campaign_lookup_keys(row):
            direct_rows.extend(campaign_index.get(key, []))
        if direct_rows:
            unique_direct_rows = list({item["campaign_id"]: item for item in direct_rows}.values())
            selected_direct_rows = select_campaign_rows(unique_direct_rows, row, campaign_group)
            selected_direct_ids = parse_campaign_ids([item.get("campaign_id") for item in selected_direct_rows])
            if selected_direct_ids:
                resolved_rows.append({
                    **row,
                    "campaign_ids": selected_direct_ids,
                    "target_campaign_group": target_campaign_group(row, campaign_group),
                    "campaign_rows": selected_direct_rows,
                    "campaign_id_source": "campaign_list",
                })
                emit_cost_progress(
                    progress,
                    phase="resolving",
                    message=f"Сматчил из списка кампаний {index}/{total}",
                    current=index,
                    total=total,
                    resolved_count=len(resolved_rows),
                    unresolved_count=len(unresolved_rows),
                )
                continue

        if bulk_report_ready:
            candidate_rows = bulk_report_cache.get(sub5, [])
        else:
            candidate_rows = cache.get(sub5, [])
        if sub5 not in cache:
            if bulk_report_ready:
                cache[sub5] = candidate_rows
            else:
                emit_cost_progress(
                    progress,
                    phase="resolving",
                    message=f"Ищу campaign_id {index}/{total}",
                    current=index - 1,
                    total=total,
                    sub5=sub5,
                    resolved_count=len(resolved_rows),
                    unresolved_count=len(unresolved_rows),
                )
                cache[sub5] = find_campaigns_by_sub5(client, sub5=sub5, timezone=timezone)
                candidate_rows = cache[sub5]
        selected_rows = select_campaign_rows(candidate_rows, row, campaign_group)
        selected_ids = parse_campaign_ids([item.get("campaign_id") for item in selected_rows])
        campaign_ids = selected_ids or ([] if candidate_rows else fallback_campaign_ids)
        campaign_id_source = "fallback" if not selected_ids else "campaign_group"
        if not campaign_ids and all_campaign_ids:
            campaign_ids = all_campaign_ids
            campaign_id_source = "all_campaign_scope"
        target_group = target_campaign_group(row, campaign_group)
        if campaign_ids:
            resolved_rows.append({
                **row,
                "campaign_ids": campaign_ids,
                "target_campaign_group": target_group,
                "campaign_rows": selected_rows,
                "campaign_id_source": campaign_id_source,
            })
            emit_cost_progress(
                progress,
                phase="resolving",
                message=f"Найдено {len(resolved_rows)}/{total}",
                current=index,
                total=total,
                resolved_count=len(resolved_rows),
                unresolved_count=len(unresolved_rows),
            )
            continue
        unresolved_rows.append({
            **row,
            "target_campaign_group": target_group,
            "candidate_campaigns": candidate_rows[:8],
        })
        emit_cost_progress(
            progress,
            phase="resolving",
            message=f"Найдено {len(resolved_rows)}/{total}",
            current=index,
            total=total,
            resolved_count=len(resolved_rows),
            unresolved_count=len(unresolved_rows),
        )
    return {"resolved_rows": resolved_rows, "unresolved_rows": unresolved_rows}


def build_cost_jobs(
    resolved_rows: list[dict[str, Any]],
    *,
    timezone: str,
    only_campaign_uniques: bool,
    merge_campaign_ids: bool = True,
) -> list[dict[str, Any]]:
    grouped: dict[Any, dict[str, Any]] = {}
    for row in resolved_rows:
        campaign_ids = tuple(parse_campaign_ids(row.get("campaign_ids")))
        if not campaign_ids:
            continue
        currency = normalize_text(row.get("currency") or "USD").upper()
        key = currency if merge_campaign_ids else (campaign_ids, currency)
        current = grouped.setdefault(key, {
            "campaign_ids": [],
            "currency": currency,
            "timezone": timezone,
            "costs": [],
        })
        for campaign_id in campaign_ids:
            if campaign_id not in current["campaign_ids"]:
                current["campaign_ids"].append(campaign_id)
        current["costs"].append({
            "start_date": row["start_date"],
            "end_date": row["end_date"],
            "cost": round(to_float(row.get("spend")), 6),
            "timezone": timezone,
            "currency": currency,
            "only_campaign_uniques": 1 if only_campaign_uniques else 0,
            "filters": {
                "sub_id_5": row["sub5"],
            },
        })
    return list(grouped.values())


def preview_cost_rows(rows: list[dict[str, Any]], limit: int = 40) -> list[dict[str, Any]]:
    preview = []
    for row in rows[:limit]:
        item = dict(row)
        if "campaign_rows" in item:
            item["campaign_rows"] = item["campaign_rows"][:5]
        if "candidate_campaigns" in item:
            item["candidate_campaigns"] = item["candidate_campaigns"][:5]
        preview.append(item)
    return preview


def summarize_cost_jobs(jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "campaign_ids": job["campaign_ids"],
            "currency": job["currency"],
            "cost_rows": len(job["costs"]),
            "total_cost": round(sum(to_float(row.get("cost")) for row in job["costs"]), 6),
        }
        for job in jobs
    ]


def aggregate_rows(rows: list[dict[str, Any]], group_by: list[str], metrics: list[str]) -> list[dict[str, Any]]:
    grouped: dict[tuple[Any, ...], dict[str, Any]] = {}
    for row in rows:
        key = tuple(row.get(column) for column in group_by)
        bucket = grouped.setdefault(key, {column: row.get(column) for column in group_by})
        for metric in SUM_METRICS:
            bucket[metric] = to_float(bucket.get(metric)) + to_float(row.get(metric))
        bucket["_bot_share_weighted"] = to_float(bucket.get("_bot_share_weighted")) + (
            to_float(row.get("bot_share")) * max(to_float(row.get("clicks")), 1)
        )
        bucket["_bot_share_weight"] = to_float(bucket.get("_bot_share_weight")) + max(to_float(row.get("clicks")), 1)
        if group_by:
            for column in DIMENSION_COLUMNS:
                if column not in bucket and row.get(column) not in (None, ""):
                    bucket[column] = row.get(column)

    result = []
    for bucket in grouped.values():
        spend = to_float(bucket.get("total_spend"))
        revenue = to_float(bucket.get("revenue"))
        profit = revenue - spend
        bucket["profit"] = profit
        clicks = to_float(bucket.get("clicks"))
        conversions = to_float(bucket.get("conversions")) or to_float(bucket.get("deposits"))
        deposits = to_float(bucket.get("deposits"))
        if not deposits and conversions and "deposits" in metrics:
            deposits = conversions
            bucket["deposits"] = conversions
        bucket["roi"] = safe_div(profit, spend)
        bucket["cpa"] = safe_div(spend, deposits or conversions)
        bucket["rpd"] = safe_div(revenue, deposits or conversions)
        bucket["epc"] = safe_div(revenue, clicks)
        bucket["cr"] = safe_div(conversions, clicks)
        bucket["cpc"] = safe_div(spend, clicks)
        bucket["bot_share"] = safe_div(to_float(bucket.get("_bot_share_weighted")), to_float(bucket.get("_bot_share_weight")))
        bucket.pop("_bot_share_weighted", None)
        bucket.pop("_bot_share_weight", None)
        allowed = set(group_by) | set(metrics) | DIMENSION_COLUMNS
        result.append({k: round(v, 4) if isinstance(v, float) else v for k, v in bucket.items() if k in allowed})

    if not result and not group_by:
        empty = {metric: 0 for metric in metrics}
        result.append(empty)
    return result


def combine_offer_rows(
    spend_rows: list[dict[str, Any]],
    keitaro_rows: list[dict[str, Any]],
    exact_deposit_rows: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    by_offer: dict[str, dict[str, Any]] = {}
    use_exact_deposit_revenue = bool(exact_deposit_rows)
    for row in spend_rows:
        if is_ignored_offer_row(row):
            continue
        key = normalize_text(row.get("normalized_offer") or row.get("offer") or row.get("offer_raw"))
        bucket = by_offer.setdefault(key, {"normalized_offer": key})
        bucket.update(row)
        if to_float(row.get("total_spend")):
            bucket["spend_source"] = row.get("spend_source") or "spend"
    for row in keitaro_rows:
        if is_ignored_offer_row(row):
            continue
        key = normalize_text(row.get("normalized_offer") or row.get("offer"))
        bucket = by_offer.setdefault(key, {"normalized_offer": key})
        for metric in ("clicks", "conversions", "cost", "cr", "cpc", "epc", "bot_share"):
            bucket[f"keitaro_{metric}"] = row.get(metric)
            if metric == "cost":
                continue
            if metric not in bucket:
                bucket[metric] = row.get(metric)
        if not use_exact_deposit_revenue and ("revenue" not in bucket or not bucket.get("revenue")):
            bucket["revenue"] = row.get("revenue")
    for row in exact_deposit_rows or []:
        if is_ignored_offer_row(row):
            continue
        key = normalize_text(row.get("normalized_offer") or row.get("offer"))
        bucket = by_offer.setdefault(key, {"normalized_offer": key})
        exact_deposits = to_float(row.get("deposits")) or to_float(row.get("conversions"))
        exact_revenue = to_float(row.get("revenue"))
        bucket["conversions"] = exact_deposits
        bucket["deposits"] = exact_deposits
        bucket["exact_deposit_revenue"] = exact_revenue
        bucket["revenue"] = exact_revenue
        spend = to_float(bucket.get("total_spend"))
        bucket["profit"] = exact_revenue - spend
        bucket["roi"] = safe_div(bucket["profit"], spend)
    for bucket in by_offer.values():
        spend = to_float(bucket.get("total_spend"))
        revenue = to_float(bucket.get("revenue"))
        bucket["profit"] = revenue - spend
        bucket["roi"] = safe_div(bucket["profit"], spend)
    return list(by_offer.values())


def row_total_spend(row: dict[str, Any]) -> float:
    return to_float(row.get("total_spend")) or to_float(row.get("acc_spend")) + to_float(row.get("pwa_spend"))


def row_payout(row: dict[str, Any]) -> float:
    deposits = to_float(row.get("deposits")) or to_float(row.get("deps")) or to_float(row.get("conversions"))
    return to_float(row.get("payout")) or safe_div(to_float(row.get("revenue")), deposits)


def payout_hint_keys(row: dict[str, Any]) -> list[str]:
    sub5 = effective_sub5(row)
    if not sub5 and looks_like_sub5(row.get("normalized_offer")):
        sub5 = normalize_text(row.get("normalized_offer"))
    parsed = parse_sub5(sub5) if looks_like_sub5(sub5) else {}
    offer = canonical_roi_offer(row.get("normalized_offer") or row.get("offer"))
    geo = clean_geo_code(parsed.get("geo")) or clean_geo_code(row.get("geo")) or clean_geo_code(derive_geo(row))
    buyer = parsed.get("buyer") or normalize_text(row.get("buyer"))
    account_id = normalize_account_id(row.get("account_id")) or normalize_account_id(parsed.get("account_id"))
    creative = parsed.get("creative") or normalize_text(first_value(row, "creative", "sub_id_6"))
    funnel = parsed.get("funnel") or normalize_text(row.get("funnel"))

    keys = []

    def add(key: str, *parts: Any) -> None:
        values = [normalize_text(part) for part in parts]
        if all(values):
            full_key = key + ":" + "|".join(values)
            if full_key not in keys:
                keys.append(full_key)

    add("sub5", sub5)
    add("geo_offer", geo, offer)
    add("offer", offer)
    add("geo_account_creative", geo, account_id, creative)
    add("geo_buyer_creative", geo, buyer, creative)
    add("geo_creative", geo, creative)
    add("geo_buyer_funnel", geo, buyer, funnel)
    add("geo_funnel", geo, funnel)
    add("geo", geo)
    return keys


def build_payout_hints(rows: list[dict[str, Any]]) -> dict[str, float]:
    buckets: dict[str, dict[str, float]] = {}
    for row in rows:
        payout = row_payout(row)
        if payout <= 0:
            continue
        weight = to_float(row.get("deposits")) or to_float(row.get("deps")) or to_float(row.get("conversions")) or 1.0
        for key in payout_hint_keys(row):
            bucket = buckets.setdefault(key, {"weighted_payout": 0.0, "weight": 0.0})
            bucket["weighted_payout"] += payout * weight
            bucket["weight"] += weight
    return {
        key: safe_div(bucket["weighted_payout"], bucket["weight"])
        for key, bucket in buckets.items()
        if bucket["weight"] > 0
    }


def payout_hint_for_row(row: dict[str, Any], hints: dict[str, float]) -> float:
    for key in payout_hint_keys(row):
        payout = to_float(hints.get(key))
        if payout > 0:
            return payout
    return 0.0


def add_unmapped_sub5_spend_to_kpis(kpis: dict[str, Any], unmapped_rows: list[dict[str, Any]]) -> dict[str, Any]:
    extra_total_spend = sum(row_total_spend(row) for row in unmapped_rows)
    kpis = dict(kpis)
    kpis["unmapped_sub5_spend"] = round(extra_total_spend, 4)
    if extra_total_spend <= 0:
        return kpis

    if "acc_spend" in kpis:
        kpis["acc_spend"] = round(
            to_float(kpis.get("acc_spend")) + sum(to_float(row.get("acc_spend")) for row in unmapped_rows),
            4,
        )
    if "pwa_spend" in kpis:
        kpis["pwa_spend"] = round(
            to_float(kpis.get("pwa_spend")) + sum(to_float(row.get("pwa_spend")) for row in unmapped_rows),
            4,
        )

    total_spend = to_float(kpis.get("total_spend")) + extra_total_spend
    revenue = to_float(kpis.get("revenue"))
    deposits = to_float(kpis.get("deposits")) or to_float(kpis.get("conversions"))
    profit = revenue - total_spend
    kpis["total_spend"] = round(total_spend, 4)
    kpis["profit"] = round(profit, 4)
    kpis["roi"] = round(safe_div(profit, total_spend), 4)
    kpis["cpa"] = round(safe_div(total_spend, deposits), 4)
    kpis["rpd"] = round(safe_div(revenue, deposits), 4)
    return kpis


def target_cpa_from_payout(payout: float, target_roi: float) -> float:
    target_roi = target_roi if target_roi > 0 else DEFAULT_TARGET_ROI
    return safe_div(payout, 1 + target_roi)


def event_count(row: dict[str, Any], event: str, deposits: float) -> float:
    if event == "click":
        return to_float(row.get("clicks"))
    if event == "install":
        return to_float(row.get("installs"))
    if event == "reg":
        return to_float(row.get("regs"))
    if event == "dep":
        return deposits
    return 0.0


def event_price_signals(
    row: dict[str, Any],
    *,
    spend: float,
    payout: float,
    target_roi: float,
    deposits: float,
) -> dict[str, Any]:
    target_roi = target_roi if target_roi > 0 else DEFAULT_TARGET_ROI
    target_cpa = target_cpa_from_payout(payout, target_roi)
    events = {}
    for event, ratio in TARGET_CPA_EVENT_RATIOS.items():
        count = event_count(row, event, deposits)
        price = safe_div(spend, count)
        limit = target_cpa * ratio if target_cpa else 0.0
        if not target_cpa:
            status = "no_target_cpa"
        elif count <= 0:
            status = "missing"
        elif price <= limit:
            status = "ok"
        else:
            status = "expensive"
        events[event] = {
            "count": round(count, 4),
            "price": round(price, 4),
            "limit": round(limit, 4),
            "ratio": ratio,
            "status": status,
        }
    return {
        "target_roi": round(target_roi, 4),
        "target_cpa": round(target_cpa, 4),
        "events": events,
        "fb_targets": {
            "max_cpc": round(events["click"]["limit"], 4),
            "max_cpi": round(events["install"]["limit"], 4),
            "max_cpr": round(events["reg"]["limit"], 4),
            "max_cpd": round(events["dep"]["limit"], 4),
        },
    }


def has_ok_event_price(pricing: dict[str, Any], events: tuple[str, ...] = ("install", "reg", "dep")) -> bool:
    signals = pricing.get("events") or {}
    return any((signals.get(event) or {}).get("status") == "ok" for event in events)


def has_all_expensive_known_prices(
    pricing: dict[str, Any],
    events: tuple[str, ...] = ("install", "reg", "dep"),
) -> bool:
    signals = pricing.get("events") or {}
    known = [
        signals.get(event) or {}
        for event in events
        if to_float((signals.get(event) or {}).get("count")) > 0
    ]
    return bool(known) and all(signal.get("status") == "expensive" for signal in known)


def event_status(pricing: dict[str, Any], event: str) -> str:
    return ((pricing.get("events") or {}).get(event) or {}).get("status") or ""


def event_price_metric(pricing: dict[str, Any], event: str, key: str) -> float:
    return to_float(((pricing.get("events") or {}).get(event) or {}).get(key))


def decision_for_offer(row: dict[str, Any], *, target_roi: float = DEFAULT_TARGET_ROI) -> dict[str, Any]:
    offer = normalize_text(row.get("normalized_offer") or row.get("offer"))
    entity_type = "sub5" if looks_like_sub5(offer) else "offer"
    spend = to_float(row.get("total_spend"))
    revenue = to_float(row.get("revenue"))
    profit = to_float(row.get("profit")) if row.get("profit") not in (None, "") else revenue - spend
    deposits = to_float(row.get("deposits")) or to_float(row.get("deps")) or to_float(row.get("conversions"))
    roi = to_float(row.get("roi")) if row.get("roi") not in (None, "") else safe_div(profit, spend)
    payout = to_float(row.get("payout")) or safe_div(revenue, deposits)
    bot_share = percent_points(to_float(row.get("bot_share")))
    clicks = to_float(row.get("clicks"))
    pricing = event_price_signals(row, spend=spend, payout=payout, target_roi=target_roi, deposits=deposits)
    good_funnel_price = has_ok_event_price(pricing)
    expensive_funnel_prices = has_all_expensive_known_prices(pricing)
    dep_price_expensive = event_status(pricing, "dep") == "expensive"

    decision = "test"
    budget_action = "collect more data"
    reason = "not enough volume for a confident action"

    if is_empty_offer(offer):
        decision, budget_action, reason = "kill", "pause", "tracking issue: offer is empty"
    elif deposits == 0 and payout and spend >= payout * 2:
        decision, budget_action, reason = "kill", "pause", "spent at least 2 payouts with zero deposits"
    elif expensive_funnel_prices and roi < 0.2:
        decision, budget_action, reason = "kill", "pause or reduce", "event prices are above target CPA guardrails"
    elif roi < -0.2 and spend > 0 and not good_funnel_price:
        decision, budget_action, reason = "kill", "pause or reduce", "ROI below -20% on tracked spend"
    elif roi >= 0.8 and deposits >= 20 and bot_share <= 7 and not dep_price_expensive:
        decision, budget_action, reason = "scale", "+20-30%", "ROI >= 80%, enough deposits, bot share acceptable"
    elif good_funnel_price and (deposits == 0 or roi < 0.2):
        decision, budget_action, reason = "hold", "keep test budget", "event prices are within target CPA guardrails"
    elif deposits > 0 and dep_price_expensive:
        decision, budget_action, reason = "hold", "keep current budget, do not scale", "has deposits but deposit price is above target CPA guardrail"
    elif roi >= 0.2 or deposits > 0:
        decision, budget_action, reason = "hold", "keep current budget", "has deposits or ROI is between 20% and 80%"
    elif clicks > 0 and revenue == 0:
        decision, budget_action, reason = "kill", "pause", "clicks exist but revenue is zero"

    return {
        "entity_type": entity_type,
        "entity_name": offer or "(пустой оффер)",
        "decision": decision,
        "budget_action": budget_action,
        "reason": reason,
        "metrics": {
            "revenue": round(revenue, 4),
            "spend": round(spend, 4),
            "profit": round(profit, 4),
            "roi": round(roi, 4),
            "deposits": round(deposits, 4),
            "payout": round(payout, 4),
            "bot_share": round(bot_share, 4),
            "clicks": round(clicks, 4),
            "installs": event_price_metric(pricing, "install", "count"),
            "regs": event_price_metric(pricing, "reg", "count"),
            "target_roi": pricing["target_roi"],
            "target_cpa": pricing["target_cpa"],
            "cpc": event_price_metric(pricing, "click", "price"),
            "cpi": event_price_metric(pricing, "install", "price"),
            "cpr": event_price_metric(pricing, "reg", "price"),
            "cpd": event_price_metric(pricing, "dep", "price"),
            "event_caps": pricing["fb_targets"],
            "event_signals": pricing["events"],
        },
    }


def creative_refresh_candidates(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates = []
    for row in rows:
        bot_share = percent_points(to_float(row.get("bot_share")))
        clicks = to_float(row.get("clicks"))
        epc = to_float(row.get("epc"))
        cr = to_float(row.get("cr"))
        action = "watch"
        score = 0
        reasons = []
        if clicks >= 100 and epc == 0:
            score += 35
            reasons.append("zero EPC on volume")
        if clicks >= 100 and cr == 0:
            score += 30
            reasons.append("zero CR on volume")
        if bot_share > 10:
            score += 25
            reasons.append("high bot share")
        if score >= 60:
            action = "refresh"
        if score >= 80:
            action = "kill/remake"
        if score:
            candidates.append({
                "creative": row.get("creative"),
                "normalized_offer": row.get("normalized_offer"),
                "clicks": row.get("clicks"),
                "revenue": row.get("revenue"),
                "epc": row.get("epc"),
                "cr": row.get("cr"),
                "bot_share": row.get("bot_share"),
                "burnout_score": min(score, 100),
                "action": action,
                "reason": ", ".join(reasons),
            })
    return sorted(candidates, key=lambda row: row["burnout_score"], reverse=True)


def tracking_flags(row: dict[str, Any]) -> list[str]:
    flags = []
    offer = normalize_text(row.get("offer") or row.get("normalized_offer"))
    sub_id_4 = normalize_text(row.get("sub_id_4"))
    sub_id_6 = normalize_text(row.get("sub_id_6") or row.get("creative"))
    clicks = to_float(row.get("clicks"))
    revenue = to_float(row.get("revenue"))
    cost = to_float(row.get("cost"))
    bot_share = percent_points(to_float(row.get("bot_share")))

    if is_empty_offer(offer):
        flags.append("offer_null")
    if "{sub" in sub_id_4.lower() or "{{" in sub_id_4 or "{sub" in sub_id_6.lower() or "{{" in sub_id_6:
        flags.append("placeholder_subid")
    if clicks > 0 and revenue == 0:
        flags.append("no_revenue_clicks")
    if bot_share > 10:
        flags.append("high_bot")
    if cost == 0 and clicks > 0:
        flags.append("cost_missing")
    return flags


def is_empty_offer(value: str) -> bool:
    return not value or value.lower() in {"null", "none", "(none)", "unknown", "-"}


def is_ignored_offer(value: Any) -> bool:
    text = normalize_text(value).lower()
    return any(marker in text for marker in IGNORED_OFFER_MARKERS)


def is_ignored_offer_row(row: dict[str, Any]) -> bool:
    return any(
        is_ignored_offer(row.get(column))
        for column in ("normalized_offer", "offer", "offer_raw", "campaign")
    )


def issue_severity(flag: str) -> str:
    if flag in {"offer_null", "cost_missing"}:
        return "high"
    if flag in {"placeholder_subid", "high_bot", "no_revenue_clicks"}:
        return "medium"
    return "low"


def fetch_exact_deposit_rows(
    client: Any,
    *,
    date_from: str,
    date_to: str,
    timezone: str,
    registration_days: int = DEPOSIT_REGISTRATION_DAYS,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Count deposits from raw /conversions/log records.

    Keitaro report/build can miss deposits in today's slice when a conversion was
    registered earlier or later overwritten from sale to another status. This
    mirrors scripts/count-keitaro-deposits.ps1: count positive-revenue rows by
    sale_datetime, plus overwritten rows where previous_status was sale and the
    postback happened inside the requested period.
    """
    start = parse_date(date_from) - dt.timedelta(days=max(registration_days, 1) - 1)
    registration_from = date_str(start)
    all_rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = client.get_conversions({
            "range": {
                "from": registration_from,
                "to": date_to,
                "timezone": timezone,
            },
            "limit": DEPOSIT_PAGE_SIZE,
            "offset": offset,
            "columns": [
                "conversion_id",
                "campaign_id",
                "campaign",
                "offer",
                "status",
                "previous_status",
                "original_status",
                "revenue",
                "postback_datetime",
                "sale_datetime",
                "sub_id",
                "sub_id_5",
                "sub_id_6",
            ],
        })
        rows = extract_rows(page)
        all_rows.extend(rows)
        if len(rows) < DEPOSIT_PAGE_SIZE:
            break
        offset += DEPOSIT_PAGE_SIZE

    normal = [
        row for row in all_rows
        if is_normal_deposit_in_period(row, date_from, date_to)
    ]
    normal_ids = {normalize_text(row.get("conversion_id")) for row in normal if normalize_text(row.get("conversion_id"))}
    overwritten = [
        row for row in all_rows
        if is_overwritten_deposit_in_period(row, date_from, date_to)
        and normalize_text(row.get("conversion_id")) not in normal_ids
    ]
    deposit_rows = normal + overwritten
    grouped = group_deposit_rows(deposit_rows, normal, overwritten)
    stats = {
        "registration_from": registration_from,
        "fetched_conversions": len(all_rows),
        "normal_deposits": len(normal),
        "overwritten_deposits": len(overwritten),
        "total_deposits": len(deposit_rows),
        "total_revenue": round(sum(to_float(row.get("revenue")) for row in deposit_rows), 4),
    }
    return grouped, stats


def group_deposit_rows(
    deposit_rows: list[dict[str, Any]],
    normal_rows: list[dict[str, Any]],
    overwritten_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    normal_ids = {normalize_text(row.get("conversion_id")) for row in normal_rows}
    overwritten_ids = {normalize_text(row.get("conversion_id")) for row in overwritten_rows}
    buckets: dict[str, dict[str, Any]] = {}
    for row in deposit_rows:
        offer = normalize_text(row.get("offer")) or normalize_text(row.get("campaign")) or "(unknown)"
        sub5 = effective_sub5(row)
        parsed = parse_sub5(sub5)
        geo = derive_geo(row)
        creative = derive_creative(row)
        row_date = date_part(first_value(row, "sale_datetime", "postback_datetime", "datetime", "date"))
        bucket_key = "|".join([offer, sub5 or geo or "unknown", row_date])
        bucket = buckets.setdefault(bucket_key, {
            "offer": offer,
            "normalized_offer": offer,
            "campaign": normalize_text(first_value(row, "campaign", "campaign_name")),
            "sub_id_5": sub5,
            "geo": geo,
            "creative": creative,
            "row_date": row_date,
            "launch_date": parsed.get("launch_date", ""),
            "buyer": parsed.get("buyer", ""),
            "account_id": parsed.get("account_id", ""),
            "conversions": 0,
            "deposits": 0,
            "revenue": 0.0,
            "cost": 0.0,
            "profit": 0.0,
            "normal_deposits": 0,
            "overwritten_deposits": 0,
            "source": "conversions_log",
        })
        conversion_id = normalize_text(row.get("conversion_id"))
        revenue = to_float(row.get("revenue"))
        bucket["conversions"] += 1
        bucket["deposits"] += 1
        bucket["revenue"] += revenue
        bucket["profit"] += revenue
        if conversion_id in overwritten_ids:
            bucket["overwritten_deposits"] += 1
        elif conversion_id in normal_ids:
            bucket["normal_deposits"] += 1
    return [
        {key: round(value, 4) if isinstance(value, float) else value for key, value in bucket.items()}
        for bucket in buckets.values()
    ]


def normalize_sub5_group_by(value: Any) -> str:
    requested = normalize_text(value or "sub5").lower()
    return requested if requested in {"sub5", "offer", "account"} else "sub5"


def sub5_group_field(group_by: str) -> str:
    if group_by == "offer":
        return "offer"
    if group_by == "account":
        return "account_id"
    return "sub5"


def sub5_group_key(row: dict[str, Any], group_by: str) -> str:
    if group_by == "offer":
        return normalize_text(first_value(row, "offer", "offer_name")) or "(unknown)"
    sub5 = effective_sub5(row)
    if group_by == "account":
        return sub5_account_id(row) or "unknown"
    return sub5


def empty_sub5_group(row: dict[str, Any], group_by: str, key: str) -> dict[str, Any]:
    sub5 = effective_sub5(row)
    parsed = parse_sub5(sub5)
    bucket = {
        "sub5": sub5,
        "offer": normalize_text(first_value(row, "offer", "offer_name")),
        "geo": parsed["geo"] or normalize_text(row.get("geo")),
        "buyer": parsed["buyer"] or normalize_text(row.get("buyer")),
        "account_id": sub5_account_id(row),
        "creative": parsed["creative"] or normalize_text(first_value(row, "creative", "sub_id_6")),
        "installs": 0.0,
        "regs": 0.0,
        "deps": 0.0,
        "normal_deps": 0.0,
        "recovered_deps": 0.0,
        "late_deps": 0.0,
        "revenue": 0.0,
        "acc_spend": 0.0,
        "pwa_spend": 0.0,
        "total_spend": 0.0,
        "keitaro_cost": 0.0,
    }
    bucket[sub5_group_field(group_by)] = key
    return bucket


def rounded_sub5_row(row: dict[str, Any]) -> dict[str, Any]:
    next_row = dict(row)
    for key in ("installs", "regs", "deps", "normal_deps", "recovered_deps", "late_deps"):
        next_row[key] = int(next_row.get(key) or 0)
    next_row["revenue"] = round(to_float(next_row.get("revenue")), 4)
    if not to_float(next_row.get("total_spend")) and to_float(next_row.get("keitaro_cost")):
        next_row["total_spend"] = to_float(next_row.get("keitaro_cost"))
        next_row["spend_source"] = "keitaro_cost"
    next_row["acc_spend"] = round(to_float(next_row.get("acc_spend")), 4)
    next_row["pwa_spend"] = round(to_float(next_row.get("pwa_spend")), 4)
    next_row["total_spend"] = round(to_float(next_row.get("total_spend")), 4)
    next_row["keitaro_cost"] = round(to_float(next_row.get("keitaro_cost")), 4)
    next_row["cr"] = round(safe_div(to_float(next_row.get("deps")), to_float(next_row.get("regs"))), 4)
    next_row["cpi"] = round(safe_div(to_float(next_row.get("total_spend")), to_float(next_row.get("installs"))), 4)
    next_row["cpr"] = round(safe_div(to_float(next_row.get("total_spend")), to_float(next_row.get("regs"))), 4)
    next_row["cpd"] = round(safe_div(to_float(next_row.get("total_spend")), to_float(next_row.get("deps"))), 4)
    return next_row


SUB5_NUMERIC_SORT_FIELDS = {
    "installs",
    "regs",
    "deps",
    "normal_deps",
    "recovered_deps",
    "late_deps",
    "revenue",
    "total_spend",
    "cr",
    "cpi",
    "cpr",
    "cpd",
}
SUB5_TEXT_SORT_FIELDS = {"sub5", "offer", "geo", "buyer", "account_id", "creative"}
SUB5_SORT_FIELDS = SUB5_NUMERIC_SORT_FIELDS | SUB5_TEXT_SORT_FIELDS


def normalize_sub5_sort_field(value: Any, group_by: str) -> str:
    requested = normalize_text(value or "deps").lower()
    if requested == "group":
        return sub5_group_field(group_by)
    return requested if requested in SUB5_SORT_FIELDS else "deps"


def normalize_sub5_sort_order(value: Any) -> str:
    requested = normalize_text(value or "desc").lower()
    return "asc" if requested == "asc" else "desc"


def sort_sub5_rows(rows: list[dict[str, Any]], *, group_by: str, order_by: str, order: str) -> None:
    group_field = sub5_group_field(group_by)
    reverse = order == "desc"
    rows.sort(key=lambda row: normalize_text(row.get(group_field)).lower())
    if order_by == "deps":
        rows.sort(key=lambda row: (to_float(row.get("deps")), to_float(row.get("regs"))), reverse=reverse)
    elif order_by in SUB5_NUMERIC_SORT_FIELDS:
        rows.sort(key=lambda row: to_float(row.get(order_by)), reverse=reverse)
    else:
        rows.sort(key=lambda row: normalize_text(row.get(order_by)).lower(), reverse=reverse)


def csv_escape(value: Any, separator: str = ";") -> str:
    text = str(value if value is not None else "")
    if separator in text or "|" in text or '"' in text or "\n" in text or "\r" in text:
        return '"' + text.replace('"', '""') + '"'
    return text


def make_sub5_csv(rows: list[dict[str, Any]], group_by: str) -> str:
    field = sub5_group_field(group_by)
    header = [
        field,
        "sub5",
        "offer",
        "geo",
        "buyer",
        "account_id",
        "creative",
        "installs",
        "regs",
        "deps",
        "recovered_deps",
        "late_deps",
        "revenue",
        "total_spend",
        "cr",
        "cpi",
        "cpr",
        "cpd",
    ]
    body = [
        [row.get(column, "") for column in header]
        for row in rows
    ]
    return "\r\n".join(";".join(csv_escape(value) for value in line) for line in [header, *body])


def fetch_raw_conversion_rows(
    client: Any,
    *,
    date_from: str,
    date_to: str,
    timezone: str,
    page_size: int = CONVERSION_LOG_PAGE_SIZE,
) -> list[dict[str, Any]]:
    all_rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = client.get_conversions({
            "range": {
                "from": date_from,
                "to": date_to,
                "timezone": timezone,
            },
            "limit": page_size,
            "offset": offset,
            "columns": SUB5_CONVERSION_COLUMNS,
        })
        rows = extract_rows(page)
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return all_rows


def fetch_sub5_install_rows(
    client: Any,
    *,
    window: dict[str, Any],
    timezone: str,
    group_by: str,
    sub5: str = "",
) -> list[dict[str, Any]]:
    dimension = "offer" if group_by == "offer" else "sub_id_5"
    filters = []
    if sub5:
        filters.append({"name": "sub_id_5", "operator": "EQUALS", "expression": sub5})
    result = client.build_report({
        "range": {
            "from": window["start_datetime"],
            "to": window["end_datetime"],
            "timezone": timezone,
        },
        "dimensions": [dimension],
        "measures": ["campaign_unique_clicks", "cost"],
        "filters": filters,
        "sort": [{"name": "campaign_unique_clicks", "order": "DESC"}],
    })
    return extract_rows(result)


def sub5_spend_row(row: dict[str, Any]) -> dict[str, Any]:
    raw = parse_json_object(row.get("raw_json"))
    sub5 = cost_row_sub5(row, raw)
    parsed = parse_sub5(sub5)
    offer = normalize_text(row.get("normalized_offer")) or normalize_text(row.get("offer_raw"))
    return {
        **row,
        "sub_id_5": sub5,
        "sub5": sub5,
        "offer": offer,
        "offer_name": offer,
        "geo": parsed.get("geo", "") or normalize_text(row.get("geo")),
        "buyer": parsed.get("buyer", ""),
        "account_id": parsed.get("account_id", "") or sub5_account_id(row),
        "creative": parsed.get("creative", ""),
    }


def add_sub5_spend_rows(
    buckets: dict[str, dict[str, Any]],
    spend_rows: list[dict[str, Any]],
    *,
    group_by: str,
    sub5_filter: str = "",
) -> int:
    source_rows = 0
    for row in spend_rows:
        spend = to_float(row.get("total_spend")) or to_float(row.get("acc_spend")) + to_float(row.get("pwa_spend"))
        if spend <= 0:
            continue
        prepared = sub5_spend_row(row)
        row_sub5 = effective_sub5(prepared)
        if sub5_filter and row_sub5 != sub5_filter:
            continue
        key = sub5_group_key(prepared, group_by)
        if not key or is_macro_value(key):
            continue
        source_rows += 1
        bucket = buckets.setdefault(key, empty_sub5_group(prepared, group_by, key))
        bucket["acc_spend"] += to_float(row.get("acc_spend"))
        bucket["pwa_spend"] += to_float(row.get("pwa_spend"))
        bucket["total_spend"] += spend
        bucket["spend_source"] = "spend"
    return source_rows


def load_sub5_spend_rows(db_path: str | Path | None, date_from: str, date_to: str) -> list[dict[str, Any]]:
    store = DashboardStore(db_path)
    with store.connect() as conn:
        return store._load_rows(
            conn,
            source="spend",
            period_key="",
            date_from=date_from,
            date_to=date_to,
            report_name=None,
        )


def add_sub5_install_rows(
    buckets: dict[str, dict[str, Any]],
    install_rows: list[dict[str, Any]],
    *,
    group_by: str,
) -> None:
    for row in install_rows:
        key = sub5_group_key(row, group_by)
        if not key or is_macro_value(key):
            continue
        bucket = buckets.setdefault(key, empty_sub5_group(row, group_by, key))
        bucket["installs"] += to_float(row.get("campaign_unique_clicks"))
        bucket["keitaro_cost"] += to_float(row.get("cost"))


def add_sub5_conversion(
    buckets: dict[str, dict[str, Any]],
    row: dict[str, Any],
    *,
    group_by: str,
    field: str,
) -> None:
    key = sub5_group_key(row, group_by)
    if not key or is_macro_value(key):
        return
    bucket = buckets.setdefault(key, empty_sub5_group(row, group_by, key))
    bucket[field] += 1
    if field == "deps":
        bucket["normal_deps"] += 1
        bucket["revenue"] += to_float(row.get("revenue"))
    elif field == "recovered_deps":
        bucket["deps"] += 1
        bucket["revenue"] += to_float(row.get("revenue"))


def build_sub5_report(client: Any, arguments: dict[str, Any]) -> dict[str, Any]:
    target_date = normalize_text(arguments.get("date") or arguments.get("date_ymd") or date_str(dt.date.today()))
    parse_date(target_date)
    start_hour = int(arguments.get("start_hour") or arguments.get("window_start_hour") or 0)
    group_by = normalize_sub5_group_by(arguments.get("group_by"))
    timezone = normalize_text(arguments.get("timezone")) or DEFAULT_TIMEZONE
    registration_days = int(arguments.get("registration_days") or DEPOSIT_REGISTRATION_DAYS)
    limit = int(arguments.get("limit") or 100)
    sub5_filter = normalize_text(arguments.get("sub5"))
    order_by = normalize_sub5_sort_field(arguments.get("order_by"), group_by)
    order = normalize_sub5_sort_order(arguments.get("order"))
    window = day_window(target_date, start_hour)
    registration_from = date_str(parse_date(target_date) - dt.timedelta(days=max(registration_days, 1) - 1))

    conversion_rows = fetch_raw_conversion_rows(
        client,
        date_from=registration_from,
        date_to=window["query_to_date"],
        timezone=timezone,
    )
    install_rows = fetch_sub5_install_rows(
        client,
        window=window,
        timezone=timezone,
        group_by=group_by,
        sub5=sub5_filter,
    )
    spend_rows = load_sub5_spend_rows(arguments.get("db_path"), target_date, target_date)
    buckets: dict[str, dict[str, Any]] = {}
    add_sub5_install_rows(buckets, install_rows, group_by=group_by)

    dep_seen: set[str] = set()
    reg_source_rows = 0
    sale_source_rows = 0
    recovered_source_rows = 0
    late_deps = 0
    for row in conversion_rows:
        row_sub5 = effective_sub5(row)
        if sub5_filter and row_sub5 != sub5_filter:
            continue
        if is_lead_or_sale(row) and is_in_day_window(row.get("postback_datetime"), window):
            reg_source_rows += 1
            add_sub5_conversion(buckets, row, group_by=group_by, field="regs")
        if is_normal_deposit_in_window(row, window):
            key = conversion_key(row)
            if key and key in dep_seen:
                continue
            if key:
                dep_seen.add(key)
            sale_source_rows += 1
            if not is_in_day_window(row.get("postback_datetime"), window):
                late_deps += 1
                group_key = sub5_group_key(row, group_by)
                if group_key:
                    bucket = buckets.setdefault(group_key, empty_sub5_group(row, group_by, group_key))
                    bucket["late_deps"] += 1
            add_sub5_conversion(buckets, row, group_by=group_by, field="deps")
        if is_overwritten_deposit_in_window(row, window):
            key = conversion_key(row)
            if key and key in dep_seen:
                continue
            if key:
                dep_seen.add(key)
            recovered_source_rows += 1
            add_sub5_conversion(buckets, row, group_by=group_by, field="recovered_deps")

    spend_source_rows = add_sub5_spend_rows(
        buckets,
        spend_rows,
        group_by=group_by,
        sub5_filter=sub5_filter,
    )
    rows = [rounded_sub5_row(row) for row in buckets.values()]
    sort_sub5_rows(rows, group_by=group_by, order_by=order_by, order=order)
    totals = {
        "groups": len(rows),
        "installs": int(sum(to_float(row.get("installs")) for row in rows)),
        "regs": int(sum(to_float(row.get("regs")) for row in rows)),
        "deps": int(sum(to_float(row.get("deps")) for row in rows)),
        "recovered_deps": int(sum(to_float(row.get("recovered_deps")) for row in rows)),
        "late_deps": int(sum(to_float(row.get("late_deps")) for row in rows)),
        "revenue": round(sum(to_float(row.get("revenue")) for row in rows), 4),
        "total_spend": round(sum(to_float(row.get("total_spend")) for row in rows), 4),
    }
    totals["cr"] = round(safe_div(totals["deps"], totals["regs"]), 4)
    limited_rows = rows[:limit]

    return {
        "date": target_date,
        "timezone": timezone,
        "source": "keitaro",
        "group_by": group_by,
        "sub5": sub5_filter,
        "order_by": order_by,
        "order": order,
        "time_window": {
            "start_hour": window["start_hour"],
            "start_datetime": window["start_datetime"],
            "end_datetime": window["end_datetime"],
            "registration_from": registration_from,
        },
        "counts": {
            **totals,
            "raw_loaded_rows": len(conversion_rows),
            "reg_source_rows": reg_source_rows,
            "sale_source_rows": sale_source_rows,
            "recovered_source_rows": recovered_source_rows,
            "install_source_rows": len(install_rows),
            "spend_source_rows": spend_source_rows,
            "late_dep_rows": late_deps,
        },
        "rows": limited_rows,
        "all_rows": rows,
        "csv": make_sub5_csv(rows, group_by),
    }


def refresh_keitaro_reports(client: Any, instance: str, arguments: dict[str, Any]) -> dict[str, Any]:
    store = DashboardStore(arguments.get("db_path"))
    timezone = arguments.get("timezone") or DEFAULT_TIMEZONE
    reports = arguments.get("reports") or DEFAULT_REPORTS
    unknown_reports = [name for name in reports if name not in REPORT_DEFINITIONS and name != EXACT_DEPOSITS_REPORT]
    if unknown_reports:
        raise ValueError(f"Unknown dashboard reports: {unknown_reports}")

    results = []
    periods = resolve_requested_periods(arguments)
    for period in periods:
        for report_name in reports:
            if report_name == EXACT_DEPOSITS_REPORT:
                rows, stats = fetch_exact_deposit_rows(
                    client,
                    date_from=period["date_from"],
                    date_to=period["date_to"],
                    timezone=timezone,
                    registration_days=int(arguments.get("registration_days") or DEPOSIT_REGISTRATION_DAYS),
                )
                inserted = store.upsert_report_rows(
                    instance=instance,
                    timezone=timezone,
                    period_key=period["period_key"],
                    date_from=period["date_from"],
                    date_to=period["date_to"],
                    report_name=report_name,
                    rows=rows,
                )
                results.append({
                    "period_key": period["period_key"],
                    "date_from": period["date_from"],
                    "date_to": period["date_to"],
                    "report_name": report_name,
                    "rows": inserted,
                    **stats,
                })
                continue

            body = {
                "range": {
                    "from": period["date_from"],
                    "to": period["date_to"],
                    "timezone": timezone,
                },
                "dimensions": REPORT_DEFINITIONS[report_name],
                "measures": (
                    arguments.get("measures")
                    or (TRACKING_QUALITY_MEASURES if report_name == "tracking_quality" else STANDARD_MEASURES)
                ),
            }
            result = client.build_report(body)
            rows = extract_rows(result)
            inserted = store.upsert_report_rows(
                instance=instance,
                timezone=timezone,
                period_key=period["period_key"],
                date_from=period["date_from"],
                date_to=period["date_to"],
                report_name=report_name,
                rows=rows,
            )
            results.append({
                "period_key": period["period_key"],
                "date_from": period["date_from"],
                "date_to": period["date_to"],
                "report_name": report_name,
                "rows": inserted,
            })

    if parse_bool_arg(arguments.get("refresh_campaign_splits"), True):
        try:
            campaign_names = store.campaign_names_for_split_refresh(periods)
            if campaign_names:
                split_result = refresh_campaign_offer_splits(
                    client,
                    store,
                    instance,
                    campaign_names=campaign_names,
                )
            else:
                split_result = {
                    "instance": instance,
                    "rows": 0,
                    "campaigns": 0,
                    "streams": 0,
                    "offers": 0,
                    "campaign_filter_count": 0,
                    "skipped": "no campaign names in current spend/report period",
                }
            results.append({
                "period_key": "current",
                "date_from": "",
                "date_to": "",
                "report_name": "campaign_offer_splits",
                **split_result,
            })
        except Exception as exc:  # noqa: BLE001 - report refresh should still finish if split metadata is unavailable.
            results.append({
                "period_key": "current",
                "date_from": "",
                "date_to": "",
                "report_name": "campaign_offer_splits",
                "rows": 0,
                "error": str(exc),
            })

    return {
        "db_path": str(store.path),
        "timezone": timezone,
        "results": results,
    }
