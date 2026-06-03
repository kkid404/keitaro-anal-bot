"""Command line interface for the standalone dashboard project."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from keitaro_dashboard.client import KeitaroDashboardClient
from keitaro_dashboard.store import DashboardStore, TODO_PRIORITIES, TODO_STATUSES, refresh_keitaro_reports
from keitaro_dashboard.web import serve


def load_json_rows(path: str) -> list[dict[str, Any]]:
    if path == "-":
        data = json.load(sys.stdin)
    else:
        with Path(path).open(encoding="utf-8") as handle:
            data = json.load(handle)
    if not isinstance(data, list):
        raise ValueError("Expected a JSON array of objects.")
    return data


def print_json(data: Any) -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(data, ensure_ascii=False, indent=2, default=str))


def command_payload(args: argparse.Namespace) -> dict[str, Any]:
    return {
        key: value
        for key, value in vars(args).items()
        if key not in {"command", "db_path"} and value not in (None, "", [])
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Keitaro kill/scale dashboard storage")
    parser.add_argument("--db-path", help="SQLite database path. Defaults to dashboard/data/keitaro-dashboard.sqlite3")
    subparsers = parser.add_subparsers(dest="command", required=True)

    refresh = subparsers.add_parser("refresh", help="Fetch Keitaro reports into the local SQLite store")
    refresh.add_argument("--instance", default="default")
    refresh.add_argument("--timezone", default="Asia/Tbilisi")
    refresh.add_argument("--period", dest="periods", action="append")
    refresh.add_argument("--date-from")
    refresh.add_argument("--date-to")
    refresh.add_argument("--period-key")
    refresh.add_argument("--as-of-date")
    refresh.add_argument("--report", dest="reports", action="append")

    spend = subparsers.add_parser("ingest-spend", help="Insert spend rows from a JSON array")
    spend.add_argument("json_path", help="Path to JSON rows, or '-' for stdin")
    spend.add_argument("--batch-id")
    spend.add_argument("--replace-batch", action="store_true")
    spend.add_argument("--replace-dates", action="store_true")

    offer_map = subparsers.add_parser("offer-map", help="Upsert offer map rows from a JSON array")
    offer_map.add_argument("json_path", help="Path to JSON rows, or '-' for stdin")

    query = subparsers.add_parser("query", help="Query stored dashboard facts")
    query.add_argument("--source", choices=["spend", "keitaro"], default="spend")
    query.add_argument("--period-key")
    query.add_argument("--date-from")
    query.add_argument("--date-to")
    query.add_argument("--as-of-date")
    query.add_argument("--report-name")
    query.add_argument("--group-by", action="append", default=[])
    query.add_argument("--metric", dest="metrics", action="append", default=[])
    query.add_argument("--order-by", default="profit")
    query.add_argument("--order", choices=["ASC", "DESC"], default="DESC")
    query.add_argument("--limit", type=int, default=50)

    summary = subparsers.add_parser("summary", help="Build KPI, kill/scale, creative, and tracking summary")
    summary.add_argument("--period-key")
    summary.add_argument("--date-from")
    summary.add_argument("--date-to")
    summary.add_argument("--as-of-date")
    summary.add_argument("--target-daily-profit", type=float, default=1000)
    summary.add_argument("--target-roi", type=float, default=0.6)

    geo = subparsers.add_parser("geo-report", help="Build historical GEO overview")
    geo.add_argument("--period-key", default="last_7_days")
    geo.add_argument("--date-from")
    geo.add_argument("--date-to")
    geo.add_argument("--as-of-date")
    geo.add_argument("--limit", type=int, default=80)

    todo_list = subparsers.add_parser("todo-list", help="List dashboard todo items")
    todo_list.add_argument("--status", default="active", choices=sorted(TODO_STATUSES | {"active", "all"}))
    todo_list.add_argument("--period-key")
    todo_list.add_argument("--priority", choices=sorted(TODO_PRIORITIES | {"all"}))
    todo_list.add_argument("--category")
    todo_list.add_argument("--source")
    todo_list.add_argument("--query", dest="q")
    todo_list.add_argument("--include-done", action="store_true")
    todo_list.add_argument("--include-archived", action="store_true")
    todo_list.add_argument("--limit", type=int, default=50)

    todo_add = subparsers.add_parser("todo-add", help="Create a dashboard todo item")
    todo_add.add_argument("title")
    todo_add.add_argument("--note")
    todo_add.add_argument("--owner")
    todo_add.add_argument("--deadline")
    todo_add.add_argument("--status", choices=sorted(TODO_STATUSES), default="open")
    todo_add.add_argument("--priority", choices=sorted(TODO_PRIORITIES), default="normal")
    todo_add.add_argument("--category", default="ops")
    todo_add.add_argument("--tag", dest="tags", action="append", default=[])
    todo_add.add_argument("--source", default="codex")
    todo_add.add_argument("--period-key", default="today")
    todo_add.add_argument("--date-from")
    todo_add.add_argument("--date-to")
    todo_add.add_argument("--as-of-date")

    todo_update = subparsers.add_parser("todo-update", help="Update a dashboard todo item")
    todo_update.add_argument("id", type=int)
    todo_update.add_argument("--title")
    todo_update.add_argument("--note")
    todo_update.add_argument("--owner")
    todo_update.add_argument("--deadline")
    todo_update.add_argument("--status", choices=sorted(TODO_STATUSES))
    todo_update.add_argument("--priority", choices=sorted(TODO_PRIORITIES))
    todo_update.add_argument("--category")
    todo_update.add_argument("--tag", dest="tags", action="append")
    todo_update.add_argument("--source")
    todo_update.add_argument("--period-key")
    todo_update.add_argument("--date-from")
    todo_update.add_argument("--date-to")

    todo_delete = subparsers.add_parser("todo-delete", help="Delete a dashboard todo item")
    todo_delete.add_argument("id", type=int)

    codex = subparsers.add_parser("codex-context", help="Print compact dashboard context for Codex")
    codex.add_argument("--period-key", default="today")
    codex.add_argument("--date-from")
    codex.add_argument("--date-to")
    codex.add_argument("--as-of-date")
    codex.add_argument("--target-daily-profit", type=float, default=1000)
    codex.add_argument("--target-roi", type=float, default=0.6)
    codex.add_argument("--todo-limit", type=int, default=30)

    web = subparsers.add_parser("serve", help="Run Python backend and React dashboard UI")
    web.add_argument("--host", default="127.0.0.1")
    web.add_argument("--port", type=int, default=8765)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    store = DashboardStore(args.db_path)

    if args.command == "refresh":
        client = KeitaroDashboardClient.from_env()
        print_json(refresh_keitaro_reports(client, args.instance, vars(args)))
        return 0

    if args.command == "ingest-spend":
        rows = load_json_rows(args.json_path)
        print_json(store.ingest_spend_rows(
            rows,
            batch_id=args.batch_id,
            replace_batch=args.replace_batch,
            replace_dates=args.replace_dates,
        ))
        return 0

    if args.command == "offer-map":
        rows = load_json_rows(args.json_path)
        print_json(store.upsert_offer_map(rows))
        return 0

    if args.command == "query":
        payload = vars(args)
        payload["group_by"] = args.group_by
        payload["metrics"] = args.metrics or None
        print_json(store.query(payload))
        return 0

    if args.command == "summary":
        print_json(store.summary(vars(args)))
        return 0

    if args.command == "geo-report":
        print_json(store.geo_overview(command_payload(args)))
        return 0

    if args.command == "todo-list":
        print_json(store.list_todos(command_payload(args)))
        return 0

    if args.command == "todo-add":
        print_json(store.create_todo(command_payload(args)))
        return 0

    if args.command == "todo-update":
        print_json(store.update_todo(command_payload(args)))
        return 0

    if args.command == "todo-delete":
        print_json(store.delete_todo(command_payload(args)))
        return 0

    if args.command == "codex-context":
        print_json(store.codex_context(command_payload(args)))
        return 0

    if args.command == "serve":
        serve(host=args.host, port=args.port, db_path=args.db_path)
        return 0

    raise ValueError(f"Unknown command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
