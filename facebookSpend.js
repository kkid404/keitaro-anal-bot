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

function createImportId() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

export function parseCampaignIds(value) {
  return clean(value)
    .split(/[,\s]+/)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

async function requestKeitaroJson({
  baseUrl,
  apiKey,
  path,
  payload,
  method = 'POST',
  query = {},
}) {
  const endpoint = new URL(`${normalizeBaseUrl(baseUrl)}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') {
      endpoint.searchParams.set(key, String(value));
    }
  }

  const requestOptions = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': apiKey,
    },
  };
  if (method !== 'GET') {
    requestOptions.body = JSON.stringify(payload || {});
  }

  const response = await fetch(endpoint, requestOptions);
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

function normalizeApiList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return normalizeApiRows(data);
  return [];
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

function normalizeCampaignListRow(row, groupNames = new Map()) {
  const campaignGroupId = Number(row.group_id || row.campaign_group_id) || 0;
  return {
    campaignId: Number(row.id || row.campaign_id),
    campaign: clean(row.name || row.campaign || row.alias),
    campaignGroup: clean(row.group || row.group_name || row.campaign_group || groupNames.get(campaignGroupId)),
    campaignGroupId,
    state: clean(row.state || 'active'),
  };
}

async function fetchKeitaroCampaignGroups({ baseUrl, apiKey }) {
  const data = await requestKeitaroJson({
    baseUrl,
    apiKey,
    method: 'GET',
    path: '/admin_api/v1/groups',
    query: { type: 'campaigns' },
  }).catch(() => []);
  return normalizeApiList(data);
}

async function fetchKeitaroCampaigns({ baseUrl, apiKey, limit = 1000 }) {
  const groups = await fetchKeitaroCampaignGroups({ baseUrl, apiKey });
  const groupNames = new Map(groups
    .map((group) => [Number(group.id), clean(group.name)])
    .filter(([id, name]) => Number.isInteger(id) && id > 0 && name));
  const campaigns = [];

  for (let offset = 0, page = 0; page < 20; offset += limit, page += 1) {
    const data = await requestKeitaroJson({
      baseUrl,
      apiKey,
      method: 'GET',
      path: '/admin_api/v1/campaigns',
      query: { limit, offset },
    });
    const batch = normalizeApiList(data)
      .map((row) => normalizeCampaignListRow(row, groupNames))
      .filter((row) => Number.isInteger(row.campaignId) && row.campaignId > 0 && row.campaign);
    campaigns.push(...batch);
    if (batch.length < limit) break;
  }

  return campaigns;
}

function stripCopyMarkers(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\b(для\s+коп\w*)\b/giu, ' ')
    .replace(/\b(copy|copies|copie|clone|duplicat\w*)\b/gu, ' ')
    .replace(/\b(копия|копии|копий|коп|дубль)\b/giu, ' ')
    .replace(/\b(для)\b/giu, ' ');
}

function matchTokens(value) {
  return stripCopyMarkers(value)
    .split(/[^\p{L}\p{N}]+/u)
    .map(clean)
    .filter((token) => token.length > 1);
}

function campaignMatchScore(source, candidate) {
  const sourceText = stripCopyMarkers(source);
  const candidateText = stripCopyMarkers(candidate);
  if (!sourceText || !candidateText) return 0;
  if (sourceText === candidateText) return 10;

  const sourceTokens = new Set(matchTokens(sourceText));
  const candidateTokens = new Set(matchTokens(candidateText));
  if (!sourceTokens.size || !candidateTokens.size) return 0;

  const overlap = [...sourceTokens].filter((token) => candidateTokens.has(token)).length;
  const union = new Set([...sourceTokens, ...candidateTokens]).size;
  const jaccard = union ? overlap / union : 0;
  const contains = sourceText.includes(candidateText) || candidateText.includes(sourceText) ? 1 : 0;
  return jaccard * 8 + contains * 2;
}

function candidateLabel(row) {
  return clean(row.campaign || row.campaignName || row.sub5 || '');
}

function selectGptCampaignCandidates(campaigns, spendRow, campaignGroup, limit = 40) {
  const targetGroup = targetCampaignGroupForRow(spendRow, campaignGroup);
  const normalizedTarget = normalizeGroupName(targetGroup);
  const source = candidateLabel(spendRow);
  const scoped = campaigns
    .filter((campaign) => clean(campaign.state).toLowerCase() !== 'deleted')
    .filter((campaign) => (
      !normalizedTarget || normalizeGroupName(campaign.campaignGroup) === normalizedTarget
    ));

  return scoped
    .map((campaign) => ({
      ...campaign,
      matchScore: campaignMatchScore(source, campaign.campaign),
    }))
    .sort((a, b) => (
      b.matchScore - a.matchScore
      || a.campaign.localeCompare(b.campaign, undefined, { numeric: true, sensitivity: 'base' })
    ))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 40)));
}

function openAiEndpoint(baseUrl) {
  return `${clean(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')}/responses`;
}

function extractOpenAiOutputText(data) {
  if (clean(data?.output_text)) return clean(data.output_text);
  for (const item of data?.output || []) {
    for (const content of item.content || []) {
      if (clean(content.text)) return clean(content.text);
      if (clean(content.output_text)) return clean(content.output_text);
    }
  }
  return '';
}

function gptRouteSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'target_campaign_id', 'confidence', 'reason'],
    properties: {
      status: {
        type: 'string',
        enum: ['matched', 'needs_confirmation', 'unmatched'],
      },
      target_campaign_id: {
        type: 'integer',
        description: 'Use 0 when there is no reliable target campaign.',
      },
      confidence: {
        type: 'number',
      },
      reason: {
        type: 'string',
      },
    },
  };
}

function buildGptRoutePrompt({ spendRow, targetGroup, sourceCampaigns, candidates }) {
  return JSON.stringify({
    task: 'Route ad spend to the correct main Keitaro campaign.',
    rules: [
      'Choose only one target_campaign_id from candidates.',
      'The target must be in the main buyer campaign group.',
      'The source campaign may be a copy/app-layer campaign.',
      'Names usually differ by small copy markers or suffixes.',
      'If the match is not reliable, return needs_confirmation or unmatched.',
      'Never invent campaign IDs.',
    ],
    target_group: targetGroup,
    spend: {
      row_number: spendRow.rowNumber || 0,
      date: spendRow.dateYmd || '',
      amount: Number(spendRow.spend || 0),
      currency: spendRow.currency || '',
      source_campaign_name: spendRow.campaignName || spendRow.sub5 || '',
      sub5: spendRow.sub5 || '',
      buyer: spendRow.buyer || parseSub5(spendRow.sub5 || '').buyer,
      geo: spendRow.geo || parseSub5(spendRow.sub5 || '').geo,
      account_id: spendRow.accountId || parseSub5(spendRow.sub5 || '').accountId,
      creative: spendRow.creative || parseSub5(spendRow.sub5 || '').creative,
    },
    source_campaigns_found_by_clicks: sourceCampaigns.map((campaign) => ({
      campaign_id: campaign.campaignId,
      name: campaign.campaign,
      group: campaign.campaignGroup,
      clicks: campaign.clicks,
    })),
    candidates: candidates.map((campaign) => ({
      campaign_id: campaign.campaignId,
      name: campaign.campaign,
      group: campaign.campaignGroup,
      state: campaign.state,
      lexical_score: Number(campaign.matchScore || 0).toFixed(3),
    })),
  });
}

async function routeCampaignWithGpt({
  openaiApiKey,
  openaiBaseUrl,
  openaiModel,
  spendRow,
  targetGroup,
  sourceCampaigns,
  candidates,
}) {
  if (!openaiApiKey) throw new Error('OpenAI API key is not configured.');
  if (!candidates.length) {
    return {
      status: 'unmatched',
      target_campaign_id: 0,
      confidence: 0,
      reason: 'No target campaign candidates were available.',
    };
  }

  const response = await fetch(openAiEndpoint(openaiBaseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: openaiModel || 'gpt-4o-mini',
      input: [
        {
          role: 'system',
          content: [
            'You are a careful traffic-ops routing assistant.',
            'Return JSON only through the provided schema.',
            'You map Facebook spend from copy/source campaign names to the correct main Keitaro campaign.',
            'Prefer not matching over a risky wrong match.',
          ].join(' '),
        },
        {
          role: 'user',
          content: buildGptRoutePrompt({
            spendRow,
            targetGroup,
            sourceCampaigns,
            candidates,
          }),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'campaign_cost_route',
          strict: true,
          schema: gptRouteSchema(),
        },
      },
      max_output_tokens: 500,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI API returned ${response.status}: ${text.slice(0, 500)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`OpenAI API returned non-JSON response: ${text.slice(0, 500)}`);
  }

  const outputText = extractOpenAiOutputText(data);
  if (!outputText) throw new Error('OpenAI API returned empty output.');

  try {
    return JSON.parse(outputText);
  } catch {
    throw new Error(`OpenAI output is not valid JSON: ${outputText.slice(0, 500)}`);
  }
}

function normalizeGptRoutingOptions(options = {}) {
  const minConfidence = Number(options.minConfidence);
  const candidateLimit = Number(options.candidateLimit);
  return {
    enabled: options.enabled !== false && Boolean(options.openaiApiKey),
    openaiApiKey: clean(options.openaiApiKey),
    openaiBaseUrl: clean(options.openaiBaseUrl || 'https://api.openai.com/v1'),
    openaiModel: clean(options.openaiModel || 'gpt-4o-mini'),
    minConfidence: Number.isFinite(minConfidence) ? Math.min(1, Math.max(0, minConfidence)) : 0.85,
    candidateLimit: Number.isFinite(candidateLimit) ? Math.max(1, Math.min(100, Math.trunc(candidateLimit))) : 40,
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
  gptRouting = {},
  onProgress,
}) {
  const fallbackIds = numberList(fallbackCampaignIds);
  const gptOptions = normalizeGptRoutingOptions(gptRouting);
  const cache = new Map();
  const resolvedRows = [];
  const unresolvedRows = [];
  const ambiguousRows = [];
  const gptResolvedRows = [];
  const gptAttemptedRows = [];
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

  if (gptOptions.enabled && unresolvedRows.length) {
    await onProgress?.({
      stage: 'gpt_prepare',
      total: unresolvedRows.length,
    });

    let allCampaigns = [];
    let campaignFetchError = null;
    try {
      allCampaigns = await fetchKeitaroCampaigns({ baseUrl, apiKey });
    } catch (error) {
      campaignFetchError = error;
    }

    const stillUnresolvedRows = [];
    for (const [index, row] of unresolvedRows.entries()) {
      if (campaignFetchError) {
        stillUnresolvedRows.push({
          ...row,
          gptError: campaignFetchError.message,
        });
        continue;
      }

      const targetGroup = targetCampaignGroupForRow(row, campaignGroup);
      const candidates = selectGptCampaignCandidates(
        allCampaigns,
        row,
        campaignGroup,
        gptOptions.candidateLimit,
      );
      await onProgress?.({
        stage: 'gpt_lookup',
        current: index + 1,
        total: unresolvedRows.length,
        row,
        candidates,
      });

      if (!candidates.length) {
        stillUnresolvedRows.push({
          ...row,
          gptError: 'No target campaign candidates found.',
        });
        continue;
      }

      try {
        const gptMatch = await routeCampaignWithGpt({
          ...gptOptions,
          spendRow: row,
          targetGroup,
          sourceCampaigns: row.candidateCampaigns || [],
          candidates,
        });
        const targetId = Number(gptMatch.target_campaign_id || 0);
        const targetCampaign = candidates.find((campaign) => campaign.campaignId === targetId);
        const confidence = Number(gptMatch.confidence || 0);
        const routedRow = {
          ...row,
          targetCampaignGroup: targetGroup,
          candidateCampaigns: row.candidateCampaigns || [],
          gptCandidates: candidates,
          gptMatch: {
            status: clean(gptMatch.status),
            targetCampaignId: targetId,
            confidence,
            reason: clean(gptMatch.reason),
          },
        };
        gptAttemptedRows.push(routedRow);

        if (
          gptMatch.status === 'matched'
          && targetCampaign
          && confidence >= gptOptions.minConfidence
        ) {
          const resolvedRow = {
            ...routedRow,
            campaignIds: [targetCampaign.campaignId],
            campaignRows: [targetCampaign],
            campaignIdSource: 'gpt',
          };
          resolvedRows.push(resolvedRow);
          gptResolvedRows.push(resolvedRow);
        } else if (targetCampaign) {
          ambiguousRows.push({
            ...routedRow,
            campaignIds: [targetCampaign.campaignId],
            campaignRows: [targetCampaign],
          });
        } else {
          stillUnresolvedRows.push(routedRow);
        }
      } catch (error) {
        stillUnresolvedRows.push({
          ...row,
          targetCampaignGroup: targetGroup,
          gptCandidates: candidates,
          gptError: error.message,
        });
      }
    }

    unresolvedRows.splice(0, unresolvedRows.length, ...stillUnresolvedRows);
  }

  await onProgress?.({
    stage: 'resolved',
    total: rows.length,
    resolvedRows,
    unresolvedRows,
    ambiguousRows,
    gptResolvedRows,
    gptAttemptedRows,
  });

  return {
    resolvedRows,
    unresolvedRows,
    ambiguousRows,
    gptResolvedRows,
    gptAttemptedRows,
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
  return {
    importId: createImportId(),
    importedAt: new Date().toISOString(),
    sourceRows,
    rows,
    dates,
    currency,
    totalSpend: rows.reduce((sum, row) => sum + row.spend, 0),
    totalResults: rows.reduce((sum, row) => sum + row.results, 0),
  };
}

function mergeSpendRow(current, row) {
  current.spend += Number(row.spend || 0);
  current.results += Number(row.results || 0);
  current.impressions += Number(row.impressions || 0);
  current.reach += Number(row.reach || 0);
  current.sourceRows += Number(row.sourceRows || 0);

  if (clean(row.endDateYmd).localeCompare(clean(current.endDateYmd)) > 0) {
    current.endDateYmd = row.endDateYmd;
  }

  const sourceFiles = [
    ...(Array.isArray(current.sourceFiles) ? current.sourceFiles : []),
    ...(Array.isArray(row.sourceFiles) ? row.sourceFiles : []),
  ].filter(Boolean);
  if (sourceFiles.length) current.sourceFiles = [...new Set(sourceFiles)];
}

export function combineFacebookSpendImports(importBatches, options = {}) {
  const batches = (Array.isArray(importBatches) ? importBatches : [])
    .filter((batch) => batch?.rows?.length);
  if (!batches.length) {
    throw new Error('No Facebook spend CSV imports to combine.');
  }
  if (batches.length === 1 && !options.force) {
    return batches[0];
  }

  const grouped = new Map();
  let sourceRows = 0;

  for (const batch of batches) {
    sourceRows += Number(batch.sourceRows || 0);
    for (const row of batch.rows) {
      const currency = clean(row.currency || batch.currency || options.currency || 'USD').toUpperCase();
      const key = [
        clean(row.dateYmd),
        clean(row.sub5),
        currency,
      ].join('|');
      const current = grouped.get(key);
      if (current) {
        mergeSpendRow(current, row);
        continue;
      }

      grouped.set(key, {
        ...row,
        currency,
        spend: Number(row.spend || 0),
        results: Number(row.results || 0),
        impressions: Number(row.impressions || 0),
        reach: Number(row.reach || 0),
        sourceRows: Number(row.sourceRows || 0),
        sourceFiles: Array.isArray(row.sourceFiles) ? [...row.sourceFiles] : [],
      });
    }
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
  const currencies = [...new Set(rows.map((row) => clean(row.currency)).filter(Boolean))].sort();

  return {
    importId: createImportId(),
    importedAt: new Date().toISOString(),
    sourceRows,
    rows,
    dates: [...new Set(rows.map((row) => row.dateYmd).filter(Boolean))].sort(),
    currency: currencies.length === 1 ? currencies[0] : (clean(options.currency).toUpperCase() || currencies[0] || 'USD'),
    totalSpend: rows.reduce((sum, row) => sum + row.spend, 0),
    totalResults: rows.reduce((sum, row) => sum + row.results, 0),
    files: batches.flatMap((batch) => Array.isArray(batch.files) ? batch.files : []),
    sourceImportIds: batches.map((batch) => batch.importId).filter(Boolean),
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
  gptRouting = {},
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
      gptResolvedRows: [],
      gptAttemptedRows: [],
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
    gptRouting,
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
    gptResolvedRows: resolution.gptResolvedRows,
    gptAttemptedRows: resolution.gptAttemptedRows,
    jobs: jobs.length,
  };
}
