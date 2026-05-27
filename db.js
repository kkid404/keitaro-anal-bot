import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildDayWindow,
  clean,
  effectiveSub5,
  isInDayWindow,
  isMacroValue,
  looksLikeSub5,
  parseRelativeDate,
  parseSub5,
} from './report.js';

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeStatus(value) {
  return clean(value).toLowerCase();
}

export function isSaleStatus(value) {
  return normalizeStatus(value) === 'sale';
}

export function isLeadOrSaleStatus(value) {
  const status = normalizeStatus(value);
  return status === 'lead' || status === 'sale';
}

export function isRecoveredSaleEvent(event) {
  return normalizeStatus(event.previous_status) === 'sale' && !isSaleStatus(event.status);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return '';
}

function parseRevenue(value) {
  if (value == null || value === '') return 0;
  const text = String(value).replace(',', '.').replace(/[^\d.-]/g, '');
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

export function dateStartsWith(value, dateYmd) {
  return clean(value).startsWith(dateYmd);
}

export function uniqueKey(event) {
  return [
    event.conversion_id || event.sub_id || event.raw_id || 'unknown',
    event.status || 'unknown',
    event.sale_datetime || '',
    event.postback_datetime || '',
  ].join('|');
}

export function spendKey(row) {
  return [
    clean(row.dateYmd),
    clean(row.sub5),
    clean(row.currency || 'USD'),
  ].join('|');
}

export function spendSnapshotKey(row) {
  const parsed = parseSub5(row.sub5 || '');
  return [
    clean(row.dateYmd),
    clean(row.accountId || parsed.accountId || 'unknown'),
    clean(row.currency || 'USD'),
  ].join('|');
}

async function ensureJsonl(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, '', 'utf8');
  }
}

async function ensureJson(filePath, fallback) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, `${JSON.stringify(fallback, null, 2)}\n`, 'utf8');
  }
}

async function readJson(filePath, fallback = {}) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content || '{}');
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function readJsonl(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function appendJsonl(filePath, object) {
  await fs.appendFile(filePath, `${JSON.stringify(object)}\n`, 'utf8');
}

export function normalizeConversion(payload = {}) {
  const rawSub5 = firstNonEmpty(payload.sub_id_5, payload.sub5, payload.sub_id5, payload.sub5_value);
  const campaign = firstNonEmpty(payload.campaign, payload.campaign_name);
  const sub5 = rawSub5 && !isMacroValue(rawSub5)
    ? rawSub5
    : (looksLikeSub5(campaign) ? campaign : rawSub5);
  const parsedSub5 = parseSub5(sub5);
  const status = normalizeStatus(firstNonEmpty(payload.status, payload.original_status, payload.type));

  const event = {
    conversion_id: firstNonEmpty(payload.conversion_id, payload.conversionId, payload.id),
    status,
    original_status: normalizeStatus(payload.original_status),
    previous_status: normalizeStatus(firstNonEmpty(payload.previous_status, payload.previousStatus)),
    sub_id: firstNonEmpty(payload.sub_id, payload.subid, payload.click_id, payload.clickid),
    sub_id_1: firstNonEmpty(payload.sub_id_1, payload.sub1),
    sub_id_2: firstNonEmpty(payload.sub_id_2, payload.sub2),
    sub_id_3: firstNonEmpty(payload.sub_id_3, payload.sub3),
    sub_id_4: firstNonEmpty(payload.sub_id_4, payload.sub4),
    sub_id_5: sub5,
    sub_id_6: firstNonEmpty(payload.sub_id_6, payload.sub6),
    campaign,
    offer: firstNonEmpty(payload.offer, payload.offer_name),
    geo: firstNonEmpty(payload.geo, payload.country, parsedSub5.geo),
    buyer: firstNonEmpty(payload.buyer, parsedSub5.buyer),
    account_id: firstNonEmpty(payload.account_id, payload.accountId, parsedSub5.accountId),
    creative: firstNonEmpty(payload.creative, parsedSub5.creative),
    funnel: firstNonEmpty(payload.funnel, parsedSub5.funnel),
    campaign_type: firstNonEmpty(payload.campaign_type, parsedSub5.campaignType),
    ad_number: firstNonEmpty(payload.ad_number, parsedSub5.adNumber),
    revenue: parseRevenue(firstNonEmpty(payload.revenue, payload.payout, payload.cost)),
    postback_datetime: firstNonEmpty(payload.postback_datetime, payload.datetime, payload.conversion_datetime, payload.created_at),
    sale_datetime: firstNonEmpty(payload.sale_datetime, payload.saleDateTime, payload.sale_time),
    raw_json: payload,
    created_at: nowIso(),
  };

  event.key = uniqueKey(event);
  return event;
}

export class JsonDb {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.conversionsFile = path.join(dataDir, 'conversions.jsonl');
    this.webhookLogsFile = path.join(dataDir, 'webhook_logs.jsonl');
    this.chatsFile = path.join(dataDir, 'telegram_chats.jsonl');
    this.settingsFile = path.join(dataDir, 'settings.json');
    this.facebookSpendFile = path.join(dataDir, 'facebook_spend.jsonl');
    this.facebookImportsFile = path.join(dataDir, 'facebook_imports.jsonl');
    this.keys = new Set();
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await ensureJsonl(this.conversionsFile);
    await ensureJsonl(this.webhookLogsFile);
    await ensureJsonl(this.chatsFile);
    await ensureJsonl(this.facebookSpendFile);
    await ensureJsonl(this.facebookImportsFile);
    await ensureJson(this.settingsFile, {});

    const conversions = await readJsonl(this.conversionsFile);
    this.keys = new Set(conversions.map((event) => event.key || uniqueKey(event)));
  }

  async getProfile() {
    return readJson(this.settingsFile, {});
  }

  async updateProfile(patch) {
    const current = await this.getProfile();
    const next = {
      ...current,
      ...patch,
      updated_at: nowIso(),
    };
    await fs.writeFile(this.settingsFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }

  async saveChat(chat) {
    const record = {
      chat_id: String(chat.id),
      title: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || '',
      username: chat.username || '',
      type: chat.type || '',
      enabled: true,
      created_at: nowIso(),
    };
    await appendJsonl(this.chatsFile, record);
    return record;
  }

  async listChats() {
    return readJsonl(this.chatsFile);
  }

  async insertConversion(payload) {
    const event = normalizeConversion(payload);
    if (!event.status) {
      return { inserted: false, reason: 'missing_status', event };
    }
    if (!event.sub_id_5) {
      return { inserted: false, reason: 'missing_sub_id_5', event };
    }
    if (this.keys.has(event.key)) {
      return { inserted: false, reason: 'duplicate', event };
    }

    this.keys.add(event.key);
    await appendJsonl(this.conversionsFile, event);
    return { inserted: true, event };
  }

  async logWebhook(record) {
    const entry = {
      ...record,
      created_at: nowIso(),
    };
    await appendJsonl(this.webhookLogsFile, entry);
    return entry;
  }

  async listConversions({ limit = 20, status = '', dateYmd = '' } = {}) {
    const rows = await readJsonl(this.conversionsFile);
    const filtered = rows.filter((event) => {
      const wantedStatus = normalizeStatus(status);
      if (wantedStatus === 'sale' && !isSaleStatus(event.status) && !isRecoveredSaleEvent(event)) return false;
      if (wantedStatus && wantedStatus !== 'sale' && normalizeStatus(event.status) !== wantedStatus) return false;
      if (dateYmd) {
        const eventDate = isSaleStatus(event.status) || isRecoveredSaleEvent(event)
          ? event.sale_datetime || event.postback_datetime
          : event.postback_datetime || event.sale_datetime;
        if (!dateStartsWith(eventDate, dateYmd)) return false;
      }
      return true;
    });

    return filtered
      .sort((a, b) => clean(b.created_at).localeCompare(clean(a.created_at)))
      .slice(0, limit);
  }

  async statsForDate(dateYmd) {
    const rows = await readJsonl(this.conversionsFile);
    const grouped = new Map();

    for (const event of rows) {
      const status = normalizeStatus(event.status);
      const sub5 = effectiveSub5(event);
      if (!sub5) continue;

      const item = grouped.get(sub5) || { sub5, regs: 0, deps: 0, recoveredDeps: 0, revenue: 0 };
      if (isLeadOrSaleStatus(status) && dateStartsWith(event.postback_datetime, dateYmd)) {
        item.regs += 1;
      }
      if (
        (isSaleStatus(status) && dateStartsWith(event.sale_datetime || event.postback_datetime, dateYmd))
        || (isRecoveredSaleEvent(event) && dateStartsWith(event.postback_datetime, dateYmd))
      ) {
        item.deps += 1;
        if (isRecoveredSaleEvent(event)) item.recoveredDeps += 1;
        item.revenue += Number(event.revenue || 0);
      }
      grouped.set(sub5, item);
    }

    const groups = [...grouped.values()]
      .filter((item) => item.regs || item.deps)
      .sort((a, b) => b.deps - a.deps || b.regs - a.regs || a.sub5.localeCompare(b.sub5));

    const regs = groups.reduce((sum, row) => sum + row.regs, 0);
    const deps = groups.reduce((sum, row) => sum + row.deps, 0);
    const revenue = groups.reduce((sum, row) => sum + row.revenue, 0);
    const recoveredDeps = groups.reduce((sum, row) => sum + row.recoveredDeps, 0);

    return {
      dateYmd,
      groups,
      regs,
      deps,
      recoveredDeps,
      revenue,
      cr: regs ? deps / regs : 0,
    };
  }

  async statsForSub5(sub5, dateYmd = '', options = {}) {
    const key = clean(sub5);
    const rows = (await readJsonl(this.conversionsFile))
      .filter((event) => effectiveSub5(event) === key);
    const targetDate = dateYmd ? parseRelativeDate(dateYmd) : null;
    const startHour = Number.isFinite(Number(options.startHour)) ? Number(options.startHour) : 0;
    const inWindow = (value) => (
      targetDate ? isInDayWindow(value, targetDate, startHour) : true
    );

    const scopedRows = dateYmd
      ? rows.filter((event) => (
        inWindow(event.postback_datetime)
        || inWindow(event.sale_datetime)
      ))
      : rows;
    const regs = rows.filter((event) => {
      const status = normalizeStatus(event.status);
      return isLeadOrSaleStatus(status)
        && (!dateYmd || inWindow(event.postback_datetime));
    }).length;
    const depRows = rows
      .filter((event) => isSaleStatus(event.status) || isRecoveredSaleEvent(event))
      .filter((event) => {
        if (!dateYmd) return true;
        if (isRecoveredSaleEvent(event)) return inWindow(event.postback_datetime);
        return inWindow(event.sale_datetime || event.postback_datetime);
      });
    const revenue = depRows.reduce((sum, event) => sum + Number(event.revenue || 0), 0);
    const allTimeRegs = rows.filter((event) => {
      const status = normalizeStatus(event.status);
      return isLeadOrSaleStatus(status);
    }).length;
    const allTimeDeps = rows.filter((event) => isSaleStatus(event.status) || isRecoveredSaleEvent(event)).length;

    return {
      sub5: key,
      dateYmd,
      timeWindow: targetDate ? buildDayWindow(targetDate, startHour) : null,
      rows: scopedRows,
      allRows: rows,
      regs,
      deps: depRows.length,
      recoveredDeps: depRows.filter(isRecoveredSaleEvent).length,
      lateDeps: dateYmd
        ? depRows.filter((event) => !isRecoveredSaleEvent(event) && !inWindow(event.postback_datetime)).length
        : 0,
      revenue,
      sourceRows: scopedRows.length,
      allTimeRegs,
      allTimeDeps,
    };
  }

  async saveFacebookSpendImport(importBatch, meta = {}) {
    const importedAt = importBatch.importedAt || nowIso();
    const importRecord = {
      import_id: importBatch.importId,
      imported_at: importedAt,
      source_rows: importBatch.sourceRows,
      grouped_rows: importBatch.rows.length,
      dates: importBatch.dates,
      accounts: [...new Set(importBatch.rows.map((row) => clean(row.accountId)).filter(Boolean))].sort(),
      snapshot_keys: [...new Set(importBatch.rows.map(spendSnapshotKey))].sort(),
      currency: importBatch.currency,
      total_spend: importBatch.totalSpend,
      total_results: importBatch.totalResults,
      pushed_to_keitaro: false,
      ...meta,
    };

    await appendJsonl(this.facebookImportsFile, importRecord);

    for (const row of importBatch.rows) {
      await appendJsonl(this.facebookSpendFile, {
        ...row,
        import_id: importBatch.importId,
        imported_at: importedAt,
      });
    }

    return importRecord;
  }

  async listFacebookImports({ limit = 20 } = {}) {
    const rows = await readJsonl(this.facebookImportsFile);
    return rows
      .sort((a, b) => clean(b.imported_at).localeCompare(clean(a.imported_at)))
      .slice(0, limit);
  }

  async getFacebookImport(importId) {
    const id = clean(importId);
    const imports = await readJsonl(this.facebookImportsFile);
    const record = imports
      .filter((item) => clean(item.import_id) === id)
      .sort((a, b) => clean(b.imported_at).localeCompare(clean(a.imported_at)))[0] || null;
    if (!record) return null;

    const rows = (await readJsonl(this.facebookSpendFile))
      .filter((row) => clean(row.import_id) === id)
      .sort((a, b) => clean(a.sub5).localeCompare(clean(b.sub5), undefined, { numeric: true, sensitivity: 'base' }));

    return { ...record, rows };
  }

  async markFacebookImportPushed(importId, result = {}) {
    const record = {
      import_id: clean(importId),
      imported_at: nowIso(),
      pushed_to_keitaro: true,
      push_result: result,
    };
    await appendJsonl(this.facebookImportsFile, record);
    return record;
  }

  async facebookSpendForDate(dateYmd) {
    const rows = await readJsonl(this.facebookSpendFile);
    const scopedRows = rows.filter((row) => !dateYmd || clean(row.dateYmd) === dateYmd);
    const latestSnapshot = new Map();

    for (const row of scopedRows) {
      const key = spendSnapshotKey(row);
      const current = latestSnapshot.get(key);
      if (!current || clean(row.imported_at).localeCompare(clean(current.imported_at)) > 0) {
        latestSnapshot.set(key, row);
      }
    }

    const latest = new Map();

    for (const row of scopedRows) {
      const snapshot = latestSnapshot.get(spendSnapshotKey(row));
      if (snapshot?.import_id && clean(row.import_id) !== clean(snapshot.import_id)) continue;
      const key = spendKey(row);
      const current = latest.get(key);
      if (!current || clean(row.imported_at).localeCompare(clean(current.imported_at)) > 0) {
        latest.set(key, row);
      }
    }

    return [...latest.values()]
      .sort((a, b) => clean(a.sub5).localeCompare(clean(b.sub5), undefined, { numeric: true, sensitivity: 'base' }));
  }

  async facebookSpendStats(dateYmd) {
    const rows = await this.facebookSpendForDate(dateYmd);
    const totalSpend = rows.reduce((sum, row) => sum + Number(row.spend || 0), 0);
    const totalResults = rows.reduce((sum, row) => sum + Number(row.results || 0), 0);
    const totalImpressions = rows.reduce((sum, row) => sum + Number(row.impressions || 0), 0);
    const totalReach = rows.reduce((sum, row) => sum + Number(row.reach || 0), 0);
    const currency = rows.find((row) => row.currency)?.currency || 'USD';

    return {
      dateYmd,
      rows,
      groups: rows.length,
      totalSpend,
      totalResults,
      totalImpressions,
      totalReach,
      currency,
    };
  }

  async facebookSpendSnapshotIndex(dateYmd) {
    const rows = (await readJsonl(this.facebookSpendFile))
      .filter((row) => !dateYmd || clean(row.dateYmd) === dateYmd);
    const latest = new Map();

    for (const row of rows) {
      const key = spendSnapshotKey(row);
      const current = latest.get(key);
      if (!current || clean(row.imported_at).localeCompare(clean(current.imported_at)) > 0) {
        latest.set(key, {
          snapshot_key: key,
          import_id: row.import_id,
          imported_at: row.imported_at,
        });
      }
    }

    return Object.fromEntries(latest.entries());
  }

  async close() {}
}
