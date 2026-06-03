import {
  combineFacebookSpendImports,
  parseCampaignIds,
  parseFacebookSpendCsv,
  pushFacebookCostsToKeitaro,
  summarizeSpendRows,
} from './facebookSpend.js';
import {
  DEFAULT_BASE_URL,
  DEFAULT_LIMIT,
  DEFAULT_TIMEZONE,
  buildAccountReport,
  buildOfferReport,
  buildReport,
  buildSub5Summary,
  clean,
  formatSub5Details,
  normalizeBaseUrl,
  parseRelativeDate,
  parseSub5,
  summarizeReport,
  toYmd,
} from './report.js';
import { TelegramClient } from './telegram.js';

const DOCUMENT_GROUP_COLLECT_MS = 2000;

const HELP = `Бот помогает баеру:

1. Строить отчеты sub5 и офферов из Keitaro.
2. Смотреть live-реги, депы и проблемные sub5.
3. Загружать Facebook CSV и отправлять costs в Keitaro.
4. Искать результаты по конкретному sub5.

Основное управление - кнопками.
Быстрые команды: /report, /stats, /spend, /find, /settings.
Полный список команд: /commands`;

const COMMANDS = `Команды:
/report 2026-05-26 - CSV по sub5 из Keitaro API
/offers 2026-05-26 - CSV по офферам: Оффер, Выплата, Количество, Общий доход
/offers суббота - CSV по офферам за ближайшую прошедшую субботу
/today - отчет за сегодня
/yesterday - отчет за вчера
/stats [date] - live-статистика из webhook-журнала
/last 20 - последние live-конверсии
/sales [date] - live-продажи за дату
/regs [date] - live-реги за дату
/top [date] - топ live-sub5 по депам
/bad [date] - live-sub5 с регами без депов
/late [date] - live-депы за дату по регам других дней
/week - live-сводка за 7 дней
/sub5 2505|TZ|... - разобрать sub5
/find 2505|TZ|... - найти реги/депы по sub5
/findmode - включить режим поиска по sub5
/done - выйти из режима поиска
/spend [date] - расходы из загруженных FB CSV
/accounts [date|7d|FROM TO] - эффективность рекламных аккаунтов и тренд по дням
/roi [date] - то же, быстрый отчет по ROI
/cpa [date] - то же, быстрый отчет по CPA
/costs - инструкция по CSV-расходам
/pushcosts_to IMPORT_ID CAMPAIGN_ID ROWS - вручную отправить строки costs
/digest [date] - дневной digest по live-данным
/alerts [date] - автоалерты по live-данным
/settings - показать профиль бота
/set url https://...
/set key KEITARO_API_KEY
/set timezone Asia/Yerevan
/set update_hour 11
/set cabinet_timezone Asia/Tbilisi
/set cost_campaign_group kkid
/set cost_currency USD
/set cost_auto_push off
/set daily_digest on
/set auto_alerts on
/status - статус бота`;

function commandParts(text) {
  const trimmed = clean(text);
  if (!trimmed.startsWith('/')) return null;
  const [rawCommand, ...rest] = trimmed.split(/\s+/);
  const command = rawCommand.split('@')[0].toLowerCase();
  return {
    command,
    args: rest,
    rest: trimmed.slice(rawCommand.length).trim(),
  };
}

function isLikelySub5(text) {
  const value = clean(text);
  return value.includes('|') && value.split('|').length >= 5;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function maskSecret(value) {
  const text = clean(value);
  if (!text) return 'not set';
  if (text.length <= 8) return 'set';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function formatOptionalCount(value) {
  if (value === null || value === undefined) return '-';
  const count = Number(value);
  return Number.isFinite(count) ? String(count) : '-';
}

function formatCr(regs, deps) {
  return regs ? `${((deps / regs) * 100).toFixed(1)}%` : '0.0%';
}

function eventTime(event) {
  return event.sale_datetime || event.postback_datetime || event.created_at || '-';
}

function datePart(value) {
  const match = clean(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function dayLag(fromDateYmd, toDateYmd) {
  const [fromYear, fromMonth, fromDay] = clean(fromDateYmd).split('-').map(Number);
  const [toYear, toMonth, toDay] = clean(toDateYmd).split('-').map(Number);
  if (!fromYear || !fromMonth || !fromDay || !toYear || !toMonth || !toDay) return 0;
  const from = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const to = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.max(0, Math.round((to - from) / 86400000));
}

function isLateSaleEvent(event) {
  if (clean(event.status) !== 'sale' && clean(event.previous_status) !== 'sale') return false;
  const regDate = datePart(event.postback_datetime);
  const saleDate = datePart(event.sale_datetime || event.postback_datetime);
  return Boolean(regDate && saleDate && dayLag(regDate, saleDate) > 0);
}

function formatConversion(event) {
  const parsed = parseSub5(event.sub_id_5 || '');
  const lines = [
    `${event.status || '-'} | ${eventTime(event)}`,
    `sub5: ${event.sub_id_5 || '-'}`,
  ];

  if (event.previous_status) lines.push(`previous_status: ${event.previous_status}`);
  if (parsed.geo || event.geo) lines.push(`GEO: ${event.geo || parsed.geo}`);
  if (parsed.creative || event.creative) lines.push(`creative: ${event.creative || parsed.creative}`);
  if (event.revenue) lines.push(`revenue: ${formatMoney(event.revenue)}`);
  if (event.campaign) lines.push(`campaign: ${event.campaign}`);
  return lines.join('\n');
}

function formatLateSale(event) {
  const regDate = datePart(event.postback_datetime) || '-';
  const saleDate = datePart(event.sale_datetime || event.postback_datetime) || '-';
  const lag = regDate !== '-' && saleDate !== '-' ? dayLag(regDate, saleDate) : 0;
  return [
    'Late sale',
    `reg date: ${regDate}`,
    `sale date: ${saleDate}`,
    `lag: ${lag} days`,
    formatConversion(event),
  ].join('\n');
}

function formatSub5SearchResult(summary, source) {
  const lines = [
    '<b>По sub5</b>',
    `<code>${escapeHtml(summary.sub5)}</code>`,
    '',
    `<b>Найдено${summary.dateYmd ? ` за ${escapeHtml(summary.dateYmd)}` : ''}</b>`,
    `Реги: <b>${summary.regs}</b>`,
    `Депы: <b>${summary.deps}</b>`,
    `Installs: <b>${escapeHtml(formatOptionalCount(summary.installs))}</b>`,
    `Revenue: <b>${escapeHtml(formatMoney(summary.revenue))}</b>`,
  ];

  if (summary.lateDeps) {
    lines.push(`Late deps: <b>${summary.lateDeps}</b>`);
  }

  if (summary.recoveredDeps) {
    lines.push(`Recovered deps: <b>${summary.recoveredDeps}</b>`);
  }

  if (summary.dateYmd && (summary.allTimeRegs !== summary.regs || summary.allTimeDeps !== summary.deps)) {
    lines.push('');
    lines.push(`<i>Всего по sub5: ${summary.allTimeRegs} рег / ${summary.allTimeDeps} деп</i>`);
  }

  if (summary.timeWindow) {
    lines.push('');
    lines.push(`Окно: <code>${escapeHtml(summary.timeWindow.startDateTime)} - ${escapeHtml(summary.timeWindow.endDateTime)}</code>`);
  }

  lines.push(
    `Source: <code>${escapeHtml(source)}</code>`,
  );

  return lines.join('\n');
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Отчеты', callback_data: 'menu:reports' },
        { text: 'Live', callback_data: 'menu:live' },
      ],
      [
        { text: 'Расходы', callback_data: 'menu:spend' },
        { text: 'Поиск', callback_data: 'menu:search' },
      ],
      [
        { text: 'Настройки', callback_data: 'menu:settings' },
        { text: 'Помощь', callback_data: 'help' },
      ],
    ],
  };
}

function reportKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Sub5 сегодня', callback_data: 'report:today' },
        { text: 'Sub5 вчера', callback_data: 'report:yesterday' },
      ],
      [
        { text: 'Офферы сегодня', callback_data: 'offers:today' },
        { text: 'Офферы вчера', callback_data: 'offers:yesterday' },
      ],
      [
        { text: 'Sub5 позавчера', callback_data: 'report:2d' },
        { text: 'Офферы позавчера', callback_data: 'offers:2d' },
      ],
      [
        { text: 'Sub5 другая дата', callback_data: 'mode:report_date' },
        { text: 'Офферы дата', callback_data: 'mode:offer_date' },
      ],
      [
        { text: 'В меню', callback_data: 'menu:main' },
      ],
    ],
  };
}

function reportDateTypeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Sub5 отчет', callback_data: 'mode:report_date' },
        { text: 'Офферы', callback_data: 'mode:offer_date' },
      ],
      [
        { text: 'Назад', callback_data: 'menu:reports' },
        { text: 'В меню', callback_data: 'menu:main' },
      ],
    ],
  };
}

function formatHour(hour) {
  return String(hour).padStart(2, '0');
}

function normalizeReportHour(value, fallback = 11) {
  const hour = Number(value);
  if (!Number.isFinite(hour)) return fallback;
  return Math.min(23, Math.max(0, Math.trunc(hour)));
}

function reportWindowText(kind, dateYmd) {
  const title = kind === 'offers' ? 'Отчет по офферам' : 'Отчет по sub5';
  return `${title} за ${dateYmd}. С какого времени считать по Keitaro?`;
}

function reportWindowKeyboard(kind, dateYmd, updateHour = 11) {
  const hour = normalizeReportHour(updateHour);
  return {
    inline_keyboard: [
      [
        { text: `С ${formatHour(hour)}:00`, callback_data: `report_run:${kind}:${dateYmd}:${hour}` },
        { text: 'С 00:00', callback_data: `report_run:${kind}:${dateYmd}:0` },
      ],
      [
        { text: 'Назад', callback_data: 'menu:reports' },
      ],
    ],
  };
}

function reportWindowCaption(report, prefix = 'CSV') {
  const startHour = report.timeWindow?.startHour ?? 0;
  return `${prefix} ${report.dateYmd}, с ${formatHour(startHour)}:00 Keitaro`;
}

function liveMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Сегодня', callback_data: 'stats:today' },
        { text: 'Вчера', callback_data: 'stats:yesterday' },
      ],
      [
        { text: 'Продажи', callback_data: 'sales:today' },
        { text: 'Реги', callback_data: 'regs:today' },
      ],
      [
        { text: 'Топ sub5', callback_data: 'top:today' },
        { text: 'Без депов', callback_data: 'bad:today' },
      ],
      [
        { text: '7 дней', callback_data: 'week' },
        { text: 'Другая дата', callback_data: 'mode:stats_date' },
      ],
      [
        { text: 'В меню', callback_data: 'menu:main' },
      ],
    ],
  };
}

function spendKeyboard(importId = '') {
  const keyboard = [
    [
      { text: 'Spend сегодня', callback_data: 'spend:today' },
      { text: 'Spend вчера', callback_data: 'spend:yesterday' },
    ],
    [
      { text: 'Аккаунты сегодня', callback_data: 'accounts:today' },
      { text: 'Аккаунты вчера', callback_data: 'accounts:yesterday' },
    ],
    [
      { text: 'Аккаунты 7 дней', callback_data: 'accounts:7d' },
    ],
    [
      { text: 'Загрузить CSV', callback_data: 'costs:help' },
      { text: 'Настройки costs', callback_data: 'settings:costs' },
    ],
  ];

  if (importId) {
    keyboard.unshift([
      { text: 'Отправить costs в Keitaro', callback_data: `cost_push:${importId}` },
    ]);
  }

  keyboard.push([{ text: 'В меню', callback_data: 'menu:main' }]);
  return { inline_keyboard: keyboard };
}

function searchMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Начать поиск', callback_data: 'mode:find' },
        { text: 'Формат sub5', callback_data: 'search:format' },
      ],
      [
        { text: 'В меню', callback_data: 'menu:main' },
      ],
    ],
  };
}

function settingsKeyboard() {
  return settingsMainKeyboard();
}

function settingsMainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Keitaro', callback_data: 'settings:keitaro' },
        { text: 'Время', callback_data: 'settings:time' },
      ],
      [
        { text: 'Costs', callback_data: 'settings:costs' },
        { text: 'Алерты', callback_data: 'settings:alerts' },
      ],
      [
        { text: 'В меню', callback_data: 'menu:main' },
      ],
    ],
  };
}

function settingsKeitaroKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'URL', callback_data: 'set:url' },
        { text: 'API key', callback_data: 'set:key' },
      ],
      [
        { text: 'Timezone', callback_data: 'set:timezone' },
      ],
      [
        { text: 'Назад', callback_data: 'settings:show' },
      ],
    ],
  };
}

function settingsTimeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Час обновления', callback_data: 'set:update_hour' },
      ],
      [
        { text: 'Timezone кабинетов', callback_data: 'set:cabinet_timezone' },
      ],
      [
        { text: 'Назад', callback_data: 'settings:show' },
      ],
    ],
  };
}

function settingsCostsKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Валюта', callback_data: 'set:cost_currency' },
        { text: 'Группа', callback_data: 'set:cost_campaign_group' },
      ],
      [
        { text: 'Автоотправка', callback_data: 'set:cost_auto_push' },
      ],
      [
        { text: 'GPT costs', callback_data: 'set:gpt_cost_routing' },
        { text: 'OpenAI key', callback_data: 'set:openai_key' },
      ],
      [
        { text: 'GPT model', callback_data: 'set:openai_model' },
        { text: 'GPT confidence', callback_data: 'set:gpt_cost_confidence' },
      ],
      [
        { text: 'Назад', callback_data: 'settings:show' },
      ],
    ],
  };
}

function settingsAlertsKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Daily digest', callback_data: 'set:daily_digest' },
        { text: 'Автоалерты', callback_data: 'set:auto_alerts' },
      ],
      [
        { text: 'Час digest', callback_data: 'set:daily_digest_hour' },
      ],
      [
        { text: 'Мин. рег без депа', callback_data: 'set:alert_min_regs' },
      ],
      [
        { text: 'CR drop %', callback_data: 'set:alert_cr_drop_pct' },
      ],
      [
        { text: 'Назад', callback_data: 'settings:show' },
      ],
    ],
  };
}

function costPushConfirmKeyboard(importId) {
  return {
    inline_keyboard: [
      [
        { text: 'Да, отправить', callback_data: `cost_push_do:${importId}` },
      ],
      [
        { text: 'Отмена', callback_data: 'menu:spend' },
      ],
    ],
  };
}

function statsKeyboard() {
  return liveMenuKeyboard();
}

function settingsKeyboardForKey(key) {
  const section = settingsSectionForKey(key);
  if (section === 'keitaro') return settingsKeitaroKeyboard();
  if (section === 'time') return settingsTimeKeyboard();
  if (section === 'costs') return settingsCostsKeyboard();
  if (section === 'alerts') return settingsAlertsKeyboard();
  return settingsMainKeyboard();
}

function settingsSectionForKey(key) {
  if (['url', 'key', 'timezone'].includes(key)) return 'keitaro';
  if (['update_hour', 'cabinet_timezone'].includes(key)) return 'time';
  if ([
    'cost_campaign_ids',
    'cost_campaign_group',
    'cost_currency',
    'cost_auto_push',
    'cost_only_uniques',
    'openai_key',
    'openai_model',
    'gpt_cost_routing',
    'gpt_cost_confidence',
    'gpt_cost_candidate_limit',
  ].includes(key)) return 'costs';
  if ([
    'daily_digest',
    'daily_digest_enabled',
    'digest',
    'daily_digest_hour',
    'digest_hour',
    'auto_alerts',
    'alerts_enabled',
    'alerts',
    'alert_min_regs',
    'alert_min_regs_no_deps',
    'min_regs_no_deps',
    'alert_cr_drop_pct',
    'alert_cr_drop_percent',
    'cr_drop_pct',
    'alert_cr_min_regs',
    'cr_min_regs',
  ].includes(key)) return 'alerts';
  return 'main';
}

function settingsSectionCallback(key) {
  const section = settingsSectionForKey(key);
  return section === 'main' ? 'settings:show' : `settings:${section}`;
}

function settingsBackKeyboard(key) {
  return {
    inline_keyboard: [
      [
        { text: 'Назад', callback_data: settingsSectionCallback(key) },
        { text: 'В меню', callback_data: 'menu:main' },
      ],
    ],
  };
}

function settingsKeyboardForSection(section) {
  if (section === 'keitaro') return settingsKeitaroKeyboard();
  if (section === 'time') return settingsTimeKeyboard();
  if (section === 'costs') return settingsCostsKeyboard();
  if (section === 'alerts') return settingsAlertsKeyboard();
  return settingsMainKeyboard();
}

function sectionTitle(section) {
  return ({
    keitaro: 'Настройки Keitaro',
    time: 'Время и timezone',
    costs: 'Настройки costs',
    alerts: 'Digest и автоалерты',
  })[section] || 'Настройки';
}

function findModeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Выйти из поиска', callback_data: 'mode:done' },
        { text: 'В меню', callback_data: 'menu:main' },
      ],
    ],
  };
}

function settingLabel(key) {
  return ({
    url: 'Keitaro URL',
    key: 'Keitaro API key',
    timezone: 'Keitaro timezone',
    update_hour: 'час обновления кабинетов',
    cabinet_timezone: 'timezone кабинетов',
    cost_campaign_ids: 'fallback Keitaro campaign IDs для costs',
    cost_campaign_group: 'группа кампаний',
    cost_currency: 'валюта',
    cost_auto_push: 'автоотправка costs',
    openai_key: 'OpenAI API key',
    openai_model: 'OpenAI model',
    gpt_cost_routing: 'GPT fallback для costs',
    gpt_cost_confidence: 'GPT confidence для costs',
    gpt_cost_candidate_limit: 'GPT candidate limit',
    daily_digest: 'daily digest',
    daily_digest_hour: 'час daily digest',
    auto_alerts: 'автоалерты',
    alert_min_regs: 'мин. рег без депа',
    alert_cr_drop_pct: 'CR drop %',
    alert_cr_min_regs: 'мин. рег для CR drop',
  })[key] || key;
}

function settingExample(key) {
  return ({
    url: 'https://ibrkeit.xyz',
    key: '37b31f...',
    timezone: 'Asia/Yerevan',
    update_hour: '11',
    cabinet_timezone: 'Asia/Tbilisi',
    cost_campaign_ids: '12,34',
    cost_campaign_group: 'kkid',
    cost_currency: 'USD',
    cost_auto_push: 'off',
    openai_key: 'sk-...',
    openai_model: 'gpt-4o-mini',
    gpt_cost_routing: 'on',
    gpt_cost_confidence: '0.85',
    gpt_cost_candidate_limit: '40',
    daily_digest: 'on',
    daily_digest_hour: '11',
    auto_alerts: 'on',
    alert_min_regs: '10',
    alert_cr_drop_pct: '50',
    alert_cr_min_regs: '10',
  })[key] || '';
}

function parseBooleanSetting(value) {
  const text = clean(value).toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on', 'да', 'вкл'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off', 'нет', 'выкл'].includes(text)) return false;
  throw new Error('Используй on/off, yes/no или true/false.');
}

function numberSetting(value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, integer = true } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Нужно число.');
  const normalized = integer ? Math.trunc(number) : number;
  if (normalized < min || normalized > max) {
    throw new Error(`Значение должно быть от ${min} до ${max}.`);
  }
  return normalized;
}

function decodeTelegramText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.slice(2));
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.alloc(buffer.length - 2);
    for (let index = 2; index < buffer.length; index += 2) {
      swapped[index - 2] = buffer[index + 1] || 0;
      swapped[index - 1] = buffer[index];
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }
  return new TextDecoder('utf-8').decode(buffer);
}

function formatSpendStats(stats, limit = 10) {
  const top = stats.rows
    .slice()
    .sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0))
    .slice(0, limit);

  const lines = [
    `<b>FB spend ${escapeHtml(stats.dateYmd)}</b>`,
    `Групп: <b>${stats.groups}</b>`,
    `Spend: <b>${escapeHtml(formatMoney(stats.totalSpend))} ${escapeHtml(stats.currency)}</b>`,
    `FB results: <b>${escapeHtml(formatMoney(stats.totalResults))}</b>`,
  ];

  if (stats.totalResults) {
    lines.push(`Cost/result: <b>${escapeHtml(formatMoney(stats.totalSpend / stats.totalResults))} ${escapeHtml(stats.currency)}</b>`);
  }

  if (top.length) {
    lines.push('', '<b>Top spend</b>');
    for (const [index, row] of top.entries()) {
      lines.push(`${index + 1}. <b>${escapeHtml(formatMoney(row.spend))}</b> ${escapeHtml(row.currency)} / results ${escapeHtml(formatMoney(row.results))}`);
      lines.push(`<code>${escapeHtml(row.sub5)}</code>`);
    }
  }

  return lines.join('\n');
}

function ymdRange(startYmd, endYmd, maxDays = 31) {
  let start = clean(startYmd);
  let end = clean(endYmd);
  if (!start || !end) return [];
  if (start.localeCompare(end) > 0) {
    [start, end] = [end, start];
  }

  const dates = [];
  for (let current = start; current.localeCompare(end) <= 0; current = shiftYmd(current, 1)) {
    dates.push(current);
    if (dates.length > maxDays) {
      throw new Error(`Слишком длинный период для account report. Максимум ${maxDays} дней за один запрос.`);
    }
  }
  return dates;
}

function resolveAccountsDateToken(value, config) {
  const source = clean(value).toLowerCase();
  if (source === 'today' || source === 'сегодня' || source === 'yesterday' || source === 'вчера') {
    return resolveSub5SearchDate(source, config);
  }
  return toYmd(parseRelativeDate(source));
}

function looksLikeRangeDateToken(value) {
  const source = clean(value).toLowerCase();
  return (
    ['today', 'сегодня', 'yesterday', 'вчера'].includes(source)
    || /^\d{4}-\d{1,2}-\d{1,2}$/.test(source)
    || /^\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?$/.test(source)
  );
}

function parseAccountsPeriod(args, config) {
  const raw = clean(args.join(' ')) || 'today';
  const source = raw.toLowerCase();

  const daysMatch = source.match(/^(\d{1,2})\s*(?:d|day|days|д|день|дня|дней)$/i);
  const namedDays = ({
    week: 7,
    '7days': 7,
    неделя: 7,
    неделю: 7,
    month: 30,
    месяц: 30,
  })[source];
  const lastDays = daysMatch ? Number(daysMatch[1]) : namedDays;

  if (lastDays) {
    const days = Math.min(Math.max(Math.trunc(lastDays), 1), 31);
    const endYmd = resolveSub5SearchDate('today', config);
    const startYmd = shiftYmd(endYmd, -(days - 1));
    return {
      input: raw,
      dates: ymdRange(startYmd, endYmd),
      isRange: days > 1,
    };
  }

  if (raw.includes('..')) {
    const [startRaw, endRaw] = raw.split('..').map(clean);
    return {
      input: raw,
      dates: ymdRange(
        resolveAccountsDateToken(startRaw, config),
        resolveAccountsDateToken(endRaw, config),
      ),
      isRange: true,
    };
  }

  const rangeArgs = args
    .map(clean)
    .filter((item) => item && !['-', '—', 'to', 'до'].includes(item.toLowerCase()));
  if (rangeArgs.length === 2 && rangeArgs.every(looksLikeRangeDateToken)) {
    return {
      input: raw,
      dates: ymdRange(
        resolveAccountsDateToken(rangeArgs[0], config),
        resolveAccountsDateToken(rangeArgs[1], config),
      ),
      isRange: true,
    };
  }

  const dateYmd = resolveAccountsDateToken(raw, config);
  return {
    input: raw,
    dates: [dateYmd],
    isRange: false,
  };
}

function accountIdFromSpendRow(row) {
  const parsed = parseSub5(row.sub5 || row.campaignName || '');
  const accountId = clean(row.accountId || parsed.accountId);
  return /^\d+$/.test(accountId) ? accountId : 'unknown';
}

function formatSignedMoney(value) {
  const amount = Number(value || 0);
  const prefix = amount > 0 ? '+' : '';
  return `${prefix}${formatMoney(amount)}`;
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return '-';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}%`;
}

function formatCostPer(total, count, currency) {
  return count > 0 && total > 0 ? `${formatMoney(total / count)} ${currency}` : '-';
}

function buildAccountPerformance(report, spendStats) {
  const rowsByAccount = new Map();
  const currency = spendStats.currency || 'USD';

  const ensureRow = (accountId) => {
    const key = clean(accountId || 'unknown') || 'unknown';
    const current = rowsByAccount.get(key) || {
      accountId: key,
      installs: 0,
      regs: 0,
      deps: 0,
      revenue: 0,
      spend: 0,
      fbResults: 0,
      spendRows: 0,
    };
    rowsByAccount.set(key, current);
    return current;
  };

  for (const row of report.rows || []) {
    const item = ensureRow(row.accountId);
    item.installs += Number(row.installs || 0);
    item.regs += Number(row.regs || 0);
    item.deps += Number(row.deps || 0);
    item.revenue += Number(row.revenue || 0);
  }

  for (const row of spendStats.rows || []) {
    const item = ensureRow(accountIdFromSpendRow(row));
    item.spend += Number(row.spend || 0);
    item.fbResults += Number(row.results || 0);
    item.spendRows += 1;
  }

  const rows = [...rowsByAccount.values()]
    .filter((row) => row.spend || row.installs || row.regs || row.deps || row.revenue)
    .map((row) => {
      const profit = row.revenue - row.spend;
      return {
        ...row,
        profit,
        roi: row.spend > 0 ? (profit / row.spend) * 100 : NaN,
        cr: row.regs > 0 ? (row.deps / row.regs) * 100 : NaN,
      };
    })
    .sort((a, b) => (
      Number(b.spend > 0) - Number(a.spend > 0)
      || b.profit - a.profit
      || b.revenue - a.revenue
      || b.spend - a.spend
      || a.accountId.localeCompare(b.accountId, undefined, { numeric: true, sensitivity: 'base' })
    ));

  const totals = rows.reduce((acc, row) => {
    acc.spend += row.spend;
    acc.revenue += row.revenue;
    acc.profit += row.profit;
    acc.installs += row.installs;
    acc.regs += row.regs;
    acc.deps += row.deps;
    acc.fbResults += row.fbResults;
    acc.spendRows += row.spendRows;
    return acc;
  }, {
    spend: 0,
    revenue: 0,
    profit: 0,
    installs: 0,
    regs: 0,
    deps: 0,
    fbResults: 0,
    spendRows: 0,
  });

  totals.roi = totals.spend > 0 ? (totals.profit / totals.spend) * 100 : NaN;
  totals.cr = totals.regs > 0 ? (totals.deps / totals.regs) * 100 : NaN;
  totals.accountsWithoutSpend = rows
    .filter((row) => !row.spendRows && (row.installs || row.regs || row.deps || row.revenue))
    .length;

  return {
    dateYmd: report.dateYmd,
    timeWindow: report.timeWindow,
    currency,
    rows,
    totals,
    keitaroAccounts: report.counts.groups,
    spendGroups: spendStats.groups,
  };
}

function formatAccountPerformance(performance, limit = 15) {
  const currency = performance.currency || 'USD';
  const totals = performance.totals;
  const rows = performance.rows.slice(0, limit);
  const windowText = performance.timeWindow
    ? `${performance.timeWindow.startDateTime} - ${performance.timeWindow.endDateTime}`
    : '-';
  const lines = [
    `<b>Accounts performance ${escapeHtml(performance.dateYmd)}</b>`,
    `Окно: <code>${escapeHtml(windowText)}</code> Keitaro`,
    `Аккаунтов: <b>${performance.rows.length}</b> | FB строк spend: <b>${performance.totals.spendRows}</b>`,
    `Spend: <b>${escapeHtml(formatMoney(totals.spend))} ${escapeHtml(currency)}</b> | Revenue: <b>${escapeHtml(formatMoney(totals.revenue))}</b>`,
    `Profit: <b>${escapeHtml(formatSignedMoney(totals.profit))} ${escapeHtml(currency)}</b> | ROI: <b>${escapeHtml(formatSignedPercent(totals.roi))}</b>`,
    `Installs: <b>${totals.installs}</b> | Regs: <b>${totals.regs}</b> | Deps: <b>${totals.deps}</b> | CR: <b>${escapeHtml(formatSignedPercent(totals.cr).replace('+', ''))}</b>`,
  ];

  if (!performance.totals.spendRows) {
    lines.push('', '<i>Расходов FB за эту дату пока нет. Пришли CSV, и бот посчитает ROI, CPA и CPL.</i>');
  } else if (performance.totals.accountsWithoutSpend) {
    lines.push('', `<i>${performance.totals.accountsWithoutSpend} аккаунтов есть в Keitaro, но нет в FB spend за эту дату. По ним profit, ROI, CPL и CPA скрыты; общий profit/ROI будет завышен, пока spend не загружен.</i>`);
  }

  if (!rows.length) {
    lines.push('', 'Данных по аккаунтам пока нет.');
    return lines.join('\n');
  }

  lines.push('', '<b>По аккаунтам</b>');
  for (const [index, row] of rows.entries()) {
    const hasSpendRow = row.spendRows > 0;
    const hasPositiveSpend = row.spend > 0;
    const spendText = hasSpendRow ? `${formatMoney(row.spend)} ${currency}` : '-';
    const profitText = hasPositiveSpend ? `${formatSignedMoney(row.profit)} ${currency}` : '-';
    const roiText = hasPositiveSpend ? formatSignedPercent(row.roi) : '-';
    lines.push(`${index + 1}. <code>${escapeHtml(row.accountId)}</code>`);
    lines.push(`Spend <b>${escapeHtml(spendText)}</b> | Rev <b>${escapeHtml(formatMoney(row.revenue))}</b> | Profit <b>${escapeHtml(profitText)}</b> | ROI <b>${escapeHtml(roiText)}</b>`);
    lines.push(`Inst ${row.installs} | Reg ${row.regs} | Dep ${row.deps} | CR ${escapeHtml(formatSignedPercent(row.cr).replace('+', ''))} | CPI ${escapeHtml(formatCostPer(row.spend, row.installs, currency))} | CPL ${escapeHtml(formatCostPer(row.spend, row.regs, currency))} | CPA ${escapeHtml(formatCostPer(row.spend, row.deps, currency))}`);
  }

  if (performance.rows.length > limit) {
    lines.push(`...и еще ${performance.rows.length - limit}`);
  }

  return lines.join('\n');
}

function shortDateLabel(dateYmd) {
  const [, month, day] = clean(dateYmd).split('-');
  return `${day || '--'}.${month || '--'}`;
}

function buildAccountTrend(performances) {
  const rowsByAccount = new Map();
  const currency = performances.find((item) => item.currency)?.currency || 'USD';
  const dates = performances.map((item) => item.dateYmd);
  const startHour = performances.find((item) => item.timeWindow)?.timeWindow?.startHour ?? 0;

  const ensureRow = (accountId) => {
    const key = clean(accountId || 'unknown') || 'unknown';
    const current = rowsByAccount.get(key) || {
      accountId: key,
      spend: 0,
      revenue: 0,
      profit: 0,
      installs: 0,
      regs: 0,
      deps: 0,
      fbResults: 0,
      spendRows: 0,
      days: [],
      dayMap: new Map(),
    };
    rowsByAccount.set(key, current);
    return current;
  };

  const totals = {
    spend: 0,
    revenue: 0,
    profit: 0,
    installs: 0,
    regs: 0,
    deps: 0,
    fbResults: 0,
    spendRows: 0,
    missingSpendAccountDays: 0,
  };

  for (const performance of performances) {
    totals.spend += performance.totals.spend;
    totals.revenue += performance.totals.revenue;
    totals.installs += performance.totals.installs;
    totals.regs += performance.totals.regs;
    totals.deps += performance.totals.deps;
    totals.fbResults += performance.totals.fbResults;
    totals.spendRows += performance.totals.spendRows;
    totals.missingSpendAccountDays += performance.totals.accountsWithoutSpend || 0;

    for (const row of performance.rows) {
      const item = ensureRow(row.accountId);
      const day = {
        dateYmd: performance.dateYmd,
        spend: Number(row.spend || 0),
        revenue: Number(row.revenue || 0),
        installs: Number(row.installs || 0),
        regs: Number(row.regs || 0),
        deps: Number(row.deps || 0),
        fbResults: Number(row.fbResults || 0),
        spendRows: Number(row.spendRows || 0),
      };
      day.profit = day.revenue - day.spend;
      day.roi = day.spend > 0 ? (day.profit / day.spend) * 100 : NaN;
      day.cr = day.regs > 0 ? (day.deps / day.regs) * 100 : NaN;

      item.spend += day.spend;
      item.revenue += day.revenue;
      item.installs += day.installs;
      item.regs += day.regs;
      item.deps += day.deps;
      item.fbResults += day.fbResults;
      item.spendRows += day.spendRows;
      item.days.push(day);
      item.dayMap.set(day.dateYmd, day);
    }
  }

  totals.profit = totals.revenue - totals.spend;
  totals.roi = totals.spend > 0 ? (totals.profit / totals.spend) * 100 : NaN;
  totals.cr = totals.regs > 0 ? (totals.deps / totals.regs) * 100 : NaN;

  const rows = [...rowsByAccount.values()]
    .map((row) => {
      row.profit = row.revenue - row.spend;
      row.roi = row.spend > 0 ? (row.profit / row.spend) * 100 : NaN;
      row.cr = row.regs > 0 ? (row.deps / row.regs) * 100 : NaN;
      row.activeDays = row.days.length;
      row.spendDays = row.days.filter((day) => day.spendRows > 0).length;
      row.minusDays = row.days.filter((day) => day.spend > 0 && day.profit < 0).length;
      row.zeroDepDays = row.days.filter((day) => day.spend > 0 && day.deps === 0).length;
      row.missingSpendDays = row.days
        .filter((day) => !day.spendRows && (day.installs || day.regs || day.deps || day.revenue))
        .length;
      row.worstDay = row.days
        .filter((day) => day.spend > 0)
        .sort((a, b) => a.profit - b.profit || a.roi - b.roi)[0] || null;
      return row;
    })
    .sort((a, b) => {
      const aRoi = Number.isFinite(a.roi) ? a.roi : Number.POSITIVE_INFINITY;
      const bRoi = Number.isFinite(b.roi) ? b.roi : Number.POSITIVE_INFINITY;
      return (
        Number(b.spend > 0) - Number(a.spend > 0)
        || b.minusDays - a.minusDays
        || b.zeroDepDays - a.zeroDepDays
        || aRoi - bRoi
        || a.profit - b.profit
        || b.spend - a.spend
        || a.accountId.localeCompare(b.accountId, undefined, { numeric: true, sensitivity: 'base' })
      );
    });

  return {
    startDateYmd: dates[0],
    endDateYmd: dates[dates.length - 1],
    dates,
    startHour,
    currency,
    rows,
    totals,
  };
}

function formatTrendDay(day, dateYmd) {
  const label = shortDateLabel(dateYmd);
  if (!day) return `${label} -`;
  if (day.spendRows > 0 && day.spend > 0) {
    return `${label} ${formatSignedPercent(day.roi)} ${day.installs}inst/${day.deps}dep/${formatMoney(day.spend)}`;
  }
  if (day.spendRows > 0) {
    return `${label} 0spend ${day.installs}inst/${day.deps}dep`;
  }
  return `${label} ?spend ${day.installs}inst/${day.deps}dep`;
}

function formatTrendDays(row, dates) {
  const scopedDates = dates.length <= 7 ? dates : dates.slice(-10);
  const label = dates.length <= 7 ? 'Дни' : 'Последние 10 дней';
  return `${label}: ${scopedDates.map((dateYmd) => formatTrendDay(row.dayMap.get(dateYmd), dateYmd)).join(' | ')}`;
}

function formatAccountTrend(trend, limit = 6) {
  const currency = trend.currency || 'USD';
  const totals = trend.totals;
  const rows = trend.rows.slice(0, limit);
  const lines = [
    `<b>Accounts trend ${escapeHtml(trend.startDateYmd)} - ${escapeHtml(trend.endDateYmd)}</b>`,
    `Дней: <b>${trend.dates.length}</b> | Сутки: <code>${formatHour(trend.startHour)}:00-${formatHour((trend.startHour + 23) % 24)}:59 Keitaro</code>`,
    'Сортировка: проблемные сверху.',
    `Spend: <b>${escapeHtml(formatMoney(totals.spend))} ${escapeHtml(currency)}</b> | Revenue: <b>${escapeHtml(formatMoney(totals.revenue))}</b>`,
    `Profit: <b>${escapeHtml(formatSignedMoney(totals.profit))} ${escapeHtml(currency)}</b> | ROI: <b>${escapeHtml(formatSignedPercent(totals.roi))}</b>`,
    `Installs: <b>${totals.installs}</b> | Regs: <b>${totals.regs}</b> | Deps: <b>${totals.deps}</b> | CR: <b>${escapeHtml(formatSignedPercent(totals.cr).replace('+', ''))}</b>`,
  ];

  if (totals.missingSpendAccountDays) {
    lines.push('', `<i>${totals.missingSpendAccountDays} срезов аккаунт-день есть в Keitaro, но без FB spend. Общий profit/ROI может быть завышен, пока spend не загружен.</i>`);
  }

  if (!rows.length) {
    lines.push('', 'Данных по аккаунтам за период пока нет.');
    return lines.join('\n');
  }

  lines.push('', '<b>Аккаунты</b>');
  for (const [index, row] of rows.entries()) {
    const hasSpendRow = row.spendDays > 0;
    const hasPositiveSpend = row.spend > 0;
    const flags = [
      row.minusDays ? `минус ${row.minusDays}д` : '',
      row.zeroDepDays ? `0 dep ${row.zeroDepDays}д` : '',
      row.missingSpendDays ? `?spend ${row.missingSpendDays}д` : '',
    ].filter(Boolean);

    lines.push(`${index + 1}. <code>${escapeHtml(row.accountId)}</code>${flags.length ? ` (${escapeHtml(flags.join(', '))})` : ''}`);
    lines.push(`Spend <b>${hasSpendRow ? `${escapeHtml(formatMoney(row.spend))} ${escapeHtml(currency)}` : '-'}</b> | Rev <b>${escapeHtml(formatMoney(row.revenue))}</b> | Profit <b>${hasPositiveSpend ? `${escapeHtml(formatSignedMoney(row.profit))} ${escapeHtml(currency)}` : '-'}</b> | ROI <b>${hasPositiveSpend ? escapeHtml(formatSignedPercent(row.roi)) : '-'}</b>`);
    lines.push(`Inst ${row.installs} | Reg ${row.regs} | Dep ${row.deps} | CR ${escapeHtml(formatSignedPercent(row.cr).replace('+', ''))} | CPI ${escapeHtml(formatCostPer(row.spend, row.installs, currency))} | CPA ${escapeHtml(formatCostPer(row.spend, row.deps, currency))}`);
    if (row.worstDay) {
      lines.push(`Худший день: ${shortDateLabel(row.worstDay.dateYmd)} ${escapeHtml(formatSignedMoney(row.worstDay.profit))} ${escapeHtml(currency)}, ROI ${escapeHtml(formatSignedPercent(row.worstDay.roi))}, dep ${row.worstDay.deps}`);
    }
    lines.push(formatTrendDays(row, trend.dates));
  }

  if (trend.rows.length > limit) {
    lines.push(`...и еще ${trend.rows.length - limit}`);
  }

  return lines.join('\n');
}

function spendRowKey(row) {
  return [
    clean(row.dateYmd),
    clean(row.sub5),
    clean(row.currency || 'USD'),
  ].join('|');
}

function spendSnapshotKey(row) {
  const parsed = parseSub5(row.sub5 || '');
  return [
    clean(row.dateYmd),
    clean(row.accountId || parsed.accountId || 'unknown'),
    clean(row.currency || 'USD'),
  ].join('|');
}

function formatSpendImport(importBatch, canPush) {
  const summary = summarizeSpendRows(importBatch.rows);
  const fileCount = Number(importBatch.files?.length || importBatch.file_count || 0);
  const lines = [
    fileCount > 1 ? '<b>FB CSV импортированы</b>' : '<b>FB CSV импортирован</b>',
    `ID: <code>${escapeHtml(importBatch.importId)}</code>`,
    fileCount > 1 ? `Файлов: <b>${fileCount}</b>` : '',
    `Даты: <b>${escapeHtml(summary.dates.join(', ') || '-')}</b>`,
    `Строк FB: <b>${importBatch.sourceRows}</b>`,
    `Групп sub5: <b>${summary.rows}</b>`,
    `Spend: <b>${escapeHtml(formatMoney(summary.totalSpend))} ${escapeHtml(summary.currency)}</b>`,
    `FB results: <b>${escapeHtml(formatMoney(summary.totalResults))}</b>`,
    '',
    canPush
      ? 'Можно отправить эти расходы в Keitaro кнопкой ниже. Бот сам найдет Keitaro campaign_id по sub_id_5.'
      : 'В Keitaro не отправлял: сначала задай Keitaro API key в настройках бота.',
  ];
  return lines.filter((line) => line !== '').join('\n');
}

function formatSkippedCostRows(rows, currency, limit = 10) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const lines = safeRows.slice(0, limit).map((row) => {
    const label = row.creative || row.campaignName || row.sub5 || '-';
    const number = row.rowNumber ? `#${row.rowNumber} ` : '';
    const gptNote = row.gptMatch
      ? `; GPT: ${escapeHtml(row.gptMatch.status)} ${escapeHtml(formatSignedPercent(Number(row.gptMatch.confidence || 0) * 100).replace('+', ''))} - ${escapeHtml(row.gptMatch.reason || '')}`
      : (row.gptError ? `; GPT error: ${escapeHtml(row.gptError)}` : '');
    const candidates = (row.candidateCampaigns || [])
      .map((campaign) => [
        campaign.campaignId,
        campaign.campaignGroup,
      ].filter(Boolean).join(' / '))
      .filter(Boolean);
    const groupNote = candidates.length
      ? `; найдено не в той группе: ${escapeHtml([...new Set(candidates)].join(', '))}`
      : '; кликов по sub5 не найдено';
    return `- ${number}<b>${escapeHtml(formatMoney(row.spend))} ${escapeHtml(currency || row.currency || 'USD')}</b> <code>${escapeHtml(label)}</code>${groupNote}${gptNote}`;
  });

  if (safeRows.length > limit) {
    lines.push(`...и еще ${safeRows.length - limit}`);
  }

  return lines;
}

function formatManualCostRows(rows, currency, campaignId, limit = 10) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const lines = safeRows.slice(0, limit).map((row) => {
    const label = row.creative || row.campaignName || row.sub5 || '-';
    const number = row.rowNumber ? `#${row.rowNumber} ` : '';
    return `- ${number}<b>${escapeHtml(formatMoney(row.spend))} ${escapeHtml(currency || row.currency || 'USD')}</b> <code>${escapeHtml(label)}</code>; вручную в campaign <code>${campaignId}</code>`;
  });

  if (safeRows.length > limit) {
    lines.push(`...и еще ${safeRows.length - limit}`);
  }

  return lines;
}

function parseRowSelection(value, maxRows) {
  const text = clean(value).toLowerCase();
  if (['all', '*', 'все'].includes(text)) {
    return Array.from({ length: maxRows }, (_, index) => index + 1);
  }

  const numbers = text
    .split(/[,\s]+/)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= maxRows);
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function costsHelpText() {
  return [
    '<b>Как обойтись без Meta developer account</b>',
    '',
    '1. В Ads Manager выгрузи CSV по кампаниям за нужную дату.',
    '2. В отчете должны быть колонки campaign name и amount spent.',
    '3. Название кампании должно совпадать с нашим sub5.',
    '4. Отправь один CSV или несколько CSV одним сообщением прямо сюда в бот.',
    '',
    '<b>Чтобы бот мог залить costs в Keitaro</b>',
    'Задай Keitaro API key и проверь, что название FB-кампании попадает в <code>sub_id_5</code>.',
    'Campaign IDs вводить не нужно: бот найдет их сам через Keitaro report по <code>sub_id_5</code>.',
    'GPT fallback: <code>/set openai_key sk-...</code>, <code>/set gpt_cost_routing on</code>, <code>/set gpt_cost_confidence 0.85</code>.',
    '',
    'Бот отправляет costs через Keitaro Admin API bulk update и ставит фильтр <code>sub_id_5</code> на каждую строку CSV.',
  ].join('\n');
}

function formatStats(stats) {
  return [
    `Live stats ${stats.dateYmd}`,
    `Groups: ${stats.groups.length}`,
    `Regs: ${stats.regs}`,
    `Deps: ${stats.deps}`,
    `Recovered deps: ${stats.recoveredDeps || 0}`,
    `CR: ${formatCr(stats.regs, stats.deps)}`,
    `Revenue: ${formatMoney(stats.revenue)}`,
  ].join('\n');
}

function formatTop(stats, limit = 10) {
  const rows = stats.groups
    .slice()
    .sort((a, b) => b.deps - a.deps || b.regs - a.regs || b.revenue - a.revenue)
    .slice(0, limit);

  if (!rows.length) return `Нет live-данных за ${stats.dateYmd}.`;

  return [
    `Top live sub5 ${stats.dateYmd}`,
    ...rows.map((row, index) => (
      `${index + 1}. ${row.deps} deps / ${row.regs} regs / CR ${formatCr(row.regs, row.deps)}\n${row.sub5}`
    )),
  ].join('\n\n');
}

function formatBad(stats, limit = 10) {
  const rows = stats.groups
    .filter((row) => row.regs > 0 && row.deps === 0)
    .sort((a, b) => b.regs - a.regs || a.sub5.localeCompare(b.sub5))
    .slice(0, limit);

  if (!rows.length) return `Проблемных live-sub5 за ${stats.dateYmd} не найдено.`;

  return [
    `Regs without deps ${stats.dateYmd}`,
    ...rows.map((row, index) => `${index + 1}. ${row.regs} regs / 0 deps\n${row.sub5}`),
  ].join('\n\n');
}

function median(values) {
  const numbers = values
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!numbers.length) return NaN;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2
    ? numbers[middle]
    : (numbers[middle - 1] + numbers[middle]) / 2;
}

function buildAutoAlerts(stats, historyStats, config) {
  const minRegsNoDeps = Math.max(1, Number(config.alertMinRegsNoDeps || 10));
  const crMinRegs = Math.max(1, Number(config.alertCrMinRegs || minRegsNoDeps));
  const crDropPercent = Math.min(99, Math.max(1, Number(config.alertCrDropPercent || 50)));
  const alerts = [];

  const noDepRows = stats.groups
    .filter((row) => row.regs >= minRegsNoDeps && row.deps === 0)
    .sort((a, b) => b.regs - a.regs || a.sub5.localeCompare(b.sub5))
    .slice(0, 10);

  if (noDepRows.length) {
    alerts.push({
      type: 'no_deps',
      title: `Много рег без депа: ${noDepRows.length}`,
      rows: noDepRows,
      threshold: minRegsNoDeps,
    });
  }

  const historyCr = historyStats
    .filter((item) => Number(item.regs || 0) >= crMinRegs && Number(item.cr || 0) > 0)
    .map((item) => Number(item.cr));
  const medianCr = median(historyCr);
  const currentCr = Number(stats.cr || 0);
  const triggerCr = Number(stats.regs || 0) >= crMinRegs
    && Number.isFinite(medianCr)
    && medianCr > 0
    && currentCr <= medianCr * (1 - crDropPercent / 100);

  if (triggerCr) {
    alerts.push({
      type: 'cr_drop',
      title: 'CR просел',
      currentCr,
      medianCr,
      crDropPercent,
      crMinRegs,
    });
  }

  return alerts;
}

function formatAutoAlerts(dateYmd, alerts) {
  if (!alerts.length) {
    return [
      `<b>Auto alerts ${escapeHtml(dateYmd)}</b>`,
      '',
      'Критичных сигналов не нашел.',
    ].join('\n');
  }

  const lines = [
    `<b>Auto alerts ${escapeHtml(dateYmd)}</b>`,
  ];

  for (const alert of alerts) {
    lines.push('', `<b>${escapeHtml(alert.title)}</b>`);
    if (alert.type === 'no_deps') {
      lines.push(`Порог: <b>${alert.threshold}</b> рег без депа.`);
      for (const [index, row] of alert.rows.entries()) {
        lines.push(`${index + 1}. <b>${row.regs}</b> regs / 0 deps`);
        lines.push(`<code>${escapeHtml(row.sub5)}</code>`);
      }
    }
    if (alert.type === 'cr_drop') {
      const current = formatSignedPercent(alert.currentCr * 100).replace('+', '');
      const previous = formatSignedPercent(alert.medianCr * 100).replace('+', '');
      lines.push(`Сейчас: <b>${escapeHtml(current)}</b>`);
      lines.push(`Медиана прошлых дней: <b>${escapeHtml(previous)}</b>`);
      lines.push(`Порог просадки: <b>${alert.crDropPercent}%</b>, минимум рег: <b>${alert.crMinRegs}</b>.`);
    }
  }

  return lines.join('\n');
}

function formatDailyDigest({ stats, alerts, lateRows }) {
  const topRows = stats.groups
    .slice()
    .sort((a, b) => b.deps - a.deps || b.regs - a.regs || b.revenue - a.revenue)
    .slice(0, 5);
  const badRows = stats.groups
    .filter((row) => row.regs > 0 && row.deps === 0)
    .sort((a, b) => b.regs - a.regs || a.sub5.localeCompare(b.sub5))
    .slice(0, 5);

  const lines = [
    `<b>Daily digest ${escapeHtml(stats.dateYmd)}</b>`,
    `Regs: <b>${stats.regs}</b>`,
    `Deps: <b>${stats.deps}</b>`,
    `CR: <b>${escapeHtml(formatCr(stats.regs, stats.deps))}</b>`,
    `Revenue: <b>${escapeHtml(formatMoney(stats.revenue))}</b>`,
    `Late sales: <b>${lateRows.length}</b>`,
  ];

  if (topRows.length) {
    lines.push('', '<b>Top sub5</b>');
    for (const [index, row] of topRows.entries()) {
      lines.push(`${index + 1}. ${row.deps} deps / ${row.regs} regs / CR ${escapeHtml(formatCr(row.regs, row.deps))}`);
      lines.push(`<code>${escapeHtml(row.sub5)}</code>`);
    }
  }

  if (badRows.length) {
    lines.push('', '<b>Без депов</b>');
    for (const [index, row] of badRows.entries()) {
      lines.push(`${index + 1}. ${row.regs} regs / 0 deps`);
      lines.push(`<code>${escapeHtml(row.sub5)}</code>`);
    }
  }

  if (alerts.length) {
    lines.push('', '<b>Сигналы</b>');
    for (const alert of alerts) {
      lines.push(`- ${escapeHtml(alert.title)}`);
    }
  }

  if (!topRows.length && !badRows.length && !alerts.length) {
    lines.push('', 'Live-данных за дату пока нет.');
  }

  return lines.join('\n');
}

function resolveDateArg(args, fallback = 'today') {
  const value = args.join(' ').trim() || fallback;
  return toYmd(parseRelativeDate(value));
}

function ymdOffset(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function shiftYmd(dateYmd, days) {
  const [year, month, day] = clean(dateYmd).split('-').map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() + days);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function startsWithDate(value, dateYmd) {
  return clean(value).startsWith(dateYmd);
}

function localDateParts(timeZone, now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function cabinetFreshnessNote(config, dateYmd) {
  const timeZone = config.cabinetTimezone || config.keitaroTimezone || 'Asia/Tbilisi';
  const updateHour = Number.isFinite(config.cabinetUpdateHour) ? config.cabinetUpdateHour : 11;
  const local = localDateParts(timeZone);

  if (dateYmd !== local.ymd || local.hour >= updateHour) return '';

  return [
    '',
    `Note: кабинеты обновляются примерно в ${String(updateHour).padStart(2, '0')}:00 (${timeZone}).`,
    'Сегодняшние данные до этого времени лучше считать предварительными.',
  ].join('\n');
}

function resolveSub5SearchDate(dateInput, config) {
  const source = clean(dateInput || 'today').toLowerCase();
  const startHour = normalizeReportHour(config.cabinetUpdateHour, 11);

  if (source === 'today' || source === 'сегодня') {
    const local = localDateParts(config.keitaroTimezone || DEFAULT_TIMEZONE);
    return local.hour < startHour ? shiftYmd(local.ymd, -1) : local.ymd;
  }

  if (source === 'yesterday' || source === 'вчера') {
    return shiftYmd(resolveSub5SearchDate('today', config), -1);
  }

  return toYmd(parseRelativeDate(source));
}

function buildKeitaroConfig(config, date, verbose = false) {
  return {
    date,
    baseUrl: normalizeBaseUrl(config.keitaroBaseUrl || DEFAULT_BASE_URL),
    apiKey: config.keitaroApiKey,
    timezone: config.keitaroTimezone || DEFAULT_TIMEZONE,
    limit: Number.isFinite(config.apiLimit) && config.apiLimit > 0 ? config.apiLimit : DEFAULT_LIMIT,
    installCampaignGroup: config.costCampaignGroup || '',
    verbose,
  };
}

export class KeitaroTelegramBot {
  constructor({ config, db }) {
    this.config = config;
    this.db = db;
    this.telegram = new TelegramClient(config.telegramBotToken);
    this.offset = 0;
    this.running = false;
    this.chatModes = new Map();
    this.pendingDocumentGroups = new Map();
    this.scheduledAnalyticsRunning = false;
  }

  isAllowed(chatId) {
    const allowed = this.config.telegramAllowedChatIds || [];
    return !allowed.length || allowed.includes(String(chatId));
  }

  async sendToChat(chatId, text, options = {}) {
    return this.telegram.sendMessage(chatId, text, options);
  }

  async sendHtml(chatId, html, options = {}) {
    return this.telegram.sendMessage(chatId, html, { parse_mode: 'HTML', ...options });
  }

  async editHtml(chatId, messageId, html, options = {}) {
    return this.telegram.editMessageText({
      chatId,
      messageId,
      text: html,
      options: { parse_mode: 'HTML', ...options },
    });
  }

  async showMenu(chatId, messageId, text, replyMarkup, options = {}) {
    const messageOptions = { ...options, reply_markup: replyMarkup };
    if (messageId) {
      try {
        return await this.telegram.editMessageText({
          chatId,
          messageId,
          text,
          options: messageOptions,
        });
      } catch {
        // Telegram can reject edits for old or already changed messages. Sending a fresh menu is the fallback.
      }
    }
    return this.telegram.sendMessage(chatId, text, messageOptions);
  }

  async sendMenu(chatId) {
    return this.telegram.sendMessage(chatId, 'Выбери раздел:', {
      reply_markup: mainMenuKeyboard(),
    });
  }

  async notifyConversion(event) {
    if (clean(event.status) !== 'sale' && clean(event.previous_status) !== 'sale') return;

    const chatIds = await this.notificationChatIds();
    if (!chatIds.length) return;

    const text = isLateSaleEvent(event)
      ? formatLateSale(event)
      : [
        clean(event.status) === 'sale' ? 'New sale' : 'Recovered sale',
        formatConversion(event),
      ].join('\n\n');

    await Promise.allSettled(chatIds.map((chatId) => this.telegram.sendMessage(chatId, text)));
  }

  async notificationChatIds() {
    const allowed = this.config.telegramAllowedChatIds || [];
    if (allowed.length) return allowed;

    const chats = await this.db.listChats();
    return [...new Set(chats.filter((chat) => chat.enabled !== false).map((chat) => String(chat.chat_id)))];
  }

  async profileConfig() {
    const profile = await this.db.getProfile();
    return {
      ...this.config,
      keitaroBaseUrl: profile.keitaroBaseUrl || this.config.keitaroBaseUrl || DEFAULT_BASE_URL,
      keitaroApiKey: profile.keitaroApiKey || this.config.keitaroApiKey,
      keitaroTimezone: profile.keitaroTimezone || this.config.keitaroTimezone || DEFAULT_TIMEZONE,
      cabinetUpdateHour: Number.isFinite(Number(profile.cabinetUpdateHour))
        ? Number(profile.cabinetUpdateHour)
        : this.config.cabinetUpdateHour,
      cabinetTimezone: profile.cabinetTimezone || this.config.cabinetTimezone || this.config.keitaroTimezone,
      apiLimit: Number.isFinite(Number(profile.apiLimit)) ? Number(profile.apiLimit) : this.config.apiLimit,
      costCampaignIds: profile.costCampaignIds || this.config.costCampaignIds || [],
      costCurrency: profile.costCurrency || this.config.costCurrency || 'USD',
      costCampaignGroup: profile.costCampaignGroup || this.config.costCampaignGroup || '',
      costAutoPush: Boolean(profile.costAutoPush ?? this.config.costAutoPush),
      costOnlyCampaignUniques: profile.costOnlyCampaignUniques ?? this.config.costOnlyCampaignUniques ?? true,
      openaiApiKey: profile.openaiApiKey || this.config.openaiApiKey || '',
      openaiBaseUrl: profile.openaiBaseUrl || this.config.openaiBaseUrl || 'https://api.openai.com/v1',
      openaiModel: profile.openaiModel || this.config.openaiModel || 'gpt-4o-mini',
      gptCostRoutingEnabled: profile.gptCostRoutingEnabled ?? this.config.gptCostRoutingEnabled ?? true,
      gptCostRoutingMinConfidence: Number.isFinite(Number(profile.gptCostRoutingMinConfidence))
        ? Number(profile.gptCostRoutingMinConfidence)
        : Number.isFinite(Number(this.config.gptCostRoutingMinConfidence))
          ? Number(this.config.gptCostRoutingMinConfidence)
          : 0.85,
      gptCostRoutingCandidateLimit: Number.isFinite(Number(profile.gptCostRoutingCandidateLimit))
        ? Number(profile.gptCostRoutingCandidateLimit)
        : Number.isFinite(Number(this.config.gptCostRoutingCandidateLimit))
          ? Number(this.config.gptCostRoutingCandidateLimit)
          : 40,
      dailyDigestEnabled: profile.dailyDigestEnabled ?? this.config.dailyDigestEnabled ?? true,
      dailyDigestHour: normalizeReportHour(
        Number.isFinite(Number(profile.dailyDigestHour)) ? Number(profile.dailyDigestHour) : this.config.dailyDigestHour,
        this.config.cabinetUpdateHour || 11,
      ),
      autoAlertsEnabled: profile.autoAlertsEnabled ?? this.config.autoAlertsEnabled ?? true,
      alertMinRegsNoDeps: Number.isFinite(Number(profile.alertMinRegsNoDeps))
        ? Number(profile.alertMinRegsNoDeps)
        : Number.isFinite(Number(this.config.alertMinRegsNoDeps))
          ? Number(this.config.alertMinRegsNoDeps)
          : 10,
      alertCrMinRegs: Number.isFinite(Number(profile.alertCrMinRegs))
        ? Number(profile.alertCrMinRegs)
        : Number.isFinite(Number(this.config.alertCrMinRegs))
          ? Number(this.config.alertCrMinRegs)
          : 10,
      alertCrDropPercent: Number.isFinite(Number(profile.alertCrDropPercent))
        ? Number(profile.alertCrDropPercent)
        : Number.isFinite(Number(this.config.alertCrDropPercent))
          ? Number(this.config.alertCrDropPercent)
          : 50,
      lastDailyDigestDate: profile.lastDailyDigestDate || '',
      lastAutoAlertsDate: profile.lastAutoAlertsDate || '',
    };
  }

  async handleUpdate(update) {
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    const message = update.message;
    if (!message?.chat?.id) return;

    const chatId = message.chat.id;
    if (!this.isAllowed(chatId)) return;

    await this.db.saveChat(message.chat);

    if (message.document) {
      try {
        await this.handleDocument(chatId, message.document, message);
      } catch (error) {
        await this.telegram.sendMessage(chatId, `Ошибка: ${error.message}`);
      }
      return;
    }

    if (!message.text) return;

    const parsed = commandParts(message.text);
    if (!parsed) {
      const mode = this.chatModes.get(String(chatId));
      if (mode?.type === 'set_profile') {
        await this.handleSettingValue(chatId, mode.key, message.text);
        return;
      }
      if (mode?.type === 'report_date') {
        this.chatModes.delete(String(chatId));
        await this.askReportWindow(chatId, 'sub5', message.text);
        return;
      }
      if (mode?.type === 'offer_date') {
        this.chatModes.delete(String(chatId));
        await this.askReportWindow(chatId, 'offers', message.text);
        return;
      }
      if (mode?.type === 'stats_date') {
        this.chatModes.delete(String(chatId));
        await this.handleStats(chatId, [message.text], { reply_markup: liveMenuKeyboard() });
        return;
      }
      if (mode?.type === 'find_sub5') {
        await this.handleFindModeMessage(chatId, message.text);
        return;
      }
      if (isLikelySub5(message.text)) {
        await this.handleFindSub5(chatId, message.text);
      }
      return;
    }

    try {
      await this.handleCommand(chatId, parsed);
    } catch (error) {
      await this.telegram.sendMessage(chatId, `Ошибка: ${error.message}`);
    }
  }

  async handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message?.chat?.id;
    const messageId = callbackQuery.message?.message_id;
    const data = callbackQuery.data || '';
    if (!chatId || !this.isAllowed(chatId)) return;

    await this.telegram.answerCallbackQuery(callbackQuery.id).catch(() => {});

    try {
      if (data === 'menu:main') {
        this.chatModes.delete(String(chatId));
        await this.showMenu(chatId, messageId, 'Выбери раздел:', mainMenuKeyboard());
        return;
      }

      if (data === 'menu:reports') {
        await this.showMenu(chatId, messageId, 'Отчеты из Keitaro:', reportKeyboard());
        return;
      }

      if (data === 'menu:report_dates') {
        await this.showMenu(chatId, messageId, 'Что строим за другую дату?', reportDateTypeKeyboard());
        return;
      }

      if (data === 'menu:live') {
        await this.showMenu(chatId, messageId, 'Live-аналитика:', liveMenuKeyboard());
        return;
      }

      if (data === 'menu:spend') {
        await this.showMenu(chatId, messageId, 'Расходы Facebook и costs:', spendKeyboard());
        return;
      }

      if (data === 'menu:search') {
        await this.showMenu(chatId, messageId, 'Поиск по sub5:', searchMenuKeyboard());
        return;
      }

      if (data === 'help') {
        await this.showMenu(chatId, messageId, HELP, mainMenuKeyboard());
        return;
      }

      if (data === 'settings:show' || data === 'menu:settings') {
        await this.handleSettings(chatId, messageId);
        return;
      }

      if (data === 'settings:keitaro') {
        await this.handleSettingsSection(chatId, 'keitaro', messageId);
        return;
      }

      if (data === 'settings:time') {
        await this.handleSettingsSection(chatId, 'time', messageId);
        return;
      }

      if (data === 'settings:costs') {
        await this.handleSettingsSection(chatId, 'costs', messageId);
        return;
      }

      if (data === 'settings:alerts') {
        await this.handleSettingsSection(chatId, 'alerts', messageId);
        return;
      }

      if (data === 'costs:help') {
        await this.sendHtml(chatId, costsHelpText(), { reply_markup: spendKeyboard() });
        return;
      }

      if (data === 'search:format') {
        await this.sendHtml(chatId, [
          '<b>Формат sub5</b>',
          '',
          'Пришли полный sub5 одной строкой или несколько строк сразу.',
          'Пример:',
          '<code>2505|TZ|kkid|817171078066414|VL_TZ22|1-1-2|cbo|1</code>',
        ].join('\n'), { reply_markup: searchMenuKeyboard() });
        return;
      }

      if (data === 'mode:find') {
        await this.enterFindMode(chatId);
        return;
      }

      if (data === 'mode:done') {
        await this.exitMode(chatId);
        return;
      }

      if (data === 'mode:report_date') {
        this.chatModes.set(String(chatId), { type: 'report_date' });
        await this.telegram.sendMessage(chatId, 'Пришли дату для отчета, например 2026-05-26, 26 мая 2026, позавчера или суббота.');
        return;
      }

      if (data === 'mode:offer_date') {
        this.chatModes.set(String(chatId), { type: 'offer_date' });
        await this.telegram.sendMessage(chatId, 'Пришли дату для отчета по офферам, например 2026-05-26, 26 мая 2026, позавчера или суббота.');
        return;
      }

      if (data === 'mode:stats_date') {
        this.chatModes.set(String(chatId), { type: 'stats_date' });
        await this.telegram.sendMessage(chatId, 'Пришли дату для live-статистики, например 2026-05-26 или 26 мая 2026.');
        return;
      }

      if (data.startsWith('set:')) {
        const key = data.slice('set:'.length);
        this.chatModes.set(String(chatId), { type: 'set_profile', key });
        await this.sendHtml(chatId, [
          `<b>${escapeHtml(settingLabel(key))}</b>`,
          '',
          `Пришли новое значение одним сообщением.`,
          `Пример: <code>${escapeHtml(settingExample(key))}</code>`,
        ].join('\n'), { reply_markup: settingsBackKeyboard(key) });
        return;
      }

      if (data.startsWith('report_run:')) {
        const [, kind, dateYmd, startHourRaw] = data.split(':');
        const startHour = normalizeReportHour(startHourRaw, 0);
        if (kind === 'offers') {
          await this.handleOfferReport(chatId, dateYmd, { startHour });
        } else {
          await this.handleReport(chatId, dateYmd, { startHour });
        }
        return;
      }

      if (data === 'report:today') {
        await this.askReportWindow(chatId, 'sub5', 'today');
        return;
      }

      if (data === 'report:yesterday') {
        await this.askReportWindow(chatId, 'sub5', 'yesterday');
        return;
      }

      if (data === 'report:2d') {
        await this.askReportWindow(chatId, 'sub5', '2d');
        return;
      }

      if (data === 'offers:today') {
        await this.askReportWindow(chatId, 'offers', 'today');
        return;
      }

      if (data === 'offers:yesterday') {
        await this.askReportWindow(chatId, 'offers', 'yesterday');
        return;
      }

      if (data === 'offers:2d') {
        await this.askReportWindow(chatId, 'offers', '2d');
        return;
      }

      if (data === 'stats:today') {
        await this.handleStats(chatId, ['today'], { reply_markup: liveMenuKeyboard() });
        return;
      }

      if (data === 'stats:yesterday') {
        await this.handleStats(chatId, ['yesterday'], { reply_markup: liveMenuKeyboard() });
        return;
      }

      if (data === 'sales:today') {
        await this.handleSales(chatId, ['today'], { reply_markup: liveMenuKeyboard() });
        return;
      }

      if (data === 'regs:today') {
        await this.handleRegs(chatId, ['today'], { reply_markup: liveMenuKeyboard() });
        return;
      }

      if (data === 'spend:today') {
        await this.handleSpend(chatId, ['today']);
        return;
      }

      if (data === 'spend:yesterday') {
        await this.handleSpend(chatId, ['yesterday']);
        return;
      }

      if (data === 'accounts:today') {
        await this.handleAccounts(chatId, ['today']);
        return;
      }

      if (data === 'accounts:yesterday') {
        await this.handleAccounts(chatId, ['yesterday']);
        return;
      }

      if (data === 'accounts:7d') {
        await this.handleAccounts(chatId, ['7d']);
        return;
      }

      if (data.startsWith('cost_push:')) {
        const importId = data.slice('cost_push:'.length);
        await this.sendHtml(chatId, [
          '<b>Отправить costs в Keitaro?</b>',
          `Import: <code>${escapeHtml(importId)}</code>`,
        ].join('\n'), { reply_markup: costPushConfirmKeyboard(importId) });
        return;
      }

      if (data.startsWith('cost_push_do:')) {
        await this.handlePushFacebookCosts(chatId, data.slice('cost_push_do:'.length));
        return;
      }

      if (data === 'top:today') {
        await this.handleTop(chatId, ['today'], { reply_markup: liveMenuKeyboard() });
        return;
      }

      if (data === 'bad:today') {
        await this.handleBad(chatId, ['today'], { reply_markup: liveMenuKeyboard() });
        return;
      }

      if (data === 'week') {
        await this.handleWeek(chatId, { reply_markup: liveMenuKeyboard() });
        return;
      }

      if (messageId) {
        await this.telegram.editMessageText({
          chatId,
          messageId,
          text: 'Неизвестная кнопка. Открой меню заново.',
          options: { reply_markup: mainMenuKeyboard() },
        }).catch(() => {});
      }
    } catch (error) {
      await this.telegram.sendMessage(chatId, `Ошибка: ${error.message}`);
    }
  }

  async handleCommand(chatId, parsed) {
    switch (parsed.command) {
      case '/start':
        await this.telegram.sendMessage(chatId, 'Keitaro bot готов. Выбери раздел:', {
          reply_markup: mainMenuKeyboard(),
        });
        break;
      case '/help':
        await this.telegram.sendMessage(chatId, HELP, {
          reply_markup: mainMenuKeyboard(),
        });
        break;
      case '/commands':
        await this.telegram.sendMessage(chatId, COMMANDS, {
          reply_markup: mainMenuKeyboard(),
        });
        break;
      case '/menu':
        await this.sendMenu(chatId);
        break;
      case '/status':
        await this.handleStatus(chatId);
        break;
      case '/settings':
      case '/profile':
        await this.handleSettings(chatId);
        break;
      case '/set':
        await this.handleSet(chatId, parsed.args, parsed.rest);
        break;
      case '/report':
        await this.askReportWindow(chatId, 'sub5', parsed.rest || 'today');
        break;
      case '/offers':
      case '/offer':
        await this.askReportWindow(chatId, 'offers', parsed.rest || 'today');
        break;
      case '/today':
        await this.askReportWindow(chatId, 'sub5', 'today');
        break;
      case '/yesterday':
        await this.askReportWindow(chatId, 'sub5', 'yesterday');
        break;
      case '/stats':
        await this.handleStats(chatId, parsed.args);
        break;
      case '/spend':
      case '/cost':
      case '/costs_report':
        await this.handleSpend(chatId, parsed.args);
        break;
      case '/accounts':
      case '/account':
      case '/accs':
      case '/roi':
      case '/cpa':
        await this.handleAccounts(chatId, parsed.args);
        break;
      case '/digest':
        await this.handleDigest(chatId, parsed.args);
        break;
      case '/alerts':
        await this.handleAlerts(chatId, parsed.args);
        break;
      case '/costs':
        await this.sendHtml(chatId, costsHelpText(), { reply_markup: spendKeyboard() });
        break;
      case '/pushcosts':
        await this.handlePushFacebookCosts(chatId, parsed.args[0] || '');
        break;
      case '/pushcosts_to':
      case '/pushcosts_manual':
        await this.handleManualPushFacebookCosts(chatId, parsed.args);
        break;
      case '/last':
        await this.handleLast(chatId, parsed.args);
        break;
      case '/sales':
        await this.handleSales(chatId, parsed.args);
        break;
      case '/regs':
        await this.handleRegs(chatId, parsed.args);
        break;
      case '/top':
        await this.handleTop(chatId, parsed.args);
        break;
      case '/bad':
        await this.handleBad(chatId, parsed.args);
        break;
      case '/late':
        await this.handleLate(chatId, parsed.args);
        break;
      case '/week':
        await this.handleWeek(chatId);
        break;
      case '/sub5':
        await this.handleSub5(chatId, parsed.rest);
        break;
      case '/find':
        await this.handleFindSub5(chatId, parsed.rest);
        break;
      case '/findmode':
      case '/searchmode':
        await this.enterFindMode(chatId);
        break;
      case '/done':
      case '/exit':
      case '/stop':
        await this.exitMode(chatId);
        break;
      default:
        await this.telegram.sendMessage(chatId, `Не знаю команду ${parsed.command}.\n\nОткрой /menu или посмотри /commands.`);
    }
  }

  async enterFindMode(chatId) {
    this.chatModes.set(String(chatId), { type: 'find_sub5' });
    await this.sendHtml(chatId, [
      '<b>Режим поиска sub5 включен</b>',
      '',
      'Теперь просто присылай один или несколько sub5 строками.',
      'Чтобы выйти: <code>/done</code>, <code>/exit</code> или <code>/stop</code>.',
    ].join('\n'), { reply_markup: findModeKeyboard() });
  }

  async exitMode(chatId) {
    if (!this.chatModes.has(String(chatId))) {
      await this.telegram.sendMessage(chatId, 'Активного режима нет.');
      return;
    }
    this.chatModes.delete(String(chatId));
    await this.sendHtml(chatId, '<b>Режим поиска выключен.</b>');
  }

  async handleStatus(chatId) {
    const chats = await this.db.listChats();
    const config = await this.profileConfig();
    const text = [
      'Status',
      `Keitaro URL: ${config.keitaroBaseUrl || DEFAULT_BASE_URL}`,
      `Keitaro key: ${maskSecret(config.keitaroApiKey)}`,
      `Timezone: ${config.keitaroTimezone || DEFAULT_TIMEZONE}`,
      `Webhook port: ${config.webhookPort}`,
      `Cabinet update: ${config.cabinetUpdateHour}:00 ${config.cabinetTimezone}`,
      `Cost campaign lookup: auto by sub_id_5`,
      `Cost fallback IDs: ${(config.costCampaignIds || []).join(', ') || 'not set'}`,
      `Cost campaign group: ${config.costCampaignGroup || 'buyer from sub_id_5'}`,
      `Cost auto push: ${config.costAutoPush ? 'on' : 'off'}`,
      `GPT cost fallback: ${config.gptCostRoutingEnabled && config.openaiApiKey ? `on (${config.openaiModel}, min ${config.gptCostRoutingMinConfidence})` : 'off'}`,
      `Daily digest: ${config.dailyDigestEnabled ? `on at ${config.dailyDigestHour}:00` : 'off'}`,
      `Auto alerts: ${config.autoAlertsEnabled ? 'on' : 'off'}`,
      `Known chats: ${chats.length}`,
      `Chat allowlist: ${(config.telegramAllowedChatIds || []).length || 'off'}`,
    ].join('\n');
    await this.telegram.sendMessage(chatId, text);
  }

  async handleSettings(chatId, messageId = null) {
    const config = await this.profileConfig();
    const text = [
      'Настройки:',
      '',
      `Keitaro: ${config.keitaroBaseUrl || DEFAULT_BASE_URL}`,
      `API key: ${maskSecret(config.keitaroApiKey)}`,
      `Время: ${config.cabinetUpdateHour}:00 ${config.cabinetTimezone}`,
      `Costs: ${config.costCurrency || 'USD'}, ${config.costAutoPush ? 'автоотправка on' : 'автоотправка off'}`,
      `Алерты: digest ${config.dailyDigestEnabled ? 'on' : 'off'}, автоалерты ${config.autoAlertsEnabled ? 'on' : 'off'}`,
      '',
      'Выбери раздел:',
    ].join('\n');
    await this.showMenu(chatId, messageId, text, settingsMainKeyboard());
  }

  async handleSettingsSection(chatId, section, messageId = null) {
    const profile = await this.db.getProfile();
    const config = await this.profileConfig();
    const sourceLabel = (value) => (
      value !== undefined && value !== null && value !== '' ? 'profile' : 'env/default'
    );
    let lines;

    if (section === 'keitaro') {
      lines = [
        sectionTitle(section),
        '',
        `URL: ${config.keitaroBaseUrl || DEFAULT_BASE_URL} (${sourceLabel(profile.keitaroBaseUrl)})`,
        `API key: ${maskSecret(config.keitaroApiKey)} (${profile.keitaroApiKey ? 'profile' : 'env'})`,
        `Timezone: ${config.keitaroTimezone || DEFAULT_TIMEZONE} (${sourceLabel(profile.keitaroTimezone)})`,
      ];
    } else if (section === 'time') {
      lines = [
        sectionTitle(section),
        '',
        `Час обновления: ${config.cabinetUpdateHour}:00 (${sourceLabel(profile.cabinetUpdateHour)})`,
        `Timezone кабинетов: ${config.cabinetTimezone} (${sourceLabel(profile.cabinetTimezone)})`,
      ];
    } else if (section === 'costs') {
      lines = [
        sectionTitle(section),
        '',
        `Валюта: ${config.costCurrency || 'USD'}`,
        `Группа: ${config.costCampaignGroup || 'buyer from sub_id_5'}`,
        `Автоотправка: ${config.costAutoPush ? 'on' : 'off'}`,
        `Fallback IDs: ${(config.costCampaignIds || []).join(', ') || 'not set'}`,
        `OpenAI key: ${maskSecret(config.openaiApiKey)}`,
        `GPT fallback: ${config.gptCostRoutingEnabled ? 'on' : 'off'}`,
        `GPT model: ${config.openaiModel}`,
        `GPT min confidence: ${config.gptCostRoutingMinConfidence}`,
        `GPT candidates: ${config.gptCostRoutingCandidateLimit}`,
      ];
    } else {
      lines = [
        sectionTitle(section),
        '',
        `Daily digest: ${config.dailyDigestEnabled ? 'on' : 'off'}`,
        `Час digest: ${config.dailyDigestHour}:00 ${config.cabinetTimezone}`,
        `Автоалерты: ${config.autoAlertsEnabled ? 'on' : 'off'}`,
        `Мин. рег без депа: ${config.alertMinRegsNoDeps}`,
        `CR drop: ${config.alertCrDropPercent}% при минимум ${config.alertCrMinRegs} регах`,
      ];
    }

    lines.push('', 'Нажми настройку и пришли новое значение следующим сообщением.');
    await this.showMenu(chatId, messageId, lines.join('\n'), settingsKeyboardForSection(section));
  }

  profilePatchFrom(key, value) {
    const patch = {};
    if (['url', 'base_url', 'keitaro_url'].includes(key)) {
      if (!/^https?:\/\//i.test(value)) throw new Error('URL должен начинаться с http:// или https://');
      patch.keitaroBaseUrl = normalizeBaseUrl(value);
    } else if (['key', 'api_key', 'token', 'keitaro_key'].includes(key)) {
      patch.keitaroApiKey = value;
    } else if (['timezone', 'tz', 'keitaro_timezone'].includes(key)) {
      patch.keitaroTimezone = value;
    } else if (['update_hour', 'hour', 'cabinet_update_hour'].includes(key)) {
      const hour = Number(value);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Час обновления должен быть от 0 до 23.');
      patch.cabinetUpdateHour = hour;
    } else if (['cabinet_timezone', 'cabinet_tz'].includes(key)) {
      patch.cabinetTimezone = value;
    } else if (['cost_campaign_ids', 'campaign_ids', 'keitaro_campaign_ids'].includes(key)) {
      const ids = parseCampaignIds(value);
      if (!ids.length) throw new Error('Укажи ID кампаний Keitaro через запятую: 12,34');
      patch.costCampaignIds = ids;
    } else if (['cost_campaign_group', 'campaign_group', 'keitaro_campaign_group'].includes(key)) {
      patch.costCampaignGroup = clean(value);
    } else if (['cost_currency', 'currency'].includes(key)) {
      const currency = clean(value).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Валюта должна быть в формате USD/EUR/RUB.');
      patch.costCurrency = currency;
    } else if (['cost_auto_push', 'auto_push_costs', 'costs_auto_push'].includes(key)) {
      patch.costAutoPush = parseBooleanSetting(value);
    } else if (['cost_only_uniques', 'only_campaign_uniques'].includes(key)) {
      patch.costOnlyCampaignUniques = parseBooleanSetting(value);
    } else if (['openai_key', 'openai_api_key'].includes(key)) {
      patch.openaiApiKey = value;
    } else if (['openai_model', 'gpt_model'].includes(key)) {
      patch.openaiModel = clean(value);
    } else if (['gpt_cost_routing', 'gpt_costs', 'cost_gpt_fallback'].includes(key)) {
      patch.gptCostRoutingEnabled = parseBooleanSetting(value);
    } else if (['gpt_cost_confidence', 'gpt_cost_min_confidence'].includes(key)) {
      const confidence = Number(value);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('GPT confidence должен быть числом от 0 до 1.');
      patch.gptCostRoutingMinConfidence = confidence;
    } else if (['gpt_cost_candidate_limit', 'gpt_candidates'].includes(key)) {
      patch.gptCostRoutingCandidateLimit = numberSetting(value, { min: 1, max: 100 });
    } else if (['daily_digest', 'daily_digest_enabled', 'digest'].includes(key)) {
      patch.dailyDigestEnabled = parseBooleanSetting(value);
    } else if (['daily_digest_hour', 'digest_hour'].includes(key)) {
      patch.dailyDigestHour = numberSetting(value, { min: 0, max: 23 });
    } else if (['auto_alerts', 'alerts_enabled', 'alerts'].includes(key)) {
      patch.autoAlertsEnabled = parseBooleanSetting(value);
    } else if (['alert_min_regs', 'alert_min_regs_no_deps', 'min_regs_no_deps'].includes(key)) {
      patch.alertMinRegsNoDeps = numberSetting(value, { min: 1, max: 10000 });
    } else if (['alert_cr_drop_pct', 'alert_cr_drop_percent', 'cr_drop_pct'].includes(key)) {
      patch.alertCrDropPercent = numberSetting(value, { min: 1, max: 99 });
    } else if (['alert_cr_min_regs', 'cr_min_regs'].includes(key)) {
      patch.alertCrMinRegs = numberSetting(value, { min: 1, max: 10000 });
    } else {
      throw new Error(`Неизвестная настройка: ${key}`);
    }
    return patch;
  }

  async handleSettingValue(chatId, key, rawValue) {
    const value = clean(rawValue);
    if (!value) {
      await this.telegram.sendMessage(chatId, 'Пустое значение не сохранил.');
      return;
    }

    const patch = this.profilePatchFrom(key, value);
    await this.db.updateProfile(patch);
    this.chatModes.delete(String(chatId));
    await this.sendHtml(chatId, [
      '<b>Настройка сохранена</b>',
      `${escapeHtml(settingLabel(key))}: <code>${escapeHtml(key === 'key' ? maskSecret(value) : value)}</code>`,
    ].join('\n'), { reply_markup: settingsKeyboardForKey(key) });
  }

  async handleSet(chatId, args, rest) {
    const key = clean(args[0]).toLowerCase();
    const value = clean(args.slice(1).join(' ') || rest.slice((args[0] || '').length));

    if (!key || !value) {
      await this.telegram.sendMessage(chatId, [
        'Примеры:',
        '/set url https://ibrkeit.xyz',
        '/set key KEITARO_API_KEY',
        '/set timezone Asia/Yerevan',
        '/set update_hour 11',
        '/set cabinet_timezone Asia/Tbilisi',
        '/set cost_campaign_group kkid',
        '/set cost_currency USD',
        '/set cost_auto_push off',
        '/set daily_digest on',
        '/set auto_alerts on',
        '/set alert_min_regs 10',
      ].join('\n'));
      return;
    }

    const patch = this.profilePatchFrom(key, value);
    await this.db.updateProfile(patch);
    await this.telegram.sendMessage(chatId, `Сохранил настройку ${key}.`, {
      reply_markup: settingsKeyboardForKey(key),
    });
  }

  async askReportWindow(chatId, kind, dateInput) {
    const config = await this.profileConfig();
    const dateYmd = toYmd(parseRelativeDate(dateInput || 'today'));
    await this.telegram.sendMessage(chatId, reportWindowText(kind, dateYmd), {
      reply_markup: reportWindowKeyboard(kind, dateYmd, config.cabinetUpdateHour),
    });
  }

  async handleReport(chatId, dateInput, options = {}) {
    const config = await this.profileConfig();
    if (!config.keitaroApiKey) {
      throw new Error('Не найден Keitaro API key. Задай его через /set key KEITARO_API_KEY.');
    }

    const reportConfig = buildKeitaroConfig(config, dateInput || 'today');
    reportConfig.startHour = normalizeReportHour(options.startHour, 0);

    const report = await buildReport(reportConfig);
    await this.telegram.sendMessage(chatId, summarizeReport(report) + cabinetFreshnessNote(config, report.dateYmd));
    await this.telegram.sendDocument(chatId, {
      filename: `sub5-${report.dateYmd}.csv`,
      content: `\uFEFF${report.csv}`,
      caption: reportWindowCaption(report),
    });
  }

  async handleOfferReport(chatId, dateInput, options = {}) {
    const config = await this.profileConfig();
    if (!config.keitaroApiKey) {
      throw new Error('Не найден Keitaro API key. Задай его через /set key KEITARO_API_KEY.');
    }

    const reportConfig = buildKeitaroConfig(config, dateInput || 'today');
    reportConfig.startHour = normalizeReportHour(options.startHour, 0);

    const report = await buildOfferReport(reportConfig);
    await this.telegram.sendMessage(chatId, summarizeReport(report) + cabinetFreshnessNote(config, report.dateYmd));
    await this.telegram.sendDocument(chatId, {
      filename: `offers-${report.dateYmd}.csv`,
      content: `\uFEFF${report.csv}`,
      caption: reportWindowCaption(report, 'Offers CSV'),
    });
  }

  queueDocumentGroup(chatId, mediaGroupId, document) {
    const key = `${chatId}:${mediaGroupId}`;
    const current = this.pendingDocumentGroups.get(key) || {
      chatId,
      documents: [],
      documentIds: new Set(),
      timer: null,
    };
    const documentId = document.file_unique_id || document.file_id || `${document.file_name || 'file'}:${current.documents.length}`;
    if (!current.documentIds.has(documentId)) {
      current.documentIds.add(documentId);
      current.documents.push(document);
    }

    if (current.timer) clearTimeout(current.timer);
    current.timer = setTimeout(() => {
      this.pendingDocumentGroups.delete(key);
      this.handleDocuments(current.chatId, current.documents).catch(async (error) => {
        await this.telegram.sendMessage(current.chatId, `Ошибка: ${error.message}`).catch(() => {});
      });
    }, DOCUMENT_GROUP_COLLECT_MS);

    this.pendingDocumentGroups.set(key, current);
  }

  async handleDocument(chatId, document, message = {}) {
    if (message.media_group_id) {
      this.queueDocumentGroup(chatId, message.media_group_id, document);
      return;
    }

    await this.handleDocuments(chatId, [document]);
  }

  async handleDocuments(chatId, documents) {
    const safeDocuments = (Array.isArray(documents) ? documents : []).filter(Boolean);
    if (!safeDocuments.length) return;

    const invalidFiles = safeDocuments
      .map((document) => document.file_name || '')
      .filter((filename) => !/\.csv$/i.test(filename));
    if (invalidFiles.length) {
      await this.telegram.sendMessage(chatId, [
        'Сейчас я понимаю только CSV-файлы с расходами Facebook Ads.',
        `Не CSV: ${invalidFiles.join(', ')}`,
      ].join('\n'), {
        reply_markup: spendKeyboard(),
      });
      return;
    }

    const config = await this.profileConfig();
    const parsedFiles = [];
    for (const [index, document] of safeDocuments.entries()) {
      const filename = document.file_name || `facebook-spend-${index + 1}.csv`;
      const file = await this.telegram.getFile(document.file_id);
      const buffer = await this.telegram.downloadFile(file.file_path);
      const text = decodeTelegramText(buffer);
      let batch;
      try {
        batch = parseFacebookSpendCsv(text, {
          currency: config.costCurrency || 'USD',
        });
      } catch (error) {
        throw new Error(`${filename}: ${error.message}`);
      }

      batch.files = [{
        filename,
        sourceRows: batch.sourceRows,
        groupedRows: batch.rows.length,
        totalSpend: batch.totalSpend,
        dates: batch.dates,
      }];
      batch.rows = batch.rows.map((row) => ({
        ...row,
        sourceFiles: [filename],
      }));
      parsedFiles.push({ filename, batch });
    }

    const importBatch = combineFacebookSpendImports(
      parsedFiles.map((file) => file.batch),
      { force: parsedFiles.length > 1, currency: config.costCurrency || 'USD' },
    );
    const filenames = parsedFiles.map((file) => file.filename);

    await this.db.saveFacebookSpendImport(importBatch, {
      filename: filenames[0],
      filenames,
      file_count: filenames.length,
      chat_id: String(chatId),
    });

    const canPush = Boolean(config.keitaroApiKey);
    await this.sendHtml(chatId, formatSpendImport(importBatch, canPush), {
      reply_markup: spendKeyboard(canPush ? importBatch.importId : ''),
    });

    if (canPush && config.costAutoPush) {
      await this.handlePushFacebookCosts(chatId, importBatch.importId);
    }
  }

  async handleSpend(chatId, args) {
    const dateYmd = resolveDateArg(args, 'today');
    const stats = await this.db.facebookSpendStats(dateYmd);
    if (!stats.groups) {
      await this.sendHtml(chatId, [
        `<b>FB spend ${escapeHtml(dateYmd)}</b>`,
        '',
        'Расходов пока нет. Пришли CSV-файл из Ads Manager прямо в этот чат.',
      ].join('\n'), { reply_markup: spendKeyboard() });
      return;
    }

    await this.sendHtml(chatId, formatSpendStats(stats), { reply_markup: spendKeyboard() });
  }

  async handleAccounts(chatId, args) {
    const config = await this.profileConfig();
    if (!config.keitaroApiKey) {
      throw new Error('Не найден Keitaro API key. Задай его через /set key KEITARO_API_KEY.');
    }

    const period = parseAccountsPeriod(args, config);
    const startHour = normalizeReportHour(config.cabinetUpdateHour, 11);
    const progressMessage = await this.sendHtml(chatId, [
      '<b>Считаю эффективность аккаунтов</b>',
      period.dates.length === 1
        ? `Дата: <code>${escapeHtml(period.dates[0])}</code>`
        : `Период: <code>${escapeHtml(period.dates[0])} - ${escapeHtml(period.dates[period.dates.length - 1])}</code>`,
      `Окно: <code>${formatHour(startHour)}:00-${formatHour((startHour + 23) % 24)}:59 Keitaro</code>`,
      '',
      'Загружаю Keitaro-конверсии и FB spend...',
    ].join('\n'));
    const progressMessageId = progressMessage?.message_id;
    let lastProgressText = '';
    const showProgress = async (lines) => {
      if (!progressMessageId) return;
      const text = Array.isArray(lines) ? lines.join('\n') : String(lines);
      if (text === lastProgressText) return;
      lastProgressText = text;
      await this.editHtml(chatId, progressMessageId, text).catch(() => {});
    };

    const loadPerformanceForDate = async (dateYmd) => {
      const reportConfig = buildKeitaroConfig(config, dateYmd);
      reportConfig.startHour = startHour;
      const [report, spendStats] = await Promise.all([
        buildAccountReport(reportConfig),
        this.db.facebookSpendStats(dateYmd),
      ]);
      return buildAccountPerformance(report, spendStats);
    };

    if (period.dates.length === 1) {
      const dateYmd = period.dates[0];
      const performance = await loadPerformanceForDate(dateYmd);
      const finalText = formatAccountPerformance(performance) + cabinetFreshnessNote(config, dateYmd);

      if (progressMessageId) {
        await this.editHtml(chatId, progressMessageId, finalText, { reply_markup: spendKeyboard() })
          .catch(() => this.sendHtml(chatId, finalText, { reply_markup: spendKeyboard() }));
      } else {
        await this.sendHtml(chatId, finalText, { reply_markup: spendKeyboard() });
      }
      return;
    }

    const performances = [];
    for (const [index, dateYmd] of period.dates.entries()) {
      await showProgress([
        '<b>Считаю эффективность аккаунтов</b>',
        `Период: <code>${escapeHtml(period.dates[0])} - ${escapeHtml(period.dates[period.dates.length - 1])}</code>`,
        `День <b>${index + 1}/${period.dates.length}</b>: <code>${escapeHtml(dateYmd)}</code>`,
        `Окно: <code>${formatHour(startHour)}:00-${formatHour((startHour + 23) % 24)}:59 Keitaro</code>`,
        '',
        'Собираю Keitaro-конверсии и FB spend по дням...',
      ]);
      performances.push(await loadPerformanceForDate(dateYmd));
    }

    const trend = buildAccountTrend(performances);
    const finalText = formatAccountTrend(trend);

    if (progressMessageId) {
      await this.editHtml(chatId, progressMessageId, finalText, { reply_markup: spendKeyboard() })
        .catch(() => this.sendHtml(chatId, finalText, { reply_markup: spendKeyboard() }));
    } else {
      await this.sendHtml(chatId, finalText, { reply_markup: spendKeyboard() });
    }
  }

  async handlePushFacebookCosts(chatId, importId) {
    if (!clean(importId)) {
      await this.telegram.sendMessage(chatId, 'Укажи import ID: /pushcosts IMPORT_ID');
      return;
    }

    const config = await this.profileConfig();
    if (!config.keitaroApiKey) throw new Error('Не найден Keitaro API key. Задай /set key KEITARO_API_KEY.');
    const importBatch = await this.db.getFacebookImport(importId);
    if (!importBatch?.rows?.length) throw new Error(`Не нашел импорт ${importId}.`);
    const costWindowStartHour = normalizeReportHour(config.cabinetUpdateHour, 11);
    const importRows = importBatch.rows.map((row, index) => ({ ...row, rowNumber: index + 1 }));
    const progressMessage = await this.sendHtml(chatId, [
      '<b>Отправляю costs в Keitaro</b>',
      `Import: <code>${escapeHtml(importId)}</code>`,
      `Строк в импорте: <b>${importRows.length}</b>`,
      `Окно costs: <code>${formatHour(costWindowStartHour)}:00-${formatHour((costWindowStartHour + 23) % 24)}:59 Keitaro</code>`,
      '',
      'Шаг 1/3: проверяю, что это свежий импорт.',
    ].join('\n'));
    const progressMessageId = progressMessage?.message_id;
    let lastProgressText = '';
    const showProgress = async (lines) => {
      if (!progressMessageId) return;
      const text = Array.isArray(lines) ? lines.join('\n') : String(lines);
      if (text === lastProgressText) return;
      lastProgressText = text;
      await this.editHtml(chatId, progressMessageId, text).catch(() => {});
    };

    const latestByKey = new Map();
    const latestSnapshotByKey = {};
    const importDates = [...new Set(importRows.map((row) => row.dateYmd).filter(Boolean))];
    for (const dateYmd of importDates) {
      const latestRows = await this.db.facebookSpendForDate(dateYmd);
      for (const row of latestRows) {
        latestByKey.set(spendRowKey(row), row);
      }
      Object.assign(latestSnapshotByKey, await this.db.facebookSpendSnapshotIndex(dateYmd));
    }

    const freshRows = [];
    const staleRows = [];
    for (const row of importRows) {
      const latest = latestByKey.get(spendRowKey(row));
      const latestSnapshot = latestSnapshotByKey[spendSnapshotKey(row)];
      if (
        (latest && latest.import_id && latest.import_id !== importId)
        || (latestSnapshot?.import_id && latestSnapshot.import_id !== importId)
      ) {
        staleRows.push(row);
      } else {
        freshRows.push(row);
      }
    }

    if (!freshRows.length) {
      throw new Error('Этот импорт уже не последний для своих sub_id_5. Пришли свежий CSV или пушь последний импорт.');
    }

    await showProgress([
      '<b>Отправляю costs в Keitaro</b>',
      `Import: <code>${escapeHtml(importId)}</code>`,
      `Свежих строк: <b>${freshRows.length}</b>`,
      staleRows.length ? `Устаревших строк: <b>${staleRows.length}</b>` : '',
      '',
      `Шаг 2/3: ищу campaign_id в группе <code>${escapeHtml(config.costCampaignGroup || 'buyer из sub_id_5')}</code>.`,
      'Keitaro API может отвечать несколько секунд.',
    ].filter(Boolean));

    const result = await pushFacebookCostsToKeitaro({
      baseUrl: normalizeBaseUrl(config.keitaroBaseUrl || DEFAULT_BASE_URL),
      apiKey: config.keitaroApiKey,
      campaignIds: config.costCampaignIds,
      spendRows: freshRows,
      timezone: config.keitaroTimezone || DEFAULT_TIMEZONE,
      currency: config.costCurrency || importBatch.currency || 'USD',
      onlyCampaignUniques: config.costOnlyCampaignUniques !== false,
      campaignGroup: config.costCampaignGroup || '',
      gptRouting: {
        enabled: config.gptCostRoutingEnabled,
        openaiApiKey: config.openaiApiKey,
        openaiBaseUrl: config.openaiBaseUrl,
        openaiModel: config.openaiModel,
        minConfidence: config.gptCostRoutingMinConfidence,
        candidateLimit: config.gptCostRoutingCandidateLimit,
      },
      windowStartHour: costWindowStartHour,
      onProgress: async (event) => {
        if (event.stage === 'lookup') {
          await showProgress([
            '<b>Отправляю costs в Keitaro</b>',
            `Import: <code>${escapeHtml(importId)}</code>`,
            `Шаг 2/3: ищу campaign_id <b>${event.current}/${event.total}</b>.`,
            event.row?.creative ? `Строка: <code>${escapeHtml(event.row.creative)}</code>` : '',
          ].filter(Boolean));
        }
        if (event.stage === 'resolved') {
          await showProgress([
            '<b>Отправляю costs в Keitaro</b>',
            `Import: <code>${escapeHtml(importId)}</code>`,
            `Нашел строк: <b>${event.resolvedRows.length}</b>`,
            `Не нашел: <b>${event.unresolvedRows.length}</b>`,
            event.gptResolvedRows?.length ? `GPT нашел: <b>${event.gptResolvedRows.length}</b>` : '',
            '',
            'Шаг 3/3: отправляю bulk job в Keitaro.',
          ].filter(Boolean));
        }
        if (event.stage === 'gpt_prepare') {
          await showProgress([
            '<b>Отправляю costs в Keitaro</b>',
            `Import: <code>${escapeHtml(importId)}</code>`,
            `GPT fallback: проверяю <b>${event.total}</b> строк без campaign_id.`,
          ]);
        }
        if (event.stage === 'gpt_lookup') {
          await showProgress([
            '<b>Отправляю costs в Keitaro</b>',
            `Import: <code>${escapeHtml(importId)}</code>`,
            `GPT fallback: строка <b>${event.current}/${event.total}</b>.`,
            event.row?.creative ? `Строка: <code>${escapeHtml(event.row.creative)}</code>` : '',
            `Кандидатов: <b>${event.candidates?.length || 0}</b>`,
          ].filter(Boolean));
        }
        if (event.stage === 'send_job') {
          await showProgress([
            '<b>Отправляю costs в Keitaro</b>',
            `Import: <code>${escapeHtml(importId)}</code>`,
            `Шаг 3/3: отправляю bulk job <b>${event.current}/${event.total}</b>.`,
            `Кампании: <code>${escapeHtml((event.payload?.campaign_ids || []).join(', ') || '-')}</code>`,
            `Строк в job: <b>${event.payload?.costs?.length || 0}</b>`,
          ]);
        }
      },
    });

    await this.db.markFacebookImportPushed(importId, {
      costRows: result.costRows,
      totalCost: result.totalCost,
      data: result.data,
      unresolvedRows: result.unresolvedRows,
      ambiguousRows: result.ambiguousRows,
      gptResolvedRows: result.gptResolvedRows,
      gptAttemptedRows: result.gptAttemptedRows,
      staleRows,
    });

    const skippedCount = staleRows.length + (result.unresolvedRows?.length || 0) + (result.ambiguousRows?.length || 0);
    const costCurrency = config.costCurrency || importBatch.currency || 'USD';
    const responseLines = [
      '<b>Costs отправлены в Keitaro</b>',
      `Import: <code>${escapeHtml(importId)}</code>`,
      `Keitaro campaigns: <code>${escapeHtml((result.campaignIds || []).join(', ') || '-')}</code>`,
      `Campaign groups: <code>${escapeHtml((result.campaignGroups || []).join(', ') || '-')}</code>`,
      `Окно costs: <code>${formatHour(costWindowStartHour)}:00-${formatHour((costWindowStartHour + 23) % 24)}:59 Keitaro</code>`,
      `Строк costs: <b>${result.costRows}</b>`,
      `Сумма: <b>${escapeHtml(formatMoney(result.totalCost))} ${escapeHtml(costCurrency)}</b>`,
    ];
    if (result.gptResolvedRows?.length) {
      responseLines.push(`GPT fallback: <b>${result.gptResolvedRows.length}</b> строк.`);
    }
    if (skippedCount) {
      responseLines.push(`Skipped: <b>${skippedCount}</b> строк.`);
      if (staleRows.length) {
        responseLines.push(`Из них устаревших импортов: <b>${staleRows.length}</b>.`);
      }
      if (result.unresolvedRows?.length) {
        const skippedRows = result.unresolvedRows.map((row) => row.rowNumber).filter(Boolean).join(',');
        const suggestedCampaignId = result.campaignIds?.length === 1 ? result.campaignIds[0] : '';
        responseLines.push(
          `Не нашел campaign_id в Keitaro: <b>${result.unresolvedRows.length}</b>.`,
          ...formatSkippedCostRows(result.unresolvedRows, costCurrency),
          '',
          'Ручная отправка работает так: одна команда = одна кампания + выбранные номера строк.',
          suggestedCampaignId
            ? 'Если все эти строки надо докинуть в найденную основную кампанию:'
            : 'Если все эти строки надо докинуть в одну кампанию, замени CAMPAIGN_ID на ID нужной кампании:',
          suggestedCampaignId
            ? `<code>/pushcosts_to ${escapeHtml(importId)} ${suggestedCampaignId} ${escapeHtml(skippedRows || 'ROWS')}</code>`
            : `<code>/pushcosts_to ${escapeHtml(importId)} CAMPAIGN_ID ${escapeHtml(skippedRows || 'ROWS')}</code>`,
          'Если строки надо разнести по разным кампаниям, отправь несколько команд:',
          `<code>/pushcosts_to ${escapeHtml(importId)} CAMPAIGN_ID_1 2,4</code>`,
          `<code>/pushcosts_to ${escapeHtml(importId)} CAMPAIGN_ID_2 5,7</code>`,
          'Последние числа - это номера строк # из списка выше.',
        );
      }
      if (result.ambiguousRows?.length) {
        responseLines.push(
          `Неоднозначных строк: <b>${result.ambiguousRows.length}</b>.`,
          ...formatSkippedCostRows(result.ambiguousRows, costCurrency),
        );
      }
    }
    responseLines.push('', 'Keitaro поставил bulk job в очередь. Обновление в отчетах может появиться не сразу.');

    const finalText = responseLines.join('\n');
    if (progressMessageId) {
      await this.editHtml(chatId, progressMessageId, finalText, { reply_markup: spendKeyboard() })
        .catch(() => this.sendHtml(chatId, finalText, { reply_markup: spendKeyboard() }));
    } else {
      await this.sendHtml(chatId, finalText, { reply_markup: spendKeyboard() });
    }
  }

  async handleManualPushFacebookCosts(chatId, args) {
    const importId = clean(args[0]);
    const campaignId = Number(args[1]);
    const selection = clean(args.slice(2).join(' '));

    if (!importId || !Number.isInteger(campaignId) || campaignId <= 0 || !selection) {
      await this.sendHtml(chatId, [
        'Формат:',
        '<code>/pushcosts_to IMPORT_ID CAMPAIGN_ID ROWS</code>',
        '',
        'Одна команда отправляет выбранные строки в одну кампанию.',
        'Если строки нужны в разных кампаниях, отправь несколько команд.',
        '',
        'Примеры:',
        '<code>/pushcosts_to mpmrik83-fdd35f 27234 2,4,7</code>',
        '<code>/pushcosts_to mpmrik83-fdd35f 28061 5</code>',
      ].join('\n'));
      return;
    }

    const config = await this.profileConfig();
    if (!config.keitaroApiKey) throw new Error('Не найден Keitaro API key. Задай /set key KEITARO_API_KEY.');
    const costWindowStartHour = normalizeReportHour(config.cabinetUpdateHour, 11);

    const importBatch = await this.db.getFacebookImport(importId);
    if (!importBatch?.rows?.length) throw new Error(`Не нашел импорт ${importId}.`);

    const importRows = importBatch.rows.map((row, index) => ({ ...row, rowNumber: index + 1 }));
    const rowNumbers = parseRowSelection(selection, importRows.length);
    if (!rowNumbers.length) {
      throw new Error(`Не понял номера строк. Используй, например: /pushcosts_to ${importId} ${campaignId} 2,4,7`);
    }

    const selectedRows = importRows.filter((row) => rowNumbers.includes(row.rowNumber));
    const progressMessage = await this.sendHtml(chatId, [
      '<b>Отправляю manual costs в Keitaro</b>',
      `Import: <code>${escapeHtml(importId)}</code>`,
      `Campaign: <code>${campaignId}</code>`,
      `Строки: <code>${escapeHtml(rowNumbers.join(','))}</code>`,
      `Окно costs: <code>${formatHour(costWindowStartHour)}:00-${formatHour((costWindowStartHour + 23) % 24)}:59 Keitaro</code>`,
      '',
      'Отправляю bulk job...',
    ].join('\n'));
    const progressMessageId = progressMessage?.message_id;
    const showProgress = async (lines) => {
      if (!progressMessageId) return;
      const text = Array.isArray(lines) ? lines.join('\n') : String(lines);
      await this.editHtml(chatId, progressMessageId, text).catch(() => {});
    };

    const result = await pushFacebookCostsToKeitaro({
      baseUrl: normalizeBaseUrl(config.keitaroBaseUrl || DEFAULT_BASE_URL),
      apiKey: config.keitaroApiKey,
      campaignIds: [campaignId],
      spendRows: selectedRows,
      timezone: config.keitaroTimezone || DEFAULT_TIMEZONE,
      currency: config.costCurrency || importBatch.currency || 'USD',
      onlyCampaignUniques: config.costOnlyCampaignUniques !== false,
      forceCampaignIds: true,
      windowStartHour: costWindowStartHour,
      onProgress: async (event) => {
        if (event.stage !== 'send_job') return;
        await showProgress([
          '<b>Отправляю manual costs в Keitaro</b>',
          `Import: <code>${escapeHtml(importId)}</code>`,
          `Campaign: <code>${campaignId}</code>`,
          `Bulk job: <b>${event.current}/${event.total}</b>`,
          `Строк в job: <b>${event.payload?.costs?.length || 0}</b>`,
        ]);
      },
    });

    await this.db.markFacebookImportPushed(importId, {
      manual: true,
      campaignIds: [campaignId],
      rowNumbers,
      costRows: result.costRows,
      totalCost: result.totalCost,
      data: result.data,
    });

    const costCurrency = config.costCurrency || importBatch.currency || 'USD';
    const finalText = [
      '<b>Manual costs отправлены в Keitaro</b>',
      `Import: <code>${escapeHtml(importId)}</code>`,
      `Campaign: <code>${campaignId}</code>`,
      `Строки: <code>${escapeHtml(rowNumbers.join(','))}</code>`,
      `Окно costs: <code>${formatHour(costWindowStartHour)}:00-${formatHour((costWindowStartHour + 23) % 24)}:59 Keitaro</code>`,
      `Строк costs: <b>${result.costRows}</b>`,
      `Сумма: <b>${escapeHtml(formatMoney(result.totalCost))} ${escapeHtml(costCurrency)}</b>`,
      '',
      ...formatManualCostRows(selectedRows, costCurrency, campaignId),
    ].join('\n');
    if (progressMessageId) {
      await this.editHtml(chatId, progressMessageId, finalText, { reply_markup: spendKeyboard() })
        .catch(() => this.sendHtml(chatId, finalText, { reply_markup: spendKeyboard() }));
    } else {
      await this.sendHtml(chatId, finalText, { reply_markup: spendKeyboard() });
    }
  }

  async handleStats(chatId, args, options = {}) {
    const dateYmd = resolveDateArg(args, 'today');
    const stats = await this.db.statsForDate(dateYmd);
    const config = await this.profileConfig();
    await this.telegram.sendMessage(chatId, formatStats(stats) + cabinetFreshnessNote(config, dateYmd), options);
  }

  async handleLast(chatId, args) {
    const limit = Math.min(Math.max(Number(args[0] || 20), 1), 50);
    const rows = await this.db.listConversions({ limit });
    if (!rows.length) {
      await this.telegram.sendMessage(chatId, 'Live-конверсий пока нет.');
      return;
    }

    await this.telegram.sendMessage(chatId, rows.map(formatConversion).join('\n\n'));
  }

  async handleSales(chatId, args, options = {}) {
    const dateYmd = resolveDateArg(args, 'today');
    const rows = await this.db.listConversions({ status: 'sale', dateYmd, limit: 30 });
    if (!rows.length) {
      await this.telegram.sendMessage(chatId, `Live-продаж за ${dateYmd} пока нет.`, options);
      return;
    }
    const config = await this.profileConfig();
    await this.telegram.sendMessage(chatId, rows.map(formatConversion).join('\n\n') + cabinetFreshnessNote(config, dateYmd), options);
  }

  async handleRegs(chatId, args, options = {}) {
    const dateYmd = resolveDateArg(args, 'today');
    const rows = (await this.db.listConversions({ limit: 500 }))
      .filter((event) => ['lead', 'sale'].includes(clean(event.status)))
      .filter((event) => startsWithDate(event.postback_datetime, dateYmd))
      .slice(0, 30);

    if (!rows.length) {
      await this.telegram.sendMessage(chatId, `Live-рег за ${dateYmd} пока нет.`, options);
      return;
    }
    const config = await this.profileConfig();
    await this.telegram.sendMessage(chatId, rows.map(formatConversion).join('\n\n') + cabinetFreshnessNote(config, dateYmd), options);
  }

  async handleTop(chatId, args, options = {}) {
    const dateYmd = resolveDateArg(args, 'today');
    const stats = await this.db.statsForDate(dateYmd);
    const config = await this.profileConfig();
    await this.telegram.sendMessage(chatId, formatTop(stats) + cabinetFreshnessNote(config, dateYmd), options);
  }

  async handleBad(chatId, args, options = {}) {
    const dateYmd = resolveDateArg(args, 'today');
    const stats = await this.db.statsForDate(dateYmd);
    const config = await this.profileConfig();
    await this.telegram.sendMessage(chatId, formatBad(stats) + cabinetFreshnessNote(config, dateYmd), options);
  }

  async handleLate(chatId, args, options = {}) {
    const dateYmd = resolveDateArg(args, 'today');
    const rows = (await this.db.listConversions({ status: 'sale', dateYmd, limit: 100 }))
      .filter((event) => !startsWithDate(event.postback_datetime, dateYmd))
      .slice(0, 30);

    if (!rows.length) {
      await this.telegram.sendMessage(chatId, `Late sales за ${dateYmd} не найдено.`, options);
      return;
    }
    const config = await this.profileConfig();
    await this.telegram.sendMessage(chatId, [
      `Late sales ${dateYmd}`,
      ...rows.map(formatConversion),
    ].join('\n\n') + cabinetFreshnessNote(config, dateYmd), options);
  }

  async handleWeek(chatId, options = {}) {
    const lines = ['Live week'];
    for (let index = 0; index < 7; index += 1) {
      const dateYmd = ymdOffset(index);
      const stats = await this.db.statsForDate(dateYmd);
      lines.push(`${dateYmd}: ${stats.regs} regs / ${stats.deps} deps / CR ${formatCr(stats.regs, stats.deps)} / rev ${formatMoney(stats.revenue)}`);
    }
    await this.telegram.sendMessage(chatId, lines.join('\n'), options);
  }

  async digestData(dateYmd, config = null) {
    const effectiveConfig = config || await this.profileConfig();
    const [stats, lateRows, ...historyStats] = await Promise.all([
      this.db.statsForDate(dateYmd),
      this.db.listConversions({ status: 'sale', dateYmd, limit: 100 })
        .then((rows) => rows.filter(isLateSaleEvent)),
      ...Array.from({ length: 7 }, (_, index) => this.db.statsForDate(shiftYmd(dateYmd, -(index + 1)))),
    ]);
    const alerts = buildAutoAlerts(stats, historyStats, effectiveConfig);
    return { stats, lateRows, historyStats, alerts };
  }

  async handleDigest(chatId, args) {
    const config = await this.profileConfig();
    const dateYmd = resolveDateArg(args, shiftYmd(localDateParts(config.cabinetTimezone || config.keitaroTimezone).ymd, -1));
    const digest = await this.digestData(dateYmd, config);
    await this.sendHtml(chatId, formatDailyDigest(digest), { reply_markup: liveMenuKeyboard() });
  }

  async handleAlerts(chatId, args) {
    const config = await this.profileConfig();
    const dateYmd = resolveDateArg(args, shiftYmd(localDateParts(config.cabinetTimezone || config.keitaroTimezone).ymd, -1));
    const digest = await this.digestData(dateYmd, config);
    await this.sendHtml(chatId, formatAutoAlerts(dateYmd, digest.alerts), { reply_markup: liveMenuKeyboard() });
  }

  async runScheduledAnalytics(now = new Date()) {
    if (this.scheduledAnalyticsRunning) return;
    this.scheduledAnalyticsRunning = true;
    try {
      const config = await this.profileConfig();
      const timeZone = config.cabinetTimezone || config.keitaroTimezone || 'Asia/Tbilisi';
      const local = localDateParts(timeZone, now);
      const digestHour = normalizeReportHour(config.dailyDigestHour, config.cabinetUpdateHour || 11);
      if (local.hour < digestHour) return;

      const dateYmd = shiftYmd(local.ymd, -1);
      const shouldSendDigest = config.dailyDigestEnabled !== false
        && config.lastDailyDigestDate !== dateYmd;
      const shouldSendAlerts = config.autoAlertsEnabled !== false
        && config.lastAutoAlertsDate !== dateYmd;
      if (!shouldSendDigest && !shouldSendAlerts) return;

      const chatIds = await this.notificationChatIds();
      if (!chatIds.length) return;

      const digest = await this.digestData(dateYmd, config);
      const patch = {};

      if (shouldSendDigest) {
        const text = formatDailyDigest(digest);
        const results = await Promise.allSettled(chatIds.map((chatId) => this.sendHtml(chatId, text)));
        if (results.some((result) => result.status === 'fulfilled')) {
          patch.lastDailyDigestDate = dateYmd;
        }
      }

      if (shouldSendAlerts) {
        const text = formatAutoAlerts(dateYmd, digest.alerts);
        const shouldActuallySend = digest.alerts.length > 0 || !shouldSendDigest;
        if (shouldActuallySend) {
          const results = await Promise.allSettled(chatIds.map((chatId) => this.sendHtml(chatId, text)));
          if (results.some((result) => result.status === 'fulfilled')) {
            patch.lastAutoAlertsDate = dateYmd;
          }
        } else {
          patch.lastAutoAlertsDate = dateYmd;
        }
      }

      if (Object.keys(patch).length) {
        await this.db.updateProfile(patch);
      }
    } finally {
      this.scheduledAnalyticsRunning = false;
    }
  }

  async handleSub5(chatId, sub5) {
    if (!clean(sub5)) {
      await this.telegram.sendMessage(chatId, 'Пример: /sub5 2505|TZ|kkid|817...|VL_TZ22|1-1-2|cbo|1');
      return;
    }
    await this.telegram.sendMessage(chatId, formatSub5Details(sub5));
  }

  async getSub5Summary(sub5, date = 'today') {
    const config = await this.profileConfig();
    const dateYmd = resolveSub5SearchDate(date, config);
    const startHour = normalizeReportHour(config.cabinetUpdateHour, 11);
    let summary;
    let source;

    if (config.keitaroApiKey) {
      summary = await buildSub5Summary({
        sub5,
        date: dateYmd,
        startHour,
        baseUrl: normalizeBaseUrl(config.keitaroBaseUrl || DEFAULT_BASE_URL),
        apiKey: config.keitaroApiKey,
        timezone: config.keitaroTimezone || DEFAULT_TIMEZONE,
        installCampaignGroup: config.costCampaignGroup || parseSub5(sub5).buyer,
        limit: Number.isFinite(config.apiLimit) && config.apiLimit > 0 ? config.apiLimit : DEFAULT_LIMIT,
      });
      source = 'Keitaro API';
    } else {
      summary = await this.db.statsForSub5(sub5, dateYmd, { startHour });
      source = 'local live log';
    }

    return { summary, source };
  }

  async handleFindSub5(chatId, sub5Input) {
    const sub5 = clean(sub5Input);
    if (!isLikelySub5(sub5)) {
      await this.telegram.sendMessage(chatId, 'Пришли полный sub5 или используй /find 2505|TZ|...');
      return;
    }

    const { summary, source } = await this.getSub5Summary(sub5);
    await this.sendHtml(chatId, formatSub5SearchResult(summary, source));
  }

  async handleFindModeMessage(chatId, text) {
    const items = text
      .split(/\r?\n/)
      .map(clean)
      .filter(Boolean);

    const sub5List = items.filter(isLikelySub5).slice(0, 10);
    if (!sub5List.length) {
      await this.sendHtml(chatId, [
        '<b>Не вижу sub5 в сообщении.</b>',
        '',
        'Пришли строку формата:',
        '<code>2505|TZ|kkid|817...|VL_TZ22|1-1-2|cbo|1</code>',
        '',
        'Выход из режима: <code>/done</code>',
      ].join('\n'));
      return;
    }

    if (items.length > 10) {
      await this.telegram.sendMessage(chatId, 'Взял первые 10 строк, чтобы Telegram не захлебнулся сообщениями.');
    }

    for (const sub5 of sub5List) {
      await this.handleFindSub5(chatId, sub5);
    }
  }

  async start() {
    this.running = true;
    console.log('Telegram bot polling started');

    while (this.running) {
      try {
        const updates = await this.telegram.getUpdates({ offset: this.offset, timeout: 30 });
        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      } catch (error) {
        console.error(`Telegram polling error: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  stop() {
    this.running = false;
  }
}
