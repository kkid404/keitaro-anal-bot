"""Import helpers for spend tables exported from Facebook Ads or sheets."""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import re
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from keitaro_dashboard.store import to_float


DATE_KEYS = [
    "date",
    "day",
    "дата",
    "день",
    "reporting starts",
    "reporting start",
    "date start",
    "starts",
    "начало отчетности",
    "дата начала",
]
SPEND_KEYS = [
    "amount spent",
    "amount spent (usd)",
    "amount spent usd",
    "spent",
    "spend",
    "cost",
    "сумма затрат",
    "потраченная сумма",
    "расход",
    "затраты",
]
CAMPAIGN_KEYS = ["campaign name", "campaign", "название кампании", "кампания"]
ADSET_KEYS = ["ad set name", "adset name", "ad set", "adset", "группа объявлений", "название группы объявлений"]
AD_KEYS = ["ad name", "ad", "creative", "креатив", "объявление", "название объявления"]
OFFER_KEYS = ["offer", "offer_raw", "оффер", "офер", "связка"]
REVENUE_KEYS = [
    "purchase conversion value",
    "conversion value",
    "value",
    "revenue",
    "выручка",
    "доход",
    "ценность конверсий",
    "ценность покупок",
]
DEPOSIT_KEYS = [
    "purchases",
    "website purchases",
    "purchase",
    "deposits",
    "deps",
    "sales",
    "покупки",
    "депозиты",
    "депы",
]


def parse_spend_file(filename: str, data: bytes) -> dict[str, Any]:
    """Parse a spend table and normalize it to dashboard spend rows."""
    suffix = Path(filename).suffix.lower()
    if suffix in {".xlsx", ".xlsm"}:
        table = parse_xlsx(data)
    elif suffix in {".csv", ".txt", ".tsv"}:
        table = parse_delimited(data, suffix=suffix)
    elif suffix == ".json":
        table = parse_json(data)
    else:
        raise ValueError("Поддерживаются файлы .csv, .tsv, .xlsx, .xlsm и .json")

    rows = normalize_spend_rows(table["rows"])
    return {
        "filename": filename,
        "source_rows": len(table["rows"]),
        "importable_rows": len(rows),
        "headers": table["headers"],
        "rows": rows,
        "warnings": table.get("warnings", []) + import_warnings(table["rows"], rows),
        "preview": rows[:8],
    }


def parse_json(data: bytes) -> dict[str, Any]:
    parsed = json.loads(data.decode("utf-8-sig"))
    if not isinstance(parsed, list):
        raise ValueError("JSON-файл должен быть массивом строк")
    rows = [row for row in parsed if isinstance(row, dict)]
    headers = sorted({key for row in rows for key in row})
    return {"headers": headers, "rows": rows, "warnings": []}


def parse_delimited(data: bytes, *, suffix: str) -> dict[str, Any]:
    text = decode_table_text(data)
    sample = text[:4096]
    if suffix == ".tsv":
        delimiter = "\t"
    else:
        try:
            delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t").delimiter
        except csv.Error:
            delimiter = ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    rows = [dict(row) for row in reader]
    return {"headers": reader.fieldnames or [], "rows": rows, "warnings": []}


def decode_table_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "cp1251", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def parse_xlsx(data: bytes) -> dict[str, Any]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        shared = read_shared_strings(archive)
        sheet_path = first_sheet_path(archive)
        xml = archive.read(sheet_path)

    matrix = read_sheet_matrix(xml, shared)
    header_index = find_header_row(matrix)
    if header_index is None:
        raise ValueError("Не удалось найти строку заголовков в XLSX")

    headers = [clean_header(value) for value in matrix[header_index]]
    rows = []
    for raw_row in matrix[header_index + 1:]:
        if not any(str(value).strip() for value in raw_row):
            continue
        row = {}
        for index, header in enumerate(headers):
            if not header:
                continue
            row[header] = raw_row[index] if index < len(raw_row) else ""
        rows.append(row)
    return {"headers": headers, "rows": rows, "warnings": []}


def read_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    values = []
    for item in root.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
        text_parts = [
            node.text or ""
            for node in item.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
        ]
        values.append("".join(text_parts))
    return values


def first_sheet_path(archive: zipfile.ZipFile) -> str:
    names = archive.namelist()
    sheets = sorted(name for name in names if re.match(r"xl/worksheets/sheet\d+\.xml$", name))
    if not sheets:
        raise ValueError("В XLSX не найдено листов")
    return sheets[0]


def read_sheet_matrix(xml: bytes, shared: list[str]) -> list[list[Any]]:
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    root = ElementTree.fromstring(xml)
    matrix: list[list[Any]] = []
    for row in root.iter(f"{ns}row"):
        values: list[Any] = []
        for cell in row.iter(f"{ns}c"):
            ref = cell.attrib.get("r", "")
            column_index = column_number(ref)
            while len(values) < column_index:
                values.append("")
            values.append(read_cell_value(cell, shared, ns))
        matrix.append(values)
    return matrix


def column_number(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha())
    total = 0
    for letter in letters:
        total = total * 26 + (ord(letter.upper()) - ord("A") + 1)
    return max(total - 1, 0)


def read_cell_value(cell: ElementTree.Element, shared: list[str], ns: str) -> Any:
    cell_type = cell.attrib.get("t")
    value_node = cell.find(f"{ns}v")
    if cell_type == "inlineStr":
        text_node = cell.find(f".//{ns}t")
        return text_node.text if text_node is not None else ""
    if value_node is None:
        return ""
    value = value_node.text or ""
    if cell_type == "s":
        index = int(value) if value.isdigit() else -1
        return shared[index] if 0 <= index < len(shared) else ""
    return value


def find_header_row(matrix: list[list[Any]]) -> int | None:
    best_index = None
    best_score = 0
    for index, row in enumerate(matrix[:30]):
        headers = [normalize_key(value) for value in row]
        score = 0
        score += 2 if find_key(headers, DATE_KEYS) is not None else 0
        score += 2 if find_key(headers, SPEND_KEYS) is not None else 0
        score += 1 if find_key(headers, CAMPAIGN_KEYS + OFFER_KEYS) is not None else 0
        score += sum(1 for value in headers if value)
        if score > best_score and score >= 4:
            best_index = index
            best_score = score
    return best_index


def normalize_spend_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for row in rows:
        clean = {clean_header(key): value for key, value in row.items()}
        key_map = {normalize_key(key): key for key in clean}
        date = parse_date_value(get_by_keys(clean, key_map, DATE_KEYS))
        spend = to_float(get_by_keys(clean, key_map, SPEND_KEYS))
        if not date or spend == 0:
            continue

        campaign = get_by_keys(clean, key_map, CAMPAIGN_KEYS)
        adset = get_by_keys(clean, key_map, ADSET_KEYS)
        ad = get_by_keys(clean, key_map, AD_KEYS)
        explicit_offer = get_by_keys(clean, key_map, OFFER_KEYS)
        offer = explicit_offer or campaign or adset or ad or "facebook_spend"
        revenue = to_float(get_by_keys(clean, key_map, REVENUE_KEYS))
        deposits = to_float(get_by_keys(clean, key_map, DEPOSIT_KEYS))

        normalized.append({
            "date": date,
            "offer_raw": str(offer).strip(),
            "geo": get_geo_from_text(" ".join(str(value) for value in (offer, campaign, adset, ad))),
            "deposits": deposits,
            "revenue": revenue,
            "acc_spend": spend,
            "pwa_spend": 0,
            "facebook_campaign": str(campaign or "").strip(),
            "facebook_adset": str(adset or "").strip(),
            "facebook_ad": str(ad or "").strip(),
            "spend_level": "offer" if explicit_offer else "campaign",
            "source": "facebook_ads",
            "raw": clean,
        })
    return normalized


def import_warnings(source_rows: list[dict[str, Any]], rows: list[dict[str, Any]]) -> list[str]:
    warnings = []
    skipped = len(source_rows) - len(rows)
    if skipped > 0:
        warnings.append(f"Пропущено строк без даты или расхода: {skipped}")
    if not rows:
        warnings.append("Не найдено строк с датой и расходом. Проверь названия колонок.")
    return warnings


def clean_header(value: Any) -> str:
    return str(value or "").strip().replace("\ufeff", "")


def normalize_key(value: Any) -> str:
    text = clean_header(value).lower()
    text = re.sub(r"\s+", " ", text)
    text = text.replace("\u00a0", " ")
    return text.strip()


def find_key(headers: list[str], candidates: list[str]) -> str | None:
    for candidate in candidates:
        normalized = normalize_key(candidate)
        for header in headers:
            if header == normalized or normalized in header:
                return header
    return None


def get_by_keys(row: dict[str, Any], key_map: dict[str, str], candidates: list[str]) -> Any:
    for candidate in candidates:
        normalized = normalize_key(candidate)
        for key, original in key_map.items():
            if key == normalized or normalized in key:
                value = row.get(original)
                if value not in (None, ""):
                    return value
    return ""


def parse_date_value(value: Any) -> str:
    if value in (None, ""):
        return ""
    if isinstance(value, (int, float)) or str(value).replace(".", "", 1).isdigit():
        number = to_float(value)
        if 20000 < number < 60000:
            base = dt.date(1899, 12, 30)
            return (base + dt.timedelta(days=int(number))).isoformat()

    text = str(value).strip()
    text = text.split(" ")[0]
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return dt.datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    match = re.search(r"(\d{4})-(\d{2})-(\d{2})", text)
    if match:
        return match.group(0)
    return ""


def get_geo_from_text(text: str) -> str:
    match = re.search(r"\b([A-Z]{2})\b", text)
    return match.group(1) if match else ""
