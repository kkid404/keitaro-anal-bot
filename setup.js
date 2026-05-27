#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(scriptDir, '.env');
const envExamplePath = path.join(scriptDir, '.env.example');

const ENV_ORDER = [
  'KEITARO_BASE_URL',
  'KEITARO_API_KEY',
  'KEITARO_TIMEZONE',
  'KEITARO_API_LIMIT',
  'CABINET_UPDATE_HOUR',
  'CABINET_TIMEZONE',
  'KEITARO_COST_CAMPAIGN_IDS',
  'COST_CURRENCY',
  'COST_CAMPAIGN_GROUP',
  'COST_AUTO_PUSH',
  'COST_ONLY_CAMPAIGN_UNIQUES',
  'DAILY_DIGEST_ENABLED',
  'DAILY_DIGEST_HOUR',
  'AUTO_ALERTS_ENABLED',
  'ALERT_MIN_REGS_NO_DEPS',
  'ALERT_CR_MIN_REGS',
  'ALERT_CR_DROP_PERCENT',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ALLOWED_CHAT_IDS',
  'WEBHOOK_TOKEN',
  'WEBHOOK_PORT',
  'APP_DOMAIN',
  'DATA_DIR',
  'DATABASE_URL',
  'DATABASE_SSL',
  'POSTGRES_PASSWORD',
];

const DEFAULTS = {
  KEITARO_BASE_URL: 'https://ibrkeit.xyz',
  KEITARO_API_KEY: '',
  KEITARO_TIMEZONE: 'Asia/Yerevan',
  KEITARO_API_LIMIT: '1000',
  CABINET_UPDATE_HOUR: '11',
  CABINET_TIMEZONE: 'Asia/Tbilisi',
  KEITARO_COST_CAMPAIGN_IDS: '',
  COST_CURRENCY: 'USD',
  COST_CAMPAIGN_GROUP: '',
  COST_AUTO_PUSH: 'false',
  COST_ONLY_CAMPAIGN_UNIQUES: 'true',
  DAILY_DIGEST_ENABLED: 'true',
  DAILY_DIGEST_HOUR: '11',
  AUTO_ALERTS_ENABLED: 'true',
  ALERT_MIN_REGS_NO_DEPS: '10',
  ALERT_CR_MIN_REGS: '10',
  ALERT_CR_DROP_PERCENT: '50',
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_ALLOWED_CHAT_IDS: '',
  WEBHOOK_TOKEN: '',
  WEBHOOK_PORT: '3000',
  APP_DOMAIN: 'bot.example.com',
  DATA_DIR: 'data',
  DATABASE_URL: '',
  DATABASE_SSL: 'false',
  POSTGRES_PASSWORD: '',
};

const SECTION_COMMENTS = new Map([
  ['KEITARO_BASE_URL', 'Keitaro'],
  ['KEITARO_COST_CAMPAIGN_IDS', 'Facebook costs'],
  ['DAILY_DIGEST_ENABLED', 'Digest and alerts'],
  ['TELEGRAM_BOT_TOKEN', 'Telegram'],
  ['WEBHOOK_TOKEN', 'Webhook / server'],
  ['DATABASE_URL', 'Storage'],
]);

function parseArgs(argv) {
  const args = {
    yes: false,
    force: false,
    help: false,
    mode: '',
    values: {},
  };

  const aliases = {
    domain: 'APP_DOMAIN',
    'telegram-token': 'TELEGRAM_BOT_TOKEN',
    'chat-ids': 'TELEGRAM_ALLOWED_CHAT_IDS',
    'keitaro-url': 'KEITARO_BASE_URL',
    'keitaro-key': 'KEITARO_API_KEY',
    'webhook-token': 'WEBHOOK_TOKEN',
    port: 'WEBHOOK_PORT',
    'database-url': 'DATABASE_URL',
    'postgres-password': 'POSTGRES_PASSWORD',
  };

  for (const arg of argv) {
    if (arg === '--yes' || arg === '-y') args.yes = true;
    else if (arg === '--force' || arg === '-f') args.force = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--docker') args.mode = 'docker';
    else if (arg === '--local') args.mode = 'local';
    else if (arg.startsWith('--mode=')) args.mode = arg.slice('--mode='.length);
    else if (arg.includes('=')) {
      const [rawKey, ...rest] = arg.replace(/^--/, '').split('=');
      const key = aliases[rawKey] || rawKey.toUpperCase();
      args.values[key] = rest.join('=');
    }
  }

  return args;
}

function usage() {
  return [
    'Keitaro bot setup wizard',
    '',
    'Usage:',
    '  npm run setup',
    '  npm run setup -- --docker --domain=bot.example.com',
    '  npm run setup -- --yes --force --telegram-token=123:abc --chat-ids=123456789',
    '',
    'Options:',
    '  --docker / --local              Deployment mode',
    '  --domain=bot.example.com        Public domain for Caddy and webhook URL',
    '  --telegram-token=TOKEN          Telegram BotFather token',
    '  --chat-ids=123,456              Allowed Telegram chat IDs',
    '  --keitaro-url=https://...       Keitaro base URL',
    '  --keitaro-key=KEY               Keitaro API key',
    '  --webhook-token=SECRET          Webhook token; generated if empty',
    '  --port=3000                     Webhook port',
    '  --database-url=postgres://...   Local Node PostgreSQL URL',
    '  --postgres-password=SECRET      Docker Compose PostgreSQL password',
    '  --yes                           Use defaults for unanswered prompts',
    '  --force                         Overwrite .env without asking',
  ].join('\n');
}

function parseEnv(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

async function readEnvFile(filePath) {
  try {
    return parseEnv(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function randomSecret(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function isPlaceholder(value) {
  const text = String(value || '').trim().toLowerCase();
  return !text
    || text.includes('put-your')
    || text.includes('your-')
    || text.includes('random-secret')
    || text.includes('change-me')
    || text === 'bot.example.com';
}

function mask(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 10) return 'set';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
}

function envValue(value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function serializeEnv(values) {
  const lines = [
    '# Generated by npm run setup.',
    '# You can change most bot settings later through Telegram /settings.',
  ];

  for (const key of ENV_ORDER) {
    if (SECTION_COMMENTS.has(key)) {
      lines.push('', `# ${SECTION_COMMENTS.get(key)}`);
    }
    lines.push(`${key}=${envValue(values[key] ?? '')}`);
  }

  return `${lines.join('\n')}\n`;
}

function yesNo(value, fallback = false) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return fallback;
  return ['y', 'yes', 'true', '1', 'on', 'да', 'д'].includes(text);
}

function cleanChoice(value, allowed, fallback) {
  const text = String(value || '').trim().toLowerCase();
  return allowed.includes(text) ? text : fallback;
}

async function createPrompt(args) {
  if (args.yes) {
    return {
      question: async (_label, fallback = '') => fallback,
      close: () => {},
    };
  }

  const rl = readline.createInterface({ input, output });
  return {
    question: (label, fallback = '') => rl.question(fallback ? `${label} [${fallback}]: ` : `${label}: `),
    close: () => rl.close(),
  };
}

async function ask(prompt, label, fallback = '', { required = false, secret = false } = {}) {
  const shownFallback = secret && fallback ? `уже задано: ${mask(fallback)}` : fallback;
  while (true) {
    const answer = (await prompt.question(label, shownFallback)).trim();
    const value = answer || fallback;
    if (!required || value) return value;
    console.log('Нужно заполнить это поле.');
  }
}

async function askConfirm(prompt, label, fallback = false) {
  const suffix = fallback ? 'Y/n' : 'y/N';
  const answer = (await prompt.question(`${label} (${suffix})`, '')).trim();
  return yesNo(answer, fallback);
}

async function backupExistingEnv() {
  if (!existsSync(envPath)) return '';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(scriptDir, `.env.backup-${stamp}`);
  await fs.copyFile(envPath, backupPath);
  return backupPath;
}

function applyArgs(values, argValues) {
  for (const [key, value] of Object.entries(argValues)) {
    values[key] = value;
  }
}

function webhookUrl(values) {
  const domain = normalizeDomain(values.APP_DOMAIN);
  const base = domain && domain !== 'localhost'
    ? `https://${domain}`
    : `http://localhost:${values.WEBHOOK_PORT || '3000'}`;
  return `${base}/webhook/conversion?token=${values.WEBHOOK_TOKEN}&conversion_id={conversion_id}&status={status}&sub_id={sub_id}&sub_id_5={sub_id_5}&previous_status={previous_status}&postback_datetime={postback_datetime}&sale_datetime={sale_datetime}&revenue={revenue}&campaign={campaign}&offer={offer}`;
}

function healthUrl(values) {
  const domain = normalizeDomain(values.APP_DOMAIN);
  if (domain && domain !== 'localhost') return `https://${domain}/health`;
  return `http://localhost:${values.WEBHOOK_PORT || '3000'}/health`;
}

function printSummary(values, mode) {
  console.log('');
  console.log('Готово: .env собран.');
  console.log('');
  console.log('Проверь важное:');
  console.log(`- Telegram token: ${values.TELEGRAM_BOT_TOKEN ? mask(values.TELEGRAM_BOT_TOKEN) : 'не задан'}`);
  console.log(`- Allowed chat IDs: ${values.TELEGRAM_ALLOWED_CHAT_IDS || 'пусто, бот ответит любому, кто знает токен'}`);
  console.log(`- Keitaro URL: ${values.KEITARO_BASE_URL}`);
  console.log(`- Webhook health: ${healthUrl(values)}`);
  console.log('');
  console.log('Keitaro postback URL:');
  console.log(webhookUrl(values));
  console.log('');

  if (mode === 'docker') {
    console.log('Запуск на сервере:');
    console.log('  docker compose up -d --build');
    console.log('  docker compose logs -f app');
    console.log('');
    console.log('После запуска открой бота в Telegram и отправь /start.');
  } else {
    console.log('Запуск без Docker:');
    console.log('  npm ci --omit=dev');
    console.log('  npm start');
    console.log('');
    console.log('Для production лучше держать процесс через pm2/systemd.');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const [exampleEnv, existingEnv] = await Promise.all([
    readEnvFile(envExamplePath),
    readEnvFile(envPath),
  ]);
  const values = {
    ...DEFAULTS,
    ...exampleEnv,
    ...existingEnv,
  };
  applyArgs(values, args.values);

  const prompt = await createPrompt(args);
  try {
    console.log('Keitaro bot setup wizard');
    console.log('Enter оставляет значение по умолчанию.');
    console.log('');

    const modeFallback = cleanChoice(args.mode, ['docker', 'local'], 'docker');
    const mode = cleanChoice(
      await ask(prompt, 'Режим деплоя: docker или local', modeFallback),
      ['docker', 'local'],
      modeFallback,
    );

    values.APP_DOMAIN = normalizeDomain(await ask(prompt, 'Публичный домен для webhook', values.APP_DOMAIN || 'bot.example.com'));
    values.WEBHOOK_PORT = await ask(prompt, 'WEBHOOK_PORT', values.WEBHOOK_PORT || '3000');
    if (isPlaceholder(values.WEBHOOK_TOKEN)) values.WEBHOOK_TOKEN = randomSecret();
    values.WEBHOOK_TOKEN = await ask(prompt, 'WEBHOOK_TOKEN', values.WEBHOOK_TOKEN, { secret: true });

    values.TELEGRAM_BOT_TOKEN = await ask(prompt, 'Telegram bot token от BotFather', values.TELEGRAM_BOT_TOKEN, {
      required: !args.yes,
      secret: true,
    });
    values.TELEGRAM_ALLOWED_CHAT_IDS = await ask(prompt, 'Разрешенные Telegram chat_id через запятую', values.TELEGRAM_ALLOWED_CHAT_IDS);

    values.KEITARO_BASE_URL = await ask(prompt, 'Keitaro URL', values.KEITARO_BASE_URL || DEFAULTS.KEITARO_BASE_URL);
    values.KEITARO_API_KEY = await ask(prompt, 'Keitaro API key', values.KEITARO_API_KEY, { secret: true });
    values.KEITARO_TIMEZONE = await ask(prompt, 'Keitaro timezone', values.KEITARO_TIMEZONE || 'Asia/Yerevan');
    values.CABINET_UPDATE_HOUR = await ask(prompt, 'Час обновления кабинетов', values.CABINET_UPDATE_HOUR || '11');
    values.CABINET_TIMEZONE = await ask(prompt, 'Timezone кабинетов', values.CABINET_TIMEZONE || values.KEITARO_TIMEZONE || 'Asia/Tbilisi');

    values.COST_CURRENCY = await ask(prompt, 'Валюта costs', values.COST_CURRENCY || 'USD');
    values.COST_AUTO_PUSH = yesNo(await ask(prompt, 'Автоотправка costs после CSV? yes/no', values.COST_AUTO_PUSH), false) ? 'true' : 'false';
    values.DAILY_DIGEST_ENABLED = yesNo(await ask(prompt, 'Daily digest включить? yes/no', values.DAILY_DIGEST_ENABLED), true) ? 'true' : 'false';
    values.AUTO_ALERTS_ENABLED = yesNo(await ask(prompt, 'Автоалерты включить? yes/no', values.AUTO_ALERTS_ENABLED), true) ? 'true' : 'false';
    values.DAILY_DIGEST_HOUR = await ask(prompt, 'Час daily digest', values.DAILY_DIGEST_HOUR || values.CABINET_UPDATE_HOUR || '11');

    values.DATA_DIR = values.DATA_DIR || 'data';
    values.DATABASE_SSL = values.DATABASE_SSL || 'false';
    if (mode === 'docker') {
      values.DATABASE_URL = '';
      if (isPlaceholder(values.POSTGRES_PASSWORD)) values.POSTGRES_PASSWORD = randomSecret(18);
      values.POSTGRES_PASSWORD = await ask(prompt, 'POSTGRES_PASSWORD для Docker Compose', values.POSTGRES_PASSWORD, { secret: true });
    } else {
      const usePostgres = yesNo(await ask(prompt, 'Использовать внешний PostgreSQL? yes/no', values.DATABASE_URL ? 'yes' : 'no'), Boolean(values.DATABASE_URL));
      values.DATABASE_URL = usePostgres
        ? await ask(prompt, 'DATABASE_URL', values.DATABASE_URL || 'postgres://user:password@host:5432/database')
        : '';
      values.POSTGRES_PASSWORD = values.POSTGRES_PASSWORD || '';
    }

    const missing = [];
    if (!values.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
    if (!values.WEBHOOK_TOKEN) missing.push('WEBHOOK_TOKEN');
    if (mode === 'docker' && (!values.APP_DOMAIN || values.APP_DOMAIN === 'bot.example.com')) missing.push('APP_DOMAIN');

    if (missing.length && !args.yes) {
      console.log('');
      console.log(`Не заполнено: ${missing.join(', ')}`);
      const proceed = await askConfirm(prompt, 'Все равно записать .env?', false);
      if (!proceed) return;
    }

    if (existsSync(envPath) && !args.force) {
      const overwrite = args.yes || await askConfirm(prompt, '.env уже существует. Перезаписать?', false);
      if (!overwrite) {
        console.log('Ок, .env не трогал.');
        return;
      }
    }

    const backupPath = await backupExistingEnv();
    await fs.writeFile(envPath, serializeEnv(values), 'utf8');
    if (backupPath) console.log(`Backup старого .env: ${path.basename(backupPath)}`);

    printSummary(values, mode);
  } finally {
    prompt.close();
  }
}

main().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
});
