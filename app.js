#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeitaroTelegramBot } from './bot.js';
import { JsonDb } from './db.js';
import { PostgresDb } from './db-postgres.js';
import { loadDotEnv, readConfig } from './settings.js';
import { startWebhookServer } from './server.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function resolveInsideScriptDir(value) {
  if (path.isAbsolute(value)) return value;
  return path.join(scriptDir, value);
}

function createDb(config) {
  if (config.databaseUrl) {
    return new PostgresDb({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl,
    });
  }

  return new JsonDb(config.dataDir);
}

async function main() {
  await loadDotEnv(path.join(scriptDir, '.env'));
  const config = readConfig();
  config.dataDir = resolveInsideScriptDir(config.dataDir);

  const db = createDb(config);
  await db.init();

  let bot = null;
  if (config.telegramBotToken) {
    bot = new KeitaroTelegramBot({ config, db });
  } else {
    console.warn('TELEGRAM_BOT_TOKEN is empty. Telegram polling is disabled.');
  }

  const server = startWebhookServer({ config, db, bot });
  let analyticsTimer = null;
  if (bot) {
    bot.start().catch((error) => {
      console.error(`Telegram bot stopped: ${error.message}`);
      process.exitCode = 1;
    });
    const runAnalytics = () => {
      bot.runScheduledAnalytics().catch((error) => {
        console.error(`Scheduled analytics error: ${error.message}`);
      });
    };
    analyticsTimer = setInterval(runAnalytics, 5 * 60 * 1000);
    setTimeout(runAnalytics, 10000);
  }

  const shutdown = () => {
    console.log('Shutting down...');
    if (analyticsTimer) clearInterval(analyticsTimer);
    bot?.stop();
    server.close(() => {
      Promise.resolve(db.close?.())
        .finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
