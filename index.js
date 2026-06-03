#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BASE_URL,
  DEFAULT_LIMIT,
  DEFAULT_TIMEZONE,
  buildReport,
  buildOfferReport,
  normalizeBaseUrl,
  summarizeReport,
} from './report.js';
import { loadDotEnv } from './settings.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { positional: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name, inlineValue] = arg.startsWith('--') ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const nextValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      index += 1;
      if (index >= argv.length) throw new Error(`Нет значения для ${arg}`);
      return argv[index];
    };

    switch (name) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--date':
      case '-d':
        args.date = nextValue();
        break;
      case '--output':
      case '-o':
        args.output = nextValue();
        break;
      case '--group-by':
        args.groupBy = nextValue();
        break;
      case '--offers':
        args.groupBy = 'offer';
        break;
      case '--base-url':
        args.baseUrl = nextValue();
        break;
      case '--timezone':
        args.timezone = nextValue();
        break;
      case '--api-key':
        args.apiKey = nextValue();
        break;
      case '--limit':
        args.limit = Number(nextValue());
        break;
      case '--verbose':
        args.verbose = true;
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`Неизвестная опция: ${arg}`);
        args.positional.push(arg);
    }
  }

  if (!args.date && args.positional.length) {
    args.date = args.positional.join(' ');
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node index.js --date "2026-05-26"
  node index.js --date "26 мая 2026" --output ./sub5-2026-05-26.csv
  node index.js --date "2026-05-26" --offers --output ./offers-2026-05-26.csv

Options:
  -d, --date       Date: 2026-05-26, 26.05.2026, 26 мая 2026, today, yesterday
  -o, --output     Output CSV path
      --offers     Group report by offer instead of sub5
      --group-by   sub5 or offer
      --base-url   Keitaro base URL, default ${DEFAULT_BASE_URL}
      --timezone   Keitaro timezone, default ${DEFAULT_TIMEZONE}
      --limit      API page size, default ${DEFAULT_LIMIT}
      --verbose    Print API pagination progress
`);
}

async function main() {
  await loadDotEnv(path.join(scriptDir, '.env'));
  await loadDotEnv(path.join(scriptDir, '..', '.env'));

  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.date) {
    printHelp();
    throw new Error('Укажи дату через --date.');
  }

  const config = {
    date: args.date,
    baseUrl: normalizeBaseUrl(args.baseUrl || process.env.KEITARO_BASE_URL || DEFAULT_BASE_URL),
    apiKey: args.apiKey || process.env.KEITARO_API_KEY,
    timezone: args.timezone || process.env.KEITARO_TIMEZONE || DEFAULT_TIMEZONE,
    limit: Number.isFinite(args.limit) && args.limit > 0 ? args.limit : DEFAULT_LIMIT,
    verbose: Boolean(args.verbose),
  };

  if (!config.apiKey) {
    throw new Error('Не найден KEITARO_API_KEY. Задай его в .env или переменной окружения.');
  }

  const groupBy = args.groupBy === 'offer' ? 'offer' : 'sub5';
  const report = groupBy === 'offer'
    ? await buildOfferReport(config)
    : await buildReport(config);
  const outputPath = path.resolve(args.output || `${groupBy === 'offer' ? 'offers' : 'sub5'}-${report.dateYmd}.csv`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `\uFEFF${report.csv}`, 'utf8');

  console.log(`CSV saved: ${outputPath}`);
  console.log(summarizeReport(report));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
