export const DEFAULT_BASE_URL = 'https://ibrkeit.xyz';
export const DEFAULT_TIMEZONE = 'Asia/Yerevan';
export const DEFAULT_LIMIT = 1000;

const CSV_SEPARATOR = ';';

const COLUMNS = [
  'conversion_id',
  'postback_datetime',
  'sale_datetime',
  'status',
  'original_status',
  'previous_status',
  'sub_id',
  'campaign',
  'offer',
  'revenue',
  'sub_id_1',
  'sub_id_2',
  'sub_id_3',
  'sub_id_4',
  'sub_id_5',
  'sub_id_6',
];

const MONTHS = new Map([
  ['января', 1], ['январь', 1],
  ['февраля', 2], ['февраль', 2],
  ['марта', 3], ['март', 3],
  ['апреля', 4], ['апрель', 4],
  ['мая', 5], ['май', 5],
  ['июня', 6], ['июнь', 6],
  ['июля', 7], ['июль', 7],
  ['августа', 8], ['август', 8],
  ['сентября', 9], ['сентябрь', 9],
  ['октября', 10], ['октябрь', 10],
  ['ноября', 11], ['ноябрь', 11],
  ['декабря', 12], ['декабрь', 12],
]);

export class ApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.details = details;
  }
}

export function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function moneyValue(value) {
  const amount = Number(String(value ?? 0).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function formatMoney(value) {
  return moneyValue(value).toFixed(2);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isMacroValue(value) {
  const text = clean(value);
  if (!text) return false;
  const decoded = clean(safeDecode(text));
  return /^\{.+\}$/.test(decoded);
}

export function looksLikeSub5(value) {
  const text = clean(value);
  return Boolean(text && !isMacroValue(text) && text.includes('|') && text.split('|').length >= 5);
}

export function effectiveSub5(row = {}) {
  const primary = clean(row.sub_id_5 || row.sub5 || row.sub_id5);
  if (primary && !isMacroValue(primary)) return primary;

  const fallback = [row.campaign, row.campaign_name, row.campaignName]
    .map(clean)
    .find(looksLikeSub5);

  return fallback || '';
}

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function normalizeBaseUrl(value) {
  return clean(value).replace(/\/+$/, '');
}

export function parseTargetDate(input) {
  const source = clean(input).toLowerCase();
  const currentYear = new Date().getFullYear();

  let match = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
  }

  match = source.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/);
  if (match) {
    const year = match[3]
      ? Number(match[3].length === 2 ? `20${match[3]}` : match[3])
      : currentYear;
    return { year, month: Number(match[2]), day: Number(match[1]) };
  }

  match = source.match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?$/i);
  if (match) {
    const month = MONTHS.get(match[2]);
    if (month) {
      return {
        year: match[3] ? Number(match[3]) : currentYear,
        month,
        day: Number(match[1]),
      };
    }
  }

  throw new Error(`Не понял дату "${input}". Используй "2026-05-26", "26.05.2026" или "26 мая 2026".`);
}

export function parseRelativeDate(input, now = new Date()) {
  const source = clean(input).toLowerCase();
  const local = new Date(now);

  if (source === 'today' || source === 'сегодня') {
    return {
      year: local.getFullYear(),
      month: local.getMonth() + 1,
      day: local.getDate(),
    };
  }

  if (source === 'yesterday' || source === 'вчера') {
    local.setDate(local.getDate() - 1);
    return {
      year: local.getFullYear(),
      month: local.getMonth() + 1,
      day: local.getDate(),
    };
  }

  return parseTargetDate(input);
}

export function parseRowDate(value) {
  const source = clean(value).toLowerCase();

  let match = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
  }

  match = source.match(/^(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if (match) {
    const month = MONTHS.get(match[2]);
    if (month) {
      return {
        year: Number(match[3]),
        month,
        day: Number(match[1]),
      };
    }
  }

  return null;
}

export function parseRowDateTime(value) {
  const source = clean(value).toLowerCase();

  let match = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4] || 0),
      minute: Number(match[5] || 0),
      second: Number(match[6] || 0),
    };
  }

  match = source.match(/^(\d{1,2})\s+([а-яё]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/i);
  if (match) {
    const month = MONTHS.get(match[2]);
    if (month) {
      return {
        year: Number(match[3]),
        month,
        day: Number(match[1]),
        hour: Number(match[4] || 0),
        minute: Number(match[5] || 0),
        second: Number(match[6] || 0),
      };
    }
  }

  return null;
}

export function sameDay(value, targetDate) {
  const rowDate = parseRowDate(value);
  return Boolean(
    rowDate
    && rowDate.year === targetDate.year
    && rowDate.month === targetDate.month
    && rowDate.day === targetDate.day
  );
}

function normalizeStartHour(value) {
  const hour = Number(value);
  if (!Number.isFinite(hour)) return 0;
  return Math.min(23, Math.max(0, Math.trunc(hour)));
}

function dateTimeToEpochSeconds(date, hour = 0, minute = 0, second = 0) {
  return Date.UTC(date.year, date.month - 1, date.day, hour, minute, second) / 1000;
}

export function buildDayWindow(targetDate, startHour = 0) {
  const hour = normalizeStartHour(startHour);
  const endDate = hour === 0 ? targetDate : shiftDate(targetDate, 1);
  const endHour = hour === 0 ? 23 : hour - 1;
  const nextDate = shiftDate(targetDate, 1);
  return {
    startHour: hour,
    startDateTime: `${toYmd(targetDate)} ${pad2(hour)}:00:00`,
    endDateTime: `${toYmd(endDate)} ${pad2(endHour)}:59:59`,
    nextStartDateTime: `${toYmd(nextDate)} ${pad2(hour)}:00:00`,
  };
}

export function isInDayWindow(value, targetDate, startHour = 0) {
  const rowDate = parseRowDateTime(value);
  if (!rowDate) return false;

  const hour = normalizeStartHour(startHour);
  const nextDate = shiftDate(targetDate, 1);
  const rowSeconds = dateTimeToEpochSeconds(rowDate, rowDate.hour, rowDate.minute, rowDate.second);
  const startSeconds = dateTimeToEpochSeconds(targetDate, hour);
  const nextStartSeconds = dateTimeToEpochSeconds(nextDate, hour);
  return rowSeconds >= startSeconds && rowSeconds < nextStartSeconds;
}

export function toYmd(date) {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

export function shiftDate(date, days) {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day));
  value.setUTCDate(value.getUTCDate() + days);
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

export function todayYmd() {
  return toYmd(parseRelativeDate('today'));
}

export function yesterdayYmd() {
  return toYmd(parseRelativeDate('yesterday'));
}

export function parseSub5(sub5) {
  const parts = clean(sub5).split('|');
  return {
    raw: clean(sub5),
    launchDate: parts[0] || '',
    geo: parts[1] || '',
    buyer: parts[2] || '',
    accountId: parts[3] || '',
    creative: parts[4] || '',
    funnel: parts[5] || '',
    campaignType: parts[6] || '',
    adNumber: parts[7] || '',
  };
}

function normalizeRow(row, columns, meta) {
  if (!Array.isArray(row)) return row;
  const keys = Array.isArray(meta) && meta.every((item) => typeof item === 'string')
    ? meta
    : columns;
  return Object.fromEntries(keys.map((key, index) => [key, row[index]]));
}

function getStatus(row) {
  return clean(row.status || row.original_status).toLowerCase();
}

function getPreviousStatus(row) {
  return clean(row.previous_status).toLowerCase();
}

function isLeadOrSale(status) {
  return status === 'lead' || status === 'sale';
}

function isSale(status) {
  return status === 'sale';
}

function isRecoveredSale(row) {
  return getPreviousStatus(row) === 'sale' && !isSale(getStatus(row));
}

function conversionKey(row) {
  return clean(row.conversion_id || row.sub_id || `${row.sub_id_5}|${row.postback_datetime}|${row.sale_datetime}`);
}

async function requestJson(endpoint, apiKey, payload) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new ApiError(`API вернул ${response.status}: ${text.slice(0, 500)}`, {
      status: response.status,
      responseText: text,
    });
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ApiError(`API вернул не JSON: ${text.slice(0, 500)}`, {
      cause: error,
      responseText: text,
    });
  }
}

export async function fetchConversionLog({ baseUrl, apiKey, payload, label, limit, verbose }) {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/admin_api/v1/conversions/log`;
  const allRows = [];
  let offset = 0;
  let total = null;

  for (;;) {
    const body = {
      columns: COLUMNS,
      ...payload,
      limit,
      offset,
    };

    const data = await requestJson(endpoint, apiKey, body);
    const batch = (data.rows || []).map((row) => normalizeRow(row, body.columns, data.meta));
    allRows.push(...batch);

    total = Number.isFinite(Number(data.total)) ? Number(data.total) : null;
    if (verbose) {
      const totalText = total == null ? '?' : total;
      console.error(`${label}: loaded ${allRows.length}/${totalText}`);
    }

    if (!batch.length || batch.length < limit) break;
    if (total != null && allRows.length >= total) break;
    offset += limit;
  }

  return allRows;
}

function addToGroup(grouped, sub5, field) {
  const key = clean(sub5);
  if (!key || isMacroValue(key)) return;
  const item = grouped.get(key) || { sub5: key, regs: 0, deps: 0 };
  item[field] += 1;
  grouped.set(key, item);
}

function addUniqueToGroup(grouped, seen, row, field) {
  const key = conversionKey(row);
  if (key && seen.has(key)) return false;
  if (key) seen.add(key);
  addToGroup(grouped, row.sub_id_5, field);
  return true;
}

function normalizeReportGroupBy(value) {
  return ['offer', 'account'].includes(value) ? value : 'sub5';
}

function groupField(groupBy) {
  if (groupBy === 'offer') return 'offer';
  if (groupBy === 'account') return 'accountId';
  return 'sub5';
}

function rowGroupValue(row, groupBy) {
  if (groupBy === 'offer') return clean(row.offer);
  if (groupBy === 'account') {
    const parsed = parseSub5(effectiveSub5(row));
    const accountId = clean(row.account_id || row.accountId || parsed.accountId);
    return /^\d+$/.test(accountId) ? accountId : 'unknown';
  }
  return effectiveSub5(row);
}

function addToReportGroup(grouped, row, field, groupBy) {
  const key = rowGroupValue(row, groupBy);
  if (!key || isMacroValue(key)) return;
  const property = groupField(groupBy);
  const item = grouped.get(key) || { [property]: key, regs: 0, deps: 0, revenue: 0 };
  item[field] += 1;
  if (field === 'deps') {
    item.revenue += moneyValue(row.revenue);
  }
  grouped.set(key, item);
}

function addUniqueToReportGroup(grouped, seen, row, field, groupBy) {
  const key = conversionKey(row);
  if (key && seen.has(key)) return false;
  if (key) seen.add(key);
  addToReportGroup(grouped, row, field, groupBy);
  return true;
}

function escapeCsv(value, separator = CSV_SEPARATOR, alwaysQuote = false) {
  const text = String(value ?? '');
  const shouldQuote = (
    alwaysQuote
    || text.includes(separator)
    || text.includes('|')
    || text.includes('"')
    || /[\r\n]/.test(text)
  );
  if (!shouldQuote) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function makeCsv(rows) {
  const header = [
    'Название кампании(саб 5)',
    'количество рег(лид + продажа)',
    'депов(количество продаж)',
  ];
  return [header, ...rows.map((row) => [row.sub5, row.regs, row.deps])]
    .map((row) => row.map((value) => escapeCsv(value)).join(CSV_SEPARATOR))
    .join('\r\n');
}

export function makeOfferCsv(rows) {
  const header = [
    'Оффер',
    'Выплата',
    'Количество',
    'Общий доход',
  ];

  const saleRows = rows.filter((row) => Number(row.deps || 0) > 0 || moneyValue(row.revenue) > 0);
  const bodyRows = saleRows.map((row) => {
    const quantity = Number(row.deps || 0);
    const revenue = moneyValue(row.revenue);
    const payout = quantity ? revenue / quantity : 0;
    return [row.offer, formatMoney(payout), quantity, formatMoney(revenue)];
  });
  const totalQuantity = bodyRows.reduce((sum, row) => sum + Number(row[2] || 0), 0);
  const totalRevenue = saleRows.reduce((sum, row) => sum + moneyValue(row.revenue), 0);

  return [
    header,
    ...bodyRows,
    ['ВСЕГО', '-', totalQuantity, formatMoney(totalRevenue)],
  ]
    .map((row, rowIndex) => row.map((value, columnIndex) => (
      escapeCsv(value, ',', rowIndex > 0 && (columnIndex === 0 || value === '-'))
    )).join(','))
    .join('\r\n');
}

export function makeAccountCsv(rows) {
  const header = [
    'Account ID',
    'Regs',
    'Deps',
    'Revenue',
  ];
  return [header, ...rows.map((row) => [
    row.accountId,
    row.regs,
    row.deps,
    formatMoney(row.revenue),
  ])]
    .map((row) => row.map((value) => escapeCsv(value)).join(CSV_SEPARATOR))
    .join('\r\n');
}

function makeReportCsv(groupBy, rows) {
  if (groupBy === 'offer') return makeOfferCsv(rows);
  if (groupBy === 'account') return makeAccountCsv(rows);
  return makeCsv(rows);
}

async function fetchRegRowsWithFallback(options, regPayload) {
  const dateFilter = regPayload.filters[1] || {};
  try {
    return await fetchConversionLog({ ...options, payload: regPayload, label: 'Реги' });
  } catch (error) {
    if (!(error instanceof ApiError) || error.details.status !== 406) throw error;

    console.error('Keitaro не принял фильтр postback_datetime через BETWEEN для регов, пробую >= и <=.');
    const fallbackPayload = {
      ...regPayload,
      filters: [
        { name: 'status', operator: 'IN_LIST', expression: ['lead', 'sale'] },
        {
          name: 'postback_datetime',
          operator: 'EQUALS_OR_GREATER_THAN',
          expression: dateFilter.expression[0],
        },
        {
          name: 'postback_datetime',
          operator: 'EQUALS_OR_LESS_THAN',
          expression: dateFilter.expression[1],
        },
      ],
    };

    return fetchConversionLog({ ...options, payload: fallbackPayload, label: 'Реги' });
  }
}

async function fetchSalesWithFallback(options, salePayload) {
  const dateFilter = salePayload.filters[1] || {};
  const dateField = dateFilter.name || 'sale_datetime';
  try {
    return await fetchConversionLog({ ...options, payload: salePayload, label: 'Депы' });
  } catch (error) {
    if (!(error instanceof ApiError) || error.details.status !== 406) throw error;

    console.error(`Keitaro не принял фильтр ${dateField} через BETWEEN, пробую >= и <=.`);
    const fallbackPayload = {
      ...salePayload,
      filters: [
        { name: 'status', operator: 'EQUALS', expression: 'sale' },
        {
          name: dateField,
          operator: 'EQUALS_OR_GREATER_THAN',
          expression: dateFilter.expression[0],
        },
        {
          name: dateField,
          operator: 'EQUALS_OR_LESS_THAN',
          expression: dateFilter.expression[1],
        },
      ],
    };

    return fetchConversionLog({ ...options, payload: fallbackPayload, label: 'Депы' });
  }
}

async function fetchRecoveredSalesWithFallback(options, recoveredPayload) {
  try {
    return await fetchConversionLog({ ...options, payload: recoveredPayload, label: 'Recovered deps' });
  } catch (error) {
    if (!(error instanceof ApiError) || error.details.status !== 406) throw error;

    console.error('Keitaro не принял фильтр postback_datetime через BETWEEN для previous_status=sale, пробую >= и <=.');
    const fallbackPayload = {
      ...recoveredPayload,
      filters: [
        { name: 'previous_status', operator: 'EQUALS', expression: 'sale' },
        {
          name: 'postback_datetime',
          operator: 'EQUALS_OR_GREATER_THAN',
          expression: recoveredPayload.filters[1].expression[0],
        },
        {
          name: 'postback_datetime',
          operator: 'EQUALS_OR_LESS_THAN',
          expression: recoveredPayload.filters[1].expression[1],
        },
      ],
    };

    return fetchConversionLog({ ...options, payload: fallbackPayload, label: 'Recovered deps' });
  }
}

async function fetchSub5RowsWithFallback(options, sub5, timezone) {
  const payload = {
    range: {
      interval: 'all_time',
      timezone,
    },
    filters: [
      { name: 'sub_id_5', operator: 'EQUALS', expression: sub5 },
    ],
    sort: [{ name: 'postback_datetime', order: 'ASC' }],
  };

  try {
    return await fetchConversionLog({ ...options, payload, label: 'Sub5' });
  } catch (error) {
    if (!(error instanceof ApiError) || error.details.status !== 406) throw error;

    console.error('Keitaro не принял фильтр sub_id_5 через EQUALS, пробую CONTAINS и точный отсев в коде.');
    const fallbackRows = await fetchConversionLog({
      ...options,
      label: 'Sub5',
      payload: {
        ...payload,
        filters: [
          { name: 'sub_id_5', operator: 'CONTAINS', expression: sub5 },
        ],
      },
    });
    return fallbackRows.filter((row) => clean(row.sub_id_5) === clean(sub5));
  }
}

async function fetchCampaignRowsWithFallback(options, sub5, timezone) {
  const payload = {
    range: {
      interval: 'all_time',
      timezone,
    },
    filters: [
      { name: 'campaign', operator: 'EQUALS', expression: sub5 },
    ],
    sort: [{ name: 'postback_datetime', order: 'ASC' }],
  };

  try {
    return await fetchConversionLog({ ...options, payload, label: 'Campaign fallback' });
  } catch (error) {
    if (!(error instanceof ApiError) || error.details.status !== 406) return [];

    const fallbackRows = await fetchConversionLog({
      ...options,
      label: 'Campaign fallback',
      payload: {
        ...payload,
        filters: [
          { name: 'campaign', operator: 'CONTAINS', expression: sub5 },
        ],
      },
    }).catch(() => []);
    return fallbackRows.filter((row) => effectiveSub5(row) === clean(sub5));
  }
}

export async function buildSub5Summary(config) {
  const sub5 = clean(config.sub5);
  if (!sub5) throw new Error('Не указан sub5.');
  const targetDate = config.date ? parseRelativeDate(config.date) : null;
  const dateYmd = targetDate ? toYmd(targetDate) : '';
  const startHour = normalizeStartHour(config.startHour ?? config.windowStartHour ?? 0);
  const timeWindow = targetDate ? buildDayWindow(targetDate, startHour) : null;
  const inWindow = (value) => (
    targetDate ? isInDayWindow(value, targetDate, startHour) : true
  );

  let rows = await fetchSub5RowsWithFallback({
    baseUrl: normalizeBaseUrl(config.baseUrl || DEFAULT_BASE_URL),
    apiKey: config.apiKey,
    limit: config.limit || DEFAULT_LIMIT,
    verbose: config.verbose,
  }, sub5, config.timezone || DEFAULT_TIMEZONE);

  let exactRows = rows.filter((row) => effectiveSub5(row) === sub5);
  if (!exactRows.length) {
    const campaignRows = await fetchCampaignRowsWithFallback({
      baseUrl: normalizeBaseUrl(config.baseUrl || DEFAULT_BASE_URL),
      apiKey: config.apiKey,
      limit: config.limit || DEFAULT_LIMIT,
      verbose: config.verbose,
    }, sub5, config.timezone || DEFAULT_TIMEZONE);
    rows = [...rows, ...campaignRows];
    exactRows = rows.filter((row) => effectiveSub5(row) === sub5);
  }
  const scopedRows = targetDate
    ? exactRows.filter((row) => (
      inWindow(row.postback_datetime)
      || inWindow(row.sale_datetime)
    ))
    : exactRows;
  const regRows = targetDate
    ? exactRows.filter((row) => isLeadOrSale(getStatus(row)) && inWindow(row.postback_datetime))
    : exactRows.filter((row) => isLeadOrSale(getStatus(row)));
  const depRows = targetDate
    ? exactRows.filter((row) => isSale(getStatus(row)) && inWindow(row.sale_datetime))
    : exactRows.filter((row) => isSale(getStatus(row)));
  const recoveredDepRows = targetDate
    ? exactRows.filter((row) => isRecoveredSale(row) && inWindow(row.postback_datetime))
    : exactRows.filter((row) => isRecoveredSale(row));
  const depSeen = new Set(depRows.map(conversionKey).filter(Boolean));
  const uniqueRecoveredDepRows = recoveredDepRows.filter((row) => {
    const key = conversionKey(row);
    if (key && depSeen.has(key)) return false;
    if (key) depSeen.add(key);
    return true;
  });
  const lateDepRows = targetDate
    ? depRows.filter((row) => !inWindow(row.postback_datetime))
    : [];
  const allDepRows = [...depRows, ...uniqueRecoveredDepRows];
  const revenue = allDepRows.reduce((sum, row) => {
    const value = Number(String(row.revenue ?? 0).replace(',', '.').replace(/[^\d.-]/g, ''));
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const allTimeRegs = exactRows.filter((row) => isLeadOrSale(getStatus(row))).length;
  const allTimeNormalDeps = exactRows.filter((row) => isSale(getStatus(row))).length;
  const allTimeRecoveredDeps = exactRows.filter((row) => isRecoveredSale(row)).length;

  return {
    sub5,
    dateYmd,
    timeWindow,
    rows: scopedRows,
    allRows: exactRows,
    sourceRows: rows.length,
    regs: regRows.length,
    deps: allDepRows.length,
    normalDeps: depRows.length,
    recoveredDeps: uniqueRecoveredDepRows.length,
    lateDeps: lateDepRows.length,
    revenue,
    allTimeRegs,
    allTimeDeps: allTimeNormalDeps + allTimeRecoveredDeps,
    allTimeRecoveredDeps,
  };
}

export async function buildReport(config) {
  const groupBy = normalizeReportGroupBy(config.groupBy);
  const targetDate = parseRelativeDate(config.date);
  const dateYmd = toYmd(targetDate);
  const startHour = normalizeStartHour(config.startHour ?? config.windowStartHour ?? 0);
  const timeWindow = buildDayWindow(targetDate, startHour);
  const { startDateTime, endDateTime } = timeWindow;
  const regLookbackDays = Number.isFinite(Number(config.regLookbackDays))
    ? Math.max(1, Math.trunc(Number(config.regLookbackDays)))
    : 30;
  const apiQueryStartDateTime = `${toYmd(shiftDate(targetDate, -regLookbackDays))} 00:00:00`;
  const grouped = new Map();

  const baseOptions = {
    baseUrl: normalizeBaseUrl(config.baseUrl || DEFAULT_BASE_URL),
    apiKey: config.apiKey,
    limit: config.limit || DEFAULT_LIMIT,
    verbose: config.verbose,
  };

  const regRows = await fetchRegRowsWithFallback(baseOptions, {
    range: {
      timezone: config.timezone || DEFAULT_TIMEZONE,
      interval: 'all_time',
    },
    filters: [
      { name: 'status', operator: 'IN_LIST', expression: ['lead', 'sale'] },
      { name: 'postback_datetime', operator: 'BETWEEN', expression: [startDateTime, endDateTime] },
    ],
    sort: [{ name: 'postback_datetime', order: 'ASC' }],
  });

  const saleRows = await fetchSalesWithFallback(baseOptions, {
    range: {
      interval: 'all_time',
      timezone: config.timezone || DEFAULT_TIMEZONE,
    },
    filters: [
      { name: 'status', operator: 'EQUALS', expression: 'sale' },
      { name: 'sale_datetime', operator: 'BETWEEN', expression: [startDateTime, endDateTime] },
    ],
    sort: [{ name: 'sale_datetime', order: 'ASC' }],
  });

  const recoveredSaleRows = await fetchRecoveredSalesWithFallback(baseOptions, {
    range: {
      interval: 'all_time',
      timezone: config.timezone || DEFAULT_TIMEZONE,
    },
    filters: [
      { name: 'previous_status', operator: 'EQUALS', expression: 'sale' },
      { name: 'postback_datetime', operator: 'BETWEEN', expression: [apiQueryStartDateTime, endDateTime] },
    ],
    sort: [{ name: 'postback_datetime', order: 'ASC' }],
  });

  for (const row of regRows) {
    const status = getStatus(row);
    if (isLeadOrSale(status) && isInDayWindow(row.postback_datetime, targetDate, startHour)) {
      addToReportGroup(grouped, row, 'regs', groupBy);
    }
  }

  const depSeen = new Set();
  const sameDaySaleRows = saleRows.filter((row) => (
    isSale(getStatus(row)) && isInDayWindow(row.sale_datetime, targetDate, startHour)
  ));

  for (const row of sameDaySaleRows) {
    addUniqueToReportGroup(grouped, depSeen, row, 'deps', groupBy);
  }

  let recoveredDeps = 0;
  const sameDayRecoveredSaleRows = recoveredSaleRows.filter((row) => (
    isRecoveredSale(row) && isInDayWindow(row.sale_datetime || row.postback_datetime, targetDate, startHour)
  ));

  for (const row of sameDayRecoveredSaleRows) {
    if (addUniqueToReportGroup(grouped, depSeen, row, 'deps', groupBy)) {
      recoveredDeps += 1;
    }
  }

  const property = groupField(groupBy);
  const allRows = [...grouped.values()].sort((a, b) => (
    a[property].localeCompare(b[property], undefined, { numeric: true, sensitivity: 'base' })
  ));
  const rows = groupBy === 'offer'
    ? allRows.filter((row) => Number(row.deps || 0) > 0 || moneyValue(row.revenue) > 0)
    : allRows;

  const regs = rows.reduce((sum, row) => sum + row.regs, 0);
  const deps = rows.reduce((sum, row) => sum + row.deps, 0);
  const revenue = rows.reduce((sum, row) => sum + moneyValue(row.revenue), 0);

  return {
    dateYmd,
    groupBy,
    timeWindow: {
      ...timeWindow,
      startHour,
      regLookbackDays,
    },
    rows,
    csv: makeReportCsv(groupBy, rows),
    counts: {
      regSourceRows: regRows.length,
      saleSourceRows: sameDaySaleRows.length,
      saleLoadedRows: saleRows.length,
      recoveredSaleSourceRows: sameDayRecoveredSaleRows.length,
      recoveredSaleLoadedRows: recoveredSaleRows.length,
      groups: rows.length,
      regs,
      deps,
      revenue,
      recoveredDeps,
      cr: regs ? deps / regs : 0,
    },
  };
}

export async function buildOfferReport(config) {
  return buildReport({ ...config, groupBy: 'offer' });
}

export async function buildAccountReport(config) {
  return buildReport({ ...config, groupBy: 'account' });
}

export function summarizeReport(report) {
  const cr = (report.counts.cr * 100).toFixed(1);
  const title = report.groupBy === 'offer'
    ? 'Offer report'
    : report.groupBy === 'account'
      ? 'Account report'
      : 'Report';
  const windowLabel = report.timeWindow?.startDateTime && report.timeWindow?.endDateTime
    ? `Window: ${report.timeWindow.startDateTime} - ${report.timeWindow.endDateTime} Keitaro`
    : 'Window: all_time Keitaro';
  if (report.groupBy === 'offer') {
    return [
      `${title} ${report.dateYmd}`,
      windowLabel,
      `Offers: ${report.counts.groups}`,
      `Quantity: ${report.counts.deps}`,
      `Revenue: ${formatMoney(report.counts.revenue)}`,
      `Recovered deps: ${report.counts.recoveredDeps} (previous_status=sale rows: ${report.counts.recoveredSaleSourceRows})`,
    ].join('\n');
  }

  if (report.groupBy === 'account') {
    return [
      `${title} ${report.dateYmd}`,
      windowLabel,
      `Accounts: ${report.counts.groups}`,
      `Regs: ${report.counts.regs} (source rows: ${report.counts.regSourceRows})`,
      `Deps: ${report.counts.deps} (source rows: ${report.counts.saleSourceRows})`,
      `Revenue: ${formatMoney(report.counts.revenue)}`,
      `Recovered deps: ${report.counts.recoveredDeps} (previous_status=sale rows: ${report.counts.recoveredSaleSourceRows})`,
      `CR: ${cr}%`,
    ].join('\n');
  }

  return [
    `${title} ${report.dateYmd}`,
    windowLabel,
    `Groups: ${report.counts.groups}`,
    `Regs: ${report.counts.regs} (source rows: ${report.counts.regSourceRows})`,
    `Deps: ${report.counts.deps} (source rows: ${report.counts.saleSourceRows})`,
    `Revenue: ${formatMoney(report.counts.revenue)}`,
    `Recovered deps: ${report.counts.recoveredDeps} (previous_status=sale rows: ${report.counts.recoveredSaleSourceRows})`,
    `CR: ${cr}%`,
  ].join('\n');
}

export function formatSub5Details(sub5) {
  const parsed = parseSub5(sub5);
  return [
    `sub5: ${parsed.raw}`,
    `GEO: ${parsed.geo || '-'}`,
    `buyer: ${parsed.buyer || '-'}`,
    `account: ${parsed.accountId || '-'}`,
    `creative: ${parsed.creative || '-'}`,
    `funnel: ${parsed.funnel || '-'}`,
    `type: ${parsed.campaignType || '-'}`,
    `ad: ${parsed.adNumber || '-'}`,
  ].join('\n');
}
