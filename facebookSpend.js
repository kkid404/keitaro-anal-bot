import crypto from 'node:crypto';
import {
  buildDayWindow,
  clean,
  normalizeBaseUrl,
  parseRelativeDate,
  parseSub5,
} from './report.js';

const HEADER_ALIASES = {
  startDate: [
    'debut des rapports',
    'reporting starts',
    'report starts',
    'start date',
    'date start',
    'начало отчетов',
    'начало отчета',
  ],
  endDate: [
    'fin des rapports',
    'reporting ends',
    'report ends',
    'end date',
    'date stop',
    'конец отчетов',
    'конец отчета',
  ],
  campaign: [
    'nom de la campagne',
    'campaign name',
    'campaign',
    'название кампании',
    'кампания',
  ],
  spend: [
    'montant depense usd',
    'montant depense',
    'amount spent usd',
    'amount spent',
    'spend usd',
    'spend',
    'сумма затрат usd',
    'сумма затрат',
    'расход',
    'расходы',
  ],
  results: [
    'resultats',
    'results',
    'результаты',
  ],
  impressions: [
    'impressions',
    'показы',
  ],
  reach: [
    'couverture',
    'reach',
    'охват',
  ],
};

function normalizeHeader(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function countDelimiter(line, delimiter) {
  let count = 0;
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }
  return count;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || '';
  const options = [',', ';', '\t'];
  return options
    .map((delimiter) => ({ delimiter, count: countDelimiter(firstLine, delimiter) }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter || ',';
}

export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === '"') {
      if (inQuotes && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((item) => clean(item))) rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((item) => clean(item))) rows.push(row);
  return rows;
}

function headerIndex(headers, key) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const aliases = HEADER_ALIASES[key].map(normalizeHeader);
  for (const alias of aliases) {
    const exact = normalizedHeaders.indexOf(alias);
    if (exact !== -1) return exact;
  }
  for (let index = 0; index < normalizedHeaders.length; index += 1) {
    if (aliases.some((alias) => normalizedHeaders[index].includes(alias))) return index;
  }
  return -1;
}

export function parseNumber(value) {
  let text = clean(value).replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  if (!text) return 0;

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  if (hasComma && hasDot) {
    text = text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (hasComma) {
    text = text.replace(',', '.');
  }

  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function parseDateYmd(value) {
  const text = clean(value);
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  }

  match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
  }

  return '';
}

function currencyFromHeader(header, fallback) {
  const match = clean(header).match(/\(([A-Z]{3})\)/i);
  return (match?.[1] || fallback || 'USD').toUpperCase();
}

export function parseCampaignIds(value) {
  return clean(value)
    .split(/[,\s]+/)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

async function requestKeitaroJson({ baseUrl, apiKey, path, payload }) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': apiKey,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Keitaro API вернул ${response.status}: ${text.slice(0, 500)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function normalizeApiRows(data) {
  const meta = Array.isArray(data?.meta) ? data.meta : [];
  return (data?.rows || []).map((row) => {
    if (!Array.isArray(row)) return row;
    return Object.fromEntries(meta.map((key, index) => [key, row[index]]));
  });
}

function numberList(values) {
  return [...new Set(values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))];
}

function normalizeGroupName(value) {
  return clean(value).toLowerCase().replace(/\s+/g, ' ');
}

function normalizeCampaignRow(row) {
  return {
    campaignId: Number(row.campaign_id),
    campaign: clean(row.campaign),
    campaignGroup: clean(row.campaign_group),
    campaignGroupId: Number(row.campaign_group_id) || 0,
    clicks: Number(row.clicks || 0),
  };
}

function targetCampaignGroupForRow(row, campaignGroup) {
  const explicit = clean(campaignGroup);
  if (explicit) return explicit;
  return clean(row.buyer || parseSub5(row.sub5 || '').buyer);
}

function selectCampaignRowsForSpendRow(rows, spendRow, campaignGroup) {
  const targetGroup = targetCampaignGroupForRow(spendRow, campaignGroup);
  if (!targetGroup) return rows;

  const normalizedTarget = normalizeGroupName(targetGroup);
  return rows.filter((row) => normalizeGroupName(row.campaignGroup) === normalizedTarget);
}

async function reportRowsBySub5({ baseUrl, apiKey, sub5, timezone, operator = 'EQUALS' }) {
  const data = await requestKeitaroJson({
    baseUrl,
    apiKey,
    path: '/admin_api/v1/report/build',
    payload: {
      range: {
        interval: 'all_time',
        timezone,
      },
      dimensions: ['campaign_id', 'campaign', 'campaign_group_id', 'campaign_group', 'sub_id_5'],
      measures: ['clicks'],
      filters: [
        { name: 'sub_id_5', operator, expression: sub5 },
      ],
      sort: [{ name: 'clicks', order: 'DESC' }],
    },
  });

  return normalizeApiRows(data)
    .filter((row) => clean(row.sub_id_5) === clean(sub5) || operator !== 'EQUALS');
}

export async function findKeitaroCampaignsBySub5({
  baseUrl,
  apiKey,
  sub5,
  timezone,
}) {
  if (!apiKey) throw new Error('Не найден Keitaro API key.');
  const key = clean(sub5);
  if (!key) return [];

  let rows = [];
  try {
    rows = await reportRowsBySub5({
      baseUrl,
      apiKey,
      sub5: key,
      timezone,
      operator: 'EQUALS',
    });
  } catch (error) {
    if (!/406/.test(error.message)) throw error;
  }

  if (!rows.length) {
    rows = (await reportRowsBySub5({
      baseUrl,
      apiKey,
      sub5: key,
      timezone,
      operator: 'CONTAINS',
    })).filter((row) => clean(row.sub_id_5) === key);
  }

  return rows
    .map(normalizeCampaignRow)
    .filter((row) => Number.isInteger(row.campaignId) && row.campaignId > 0);
}

export async function findKeitaroCampaignIdsBySub5(options) {
  const rows = await findKeitaroCampaignsBySub5(options);
  return numberList(rows.map((row) => row.campaignId));
}

export async function resolveCampaignIdsForSpendRows({
  baseUrl,
  apiKey,
  spendRows,
  timezone,
  fallbackCampaignIds = [],
  campaignGroup = '',
  onProgress,
}) {
  const fallbackIds = numberList(fallbackCampaignIds);
  const cache = new Map();
  const resolvedRows = [];
  const unresolvedRows = [];
  const rows = spendRows || [];

  for (const [index, row] of rows.entries()) {
    const sub5 = clean(row.sub5);
    if (!sub5 || Number(row.spend || 0) <= 0) continue;

    if (!cache.has(sub5)) {
      await onProgress?.({
        stage: 'lookup',
        current: index + 1,
        total: rows.length,
        row,
      });
      const campaignRows = await findKeitaroCampaignsBySub5({
        baseUrl,
        apiKey,
        sub5,
        timezone,
      });
      cache.set(sub5, campaignRows);
    }

    const candidateCampaignRows = cache.get(sub5) || [];
    const selectedCampaignRows = selectCampaignRowsForSpendRow(candidateCampaignRows, row, campaignGroup);
    const selectedIds = numberList(selectedCampaignRows.map((campaign) => campaign.campaignId));
    const campaignIds = selectedIds.length ? selectedIds : (candidateCampaignRows.length ? [] : fallbackIds);
    if (!campaignIds.length) {
      unresolvedRows.push({
        ...row,
        targetCampaignGroup: targetCampaignGroupForRow(row, campaignGroup),
        candidateCampaigns: candidateCampaignRows,
      });
      continue;
    }
    resolvedRows.push({
      ...row,
      campaignIds,
      targetCampaignGroup: targetCampaignGroupForRow(row, campaignGroup),
      campaignRows: selectedCampaignRows,
      campaignIdSource: fallbackIds.length && campaignIds.join(',') === fallbackIds.join(',')
        ? 'fallback'
        : 'campaign_group',
    });
  }

  await onProgress?.({
    stage: 'resolved',
    total: rows.length,
    resolvedRows,
    unresolvedRows,
  });

  return {
    resolvedRows,
    unresolvedRows,
    ambiguousRows: [],
    campaignIds: numberList(resolvedRows.flatMap((row) => row.campaignIds)),
    campaignGroups: [...new Set(resolvedRows.map((row) => row.targetCampaignGroup).filter(Boolean))].sort(),
  };
}

export function parseFacebookSpendCsv(text, options = {}) {
  const csvRows = parseCsv(text);
  if (csvRows.length < 2) throw new Error('CSV пустой или без строк данных.');

  const headers = csvRows[0];
  const columns = {
    startDate: headerIndex(headers, 'startDate'),
    endDate: headerIndex(headers, 'endDate'),
    campaign: headerIndex(headers, 'campaign'),
    spend: headerIndex(headers, 'spend'),
    results: headerIndex(headers, 'results'),
    impressions: headerIndex(headers, 'impressions'),
    reach: headerIndex(headers, 'reach'),
  };

  if (columns.campaign === -1) throw new Error('Не нашел колонку campaign name / Nom de la campagne.');
  if (columns.spend === -1) throw new Error('Не нашел колонку spend / Montant dépensé.');

  const currency = currencyFromHeader(headers[columns.spend], options.currency);
  const grouped = new Map();
  let sourceRows = 0;

  for (const rawRow of csvRows.slice(1)) {
    const campaign = clean(rawRow[columns.campaign]);
    if (!campaign) continue;

    const dateYmd = parseDateYmd(rawRow[columns.startDate]) || options.dateYmd || '';
    if (!dateYmd) continue;

    const key = `${dateYmd}|${campaign}`;
    const parsed = parseSub5(campaign);
    const current = grouped.get(key) || {
      dateYmd,
      endDateYmd: parseDateYmd(rawRow[columns.endDate]) || dateYmd,
      sub5: campaign,
      campaignName: campaign,
      accountId: parsed.accountId,
      geo: parsed.geo,
      buyer: parsed.buyer,
      creative: parsed.creative,
      spend: 0,
      currency,
      results: 0,
      impressions: 0,
      reach: 0,
      sourceRows: 0,
    };

    current.spend += parseNumber(rawRow[columns.spend]);
    current.results += columns.results === -1 ? 0 : parseNumber(rawRow[columns.results]);
    current.impressions += columns.impressions === -1 ? 0 : parseNumber(rawRow[columns.impressions]);
    current.reach += columns.reach === -1 ? 0 : parseNumber(rawRow[columns.reach]);
    current.sourceRows += 1;
    sourceRows += 1;
    grouped.set(key, current);
  }

  const rows = [...grouped.values()]
    .map((row) => ({
      ...row,
      spend: Number(row.spend.toFixed(6)),
      results: Number(row.results.toFixed(6)),
      impressions: Number(row.impressions.toFixed(0)),
      reach: Number(row.reach.toFixed(0)),
    }))
    .sort((a, b) => a.sub5.localeCompare(b.sub5, undefined, { numeric: true, sensitivity: 'base' }));

  if (!rows.length) throw new Error('Не удалось извлечь ни одной строки расходов из CSV.');

  const dates = [...new Set(rows.map((row) => row.dateYmd))].sort();
  const importId = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

  return {
    importId,
    importedAt: new Date().toISOString(),
    sourceRows,
    rows,
    dates,
    currency,
    totalSpend: rows.reduce((sum, row) => sum + row.spend, 0),
    totalResults: rows.reduce((sum, row) => sum + row.results, 0),
  };
}

export function summarizeSpendRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totalSpend = safeRows.reduce((sum, row) => sum + Number(row.spend || 0), 0);
  const totalResults = safeRows.reduce((sum, row) => sum + Number(row.results || 0), 0);
  return {
    rows: safeRows.length,
    totalSpend,
    totalResults,
    dates: [...new Set(safeRows.map((row) => row.dateYmd).filter(Boolean))].sort(),
    currency: safeRows.find((row) => row.currency)?.currency || 'USD',
  };
}

export function buildKeitaroCostPayload({
  campaignIds,
  spendRows,
  timezone,
  currency,
  onlyCampaignUniques = true,
  windowStartHour = 0,
}) {
  const ids = Array.isArray(campaignIds) ? campaignIds : parseCampaignIds(campaignIds);
  if (!ids.length) throw new Error('Не заданы Keitaro campaign IDs для обновления costs.');

  const costs = (spendRows || [])
    .filter((row) => clean(row.sub5) && Number(row.spend) > 0 && clean(row.dateYmd))
    .map((row) => buildCost(row, timezone, currency, onlyCampaignUniques, windowStartHour));

  if (!costs.length) throw new Error('Нет строк с положительным spend для отправки в Keitaro.');

  return {
    campaign_ids: ids,
    currency: (currency || costs[0]?.currency || 'USD').toUpperCase(),
    timezone,
    costs,
  };
}

function buildCostWindow(row, windowStartHour = 0) {
  const startDate = parseRelativeDate(row.dateYmd);
  const endDate = parseRelativeDate(row.endDateYmd || row.dateYmd);
  return {
    startDateTime: buildDayWindow(startDate, windowStartHour).startDateTime,
    endDateTime: buildDayWindow(endDate, windowStartHour).endDateTime,
  };
}

function buildCost(row, timezone, currency, onlyCampaignUniques, windowStartHour = 0) {
  const window = buildCostWindow(row, windowStartHour);
  return {
    start_date: window.startDateTime,
    end_date: window.endDateTime,
    cost: Number(Number(row.spend).toFixed(6)),
    timezone,
    currency: (currency || row.currency || 'USD').toUpperCase(),
    only_campaign_uniques: onlyCampaignUniques ? 1 : 0,
    filters: {
      sub_id_5: row.sub5,
    },
  };
}

export function buildKeitaroCostJobs({
  spendRows,
  timezone,
  currency,
  onlyCampaignUniques = true,
  windowStartHour = 0,
}) {
  const grouped = new Map();
  for (const row of spendRows || []) {
    const campaignIds = numberList(row.campaignIds || []);
    if (!campaignIds.length) continue;
    if (!clean(row.sub5) || Number(row.spend || 0) <= 0 || !clean(row.dateYmd)) continue;
    const costCurrency = (currency || row.currency || 'USD').toUpperCase();
    const key = `${campaignIds.join(',')}|${costCurrency}`;
    const current = grouped.get(key) || { campaignIds, costs: [] };
    current.currency = costCurrency;
    current.costs.push(buildCost(row, timezone, costCurrency, onlyCampaignUniques, windowStartHour));
    grouped.set(key, current);
  }

  return [...grouped.values()].map(({ campaignIds, currency: jobCurrency, costs }) => ({
    campaign_ids: campaignIds,
    currency: jobCurrency,
    timezone,
    costs,
  }));
}

export function buildLegacyKeitaroCostJobs({
  campaignIds,
  spendRows,
  timezone,
  currency,
  onlyCampaignUniques = true,
  windowStartHour = 0,
}) {
  const ids = numberList(campaignIds || []);
  if (!ids.length) throw new Error('Не заданы Keitaro campaign IDs для обновления costs.');
  const costs = [];
  for (const row of spendRows || []) {
    if (!clean(row.sub5) || Number(row.spend || 0) <= 0 || !clean(row.dateYmd)) continue;
    costs.push(buildCost(row, timezone, currency, onlyCampaignUniques, windowStartHour));
  }

  return [{
    campaign_ids: ids,
    currency: (currency || costs[0]?.currency || 'USD').toUpperCase(),
    timezone,
    costs,
  }];
}

export async function pushFacebookCostsToKeitaro({
  baseUrl,
  apiKey,
  campaignIds,
  spendRows,
  timezone,
  currency,
  onlyCampaignUniques = true,
  campaignGroup = '',
  forceCampaignIds = false,
  onProgress,
  windowStartHour = 0,
}) {
  if (!apiKey) throw new Error('Не найден Keitaro API key.');

  if (forceCampaignIds) {
    const jobs = buildLegacyKeitaroCostJobs({
      campaignIds,
      spendRows,
      timezone,
      currency,
      onlyCampaignUniques,
      windowStartHour,
    });
    if (!jobs.some((job) => job.costs.length)) {
      throw new Error('Нет строк с положительным spend для отправки в Keitaro.');
    }

    const responses = [];
    for (const [index, payload] of jobs.entries()) {
      await onProgress?.({
        stage: 'send_job',
        current: index + 1,
        total: jobs.length,
        payload,
      });
      const data = await requestKeitaroJson({
        baseUrl,
        apiKey,
        path: '/admin_api/v1/clicks/update_costs',
        payload,
      });
      responses.push({ campaignIds: payload.campaign_ids, data });
    }

    return {
      data: responses,
      costRows: jobs.reduce((sum, job) => sum + job.costs.length, 0),
      totalCost: jobs.reduce((sum, job) => (
        sum + job.costs.reduce((jobSum, row) => jobSum + row.cost, 0)
      ), 0),
      campaignIds: numberList(campaignIds || []),
      unresolvedRows: [],
      ambiguousRows: [],
      jobs: jobs.length,
      manual: true,
    };
  }

  const resolution = await resolveCampaignIdsForSpendRows({
    baseUrl,
    apiKey,
    spendRows,
    timezone,
    fallbackCampaignIds: campaignIds,
    campaignGroup,
    onProgress,
  });

  const jobs = buildKeitaroCostJobs({
    spendRows: resolution.resolvedRows,
    timezone,
    currency,
    onlyCampaignUniques,
    windowStartHour,
  });

  if (!jobs.length) {
    throw new Error('Не нашел ни одной Keitaro campaign по sub_id_5 для отправки costs.');
  }

  const responses = [];
  for (const [index, payload] of jobs.entries()) {
    await onProgress?.({
      stage: 'send_job',
      current: index + 1,
      total: jobs.length,
      payload,
    });
    const data = await requestKeitaroJson({
      baseUrl,
      apiKey,
      path: '/admin_api/v1/clicks/update_costs',
      payload,
    });
    responses.push({ campaignIds: payload.campaign_ids, data });
  }

  return {
    data: responses,
    costRows: jobs.reduce((sum, job) => sum + job.costs.length, 0),
    totalCost: jobs.reduce((sum, job) => (
      sum + job.costs.reduce((jobSum, row) => jobSum + row.cost, 0)
    ), 0),
    campaignIds: resolution.campaignIds,
    campaignGroups: resolution.campaignGroups,
    unresolvedRows: resolution.unresolvedRows,
    ambiguousRows: resolution.ambiguousRows,
    jobs: jobs.length,
  };
}
