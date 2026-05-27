import pg from 'pg';
import {
  dateStartsWith,
  isLeadOrSaleStatus,
  isRecoveredSaleEvent,
  isSaleStatus,
  normalizeConversion,
  normalizeStatus,
  nowIso,
  spendKey,
  spendSnapshotKey,
} from './db.js';
import {
  buildDayWindow,
  clean,
  effectiveSub5,
  isInDayWindow,
  parseRelativeDate,
} from './report.js';

const { Pool } = pg;

function jsonData(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function cleanLimit(value, fallback = 20) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.trunc(number), 1), 10000);
}

function filterConversions(rows, { limit = 20, status = '', dateYmd = '' } = {}) {
  const wantedStatus = normalizeStatus(status);
  return rows
    .filter((event) => {
      if (wantedStatus === 'sale' && !isSaleStatus(event.status) && !isRecoveredSaleEvent(event)) return false;
      if (wantedStatus && wantedStatus !== 'sale' && normalizeStatus(event.status) !== wantedStatus) return false;
      if (dateYmd) {
        const eventDate = isSaleStatus(event.status) || isRecoveredSaleEvent(event)
          ? event.sale_datetime || event.postback_datetime
          : event.postback_datetime || event.sale_datetime;
        if (!dateStartsWith(eventDate, dateYmd)) return false;
      }
      return true;
    })
    .sort((a, b) => clean(b.created_at).localeCompare(clean(a.created_at)))
    .slice(0, cleanLimit(limit));
}

function statsForDateFromRows(rows, dateYmd) {
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

function statsForSub5FromRows(rows, sub5, dateYmd = '', options = {}) {
  const key = clean(sub5);
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

function latestFacebookSpendRows(rows, dateYmd = '') {
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

function facebookSpendSnapshotIndexFromRows(rows, dateYmd = '') {
  const latest = new Map();

  for (const row of rows.filter((item) => !dateYmd || clean(item.dateYmd) === dateYmd)) {
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

export class PostgresDb {
  constructor({ connectionString, ssl = false } = {}) {
    this.pool = new Pool({
      connectionString,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
    });
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        id integer PRIMARY KEY CHECK (id = 1),
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telegram_chats (
        chat_id text PRIMARY KEY,
        data jsonb NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversions (
        key text PRIMARY KEY,
        status text NOT NULL,
        previous_status text NOT NULL DEFAULT '',
        sub_id_5 text NOT NULL DEFAULT '',
        postback_datetime text NOT NULL DEFAULT '',
        sale_datetime text NOT NULL DEFAULT '',
        created_at text NOT NULL,
        data jsonb NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhook_logs (
        id bigserial PRIMARY KEY,
        status_code integer,
        message text NOT NULL DEFAULT '',
        created_at text NOT NULL,
        data jsonb NOT NULL
      );

      CREATE TABLE IF NOT EXISTS facebook_imports (
        id bigserial PRIMARY KEY,
        import_id text NOT NULL,
        imported_at text NOT NULL,
        data jsonb NOT NULL
      );

      CREATE TABLE IF NOT EXISTS facebook_spend (
        id bigserial PRIMARY KEY,
        import_id text NOT NULL,
        imported_at text NOT NULL,
        date_ymd text NOT NULL DEFAULT '',
        sub5 text NOT NULL DEFAULT '',
        account_id text NOT NULL DEFAULT '',
        currency text NOT NULL DEFAULT '',
        data jsonb NOT NULL
      );

      CREATE INDEX IF NOT EXISTS conversions_created_at_idx ON conversions (created_at DESC);
      CREATE INDEX IF NOT EXISTS conversions_status_idx ON conversions (status);
      CREATE INDEX IF NOT EXISTS conversions_sale_lookup_idx ON conversions (status, previous_status, sale_datetime, postback_datetime);
      CREATE INDEX IF NOT EXISTS conversions_sub5_idx ON conversions (sub_id_5);
      CREATE INDEX IF NOT EXISTS webhook_logs_created_at_idx ON webhook_logs (created_at DESC);
      CREATE INDEX IF NOT EXISTS facebook_imports_imported_at_idx ON facebook_imports (imported_at DESC);
      CREATE INDEX IF NOT EXISTS facebook_imports_import_id_idx ON facebook_imports (import_id);
      CREATE INDEX IF NOT EXISTS facebook_spend_date_idx ON facebook_spend (date_ymd);
      CREATE INDEX IF NOT EXISTS facebook_spend_import_id_idx ON facebook_spend (import_id);
      CREATE INDEX IF NOT EXISTS facebook_spend_snapshot_idx ON facebook_spend (date_ymd, account_id, currency, imported_at DESC);
    `);
  }

  async getProfile() {
    const result = await this.pool.query('SELECT data FROM bot_settings WHERE id = 1');
    return jsonData(result.rows[0]?.data, {});
  }

  async updateProfile(patch) {
    const current = await this.getProfile();
    const next = {
      ...current,
      ...patch,
      updated_at: nowIso(),
    };

    await this.pool.query(
      `INSERT INTO bot_settings (id, data, updated_at)
       VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE
       SET data = EXCLUDED.data,
           updated_at = EXCLUDED.updated_at`,
      [next, next.updated_at],
    );

    return next;
  }

  async saveChat(chat) {
    const record = {
      chat_id: String(chat.id ?? chat.chat_id),
      title: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || '',
      username: chat.username || '',
      type: chat.type || '',
      enabled: chat.enabled ?? true,
      created_at: chat.created_at || nowIso(),
    };

    await this.pool.query(
      `INSERT INTO telegram_chats (chat_id, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (chat_id) DO UPDATE
       SET data = EXCLUDED.data,
           updated_at = EXCLUDED.updated_at`,
      [record.chat_id, record, record.created_at, nowIso()],
    );

    return record;
  }

  async listChats() {
    const result = await this.pool.query('SELECT data FROM telegram_chats ORDER BY created_at ASC');
    return result.rows.map((row) => jsonData(row.data));
  }

  async insertConversion(payload) {
    const event = normalizeConversion(payload);
    if (!event.status) {
      return { inserted: false, reason: 'missing_status', event };
    }
    if (!event.sub_id_5) {
      return { inserted: false, reason: 'missing_sub_id_5', event };
    }

    const result = await this.pool.query(
      `INSERT INTO conversions (
         key, status, previous_status, sub_id_5, postback_datetime, sale_datetime, created_at, data
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [
        event.key,
        event.status,
        event.previous_status,
        event.sub_id_5,
        event.postback_datetime,
        event.sale_datetime,
        event.created_at,
        event,
      ],
    );

    if (!result.rowCount) {
      return { inserted: false, reason: 'duplicate', event };
    }

    return { inserted: true, event };
  }

  async logWebhook(record) {
    const entry = {
      ...record,
      created_at: nowIso(),
    };
    await this.pool.query(
      `INSERT INTO webhook_logs (status_code, message, created_at, data)
       VALUES ($1, $2, $3, $4)`,
      [Number(entry.status_code || 0), clean(entry.message), entry.created_at, entry],
    );
    return entry;
  }

  async conversionRows({ status = '', dateYmd = '', limit = 0 } = {}) {
    const params = [];
    const where = [];
    const wantedStatus = normalizeStatus(status);

    if (wantedStatus === 'sale') {
      where.push("(status = 'sale' OR previous_status = 'sale')");
    } else if (wantedStatus) {
      params.push(wantedStatus);
      where.push(`status = $${params.length}`);
    }

    if (dateYmd) {
      params.push(`${clean(dateYmd)}%`);
      where.push(`(
        CASE
          WHEN status = 'sale' OR previous_status = 'sale'
            THEN COALESCE(NULLIF(sale_datetime, ''), postback_datetime)
          ELSE COALESCE(NULLIF(postback_datetime, ''), sale_datetime)
        END
      ) LIKE $${params.length}`);
    }

    const limitSql = limit ? `LIMIT $${params.length + 1}` : '';
    if (limit) params.push(cleanLimit(limit));
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT data FROM conversions ${whereSql} ORDER BY created_at DESC ${limitSql}`,
      params,
    );
    return result.rows.map((row) => jsonData(row.data));
  }

  async listConversions({ limit = 20, status = '', dateYmd = '' } = {}) {
    const rows = await this.conversionRows({ status, dateYmd, limit: Math.max(cleanLimit(limit) * 5, 100) });
    return filterConversions(rows, { limit, status, dateYmd });
  }

  async statsForDate(dateYmd) {
    const rows = await this.conversionRows();
    return statsForDateFromRows(rows, dateYmd);
  }

  async statsForSub5(sub5, dateYmd = '', options = {}) {
    const key = clean(sub5);
    const result = await this.pool.query(
      `SELECT data
       FROM conversions
       WHERE sub_id_5 = $1 OR data->>'campaign' = $1
       ORDER BY created_at ASC`,
      [key],
    );
    const rows = result.rows
      .map((row) => jsonData(row.data))
      .filter((event) => effectiveSub5(event) === key);
    return statsForSub5FromRows(rows, key, dateYmd, options);
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

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO facebook_imports (import_id, imported_at, data)
         VALUES ($1, $2, $3)`,
        [importRecord.import_id, importedAt, importRecord],
      );

      for (const row of importBatch.rows) {
        const record = {
          ...row,
          import_id: importBatch.importId,
          imported_at: importedAt,
        };
        await client.query(
          `INSERT INTO facebook_spend (
             import_id, imported_at, date_ymd, sub5, account_id, currency, data
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            record.import_id,
            record.imported_at,
            clean(record.dateYmd),
            clean(record.sub5),
            clean(record.accountId),
            clean(record.currency || importBatch.currency || 'USD'),
            record,
          ],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return importRecord;
  }

  async listFacebookImports({ limit = 20 } = {}) {
    const result = await this.pool.query(
      `SELECT data FROM facebook_imports
       ORDER BY imported_at DESC, id DESC
       LIMIT $1`,
      [cleanLimit(limit)],
    );
    return result.rows.map((row) => jsonData(row.data));
  }

  async getFacebookImport(importId) {
    const id = clean(importId);
    const importResult = await this.pool.query(
      `SELECT data FROM facebook_imports
       WHERE import_id = $1
       ORDER BY imported_at DESC, id DESC
       LIMIT 1`,
      [id],
    );
    const record = jsonData(importResult.rows[0]?.data, null);
    if (!record) return null;

    const rowsResult = await this.pool.query(
      'SELECT data FROM facebook_spend WHERE import_id = $1',
      [id],
    );
    const rows = rowsResult.rows
      .map((row) => jsonData(row.data))
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
    await this.pool.query(
      `INSERT INTO facebook_imports (import_id, imported_at, data)
       VALUES ($1, $2, $3)`,
      [record.import_id, record.imported_at, record],
    );
    return record;
  }

  async facebookSpendRows(dateYmd = '') {
    const params = [];
    const whereSql = clean(dateYmd) ? 'WHERE date_ymd = $1' : '';
    if (whereSql) params.push(clean(dateYmd));
    const result = await this.pool.query(
      `SELECT data FROM facebook_spend ${whereSql}`,
      params,
    );
    return result.rows.map((row) => jsonData(row.data));
  }

  async facebookSpendForDate(dateYmd) {
    const rows = await this.facebookSpendRows(dateYmd);
    return latestFacebookSpendRows(rows, dateYmd);
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
    const rows = await this.facebookSpendRows(dateYmd);
    return facebookSpendSnapshotIndexFromRows(rows, dateYmd);
  }

  async close() {
    await this.pool.end();
  }
}
