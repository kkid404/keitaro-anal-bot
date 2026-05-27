import fs from 'node:fs/promises';

export async function loadDotEnv(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;

      const key = match[1];
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (process.env[key] == null) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function readConfig() {
  return {
    keitaroBaseUrl: process.env.KEITARO_BASE_URL || 'https://ibrkeit.xyz',
    keitaroApiKey: process.env.KEITARO_API_KEY || '',
    keitaroTimezone: process.env.KEITARO_TIMEZONE || 'Asia/Yerevan',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramAllowedChatIds: (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    webhookToken: process.env.WEBHOOK_TOKEN || '',
    webhookPort: Number(process.env.WEBHOOK_PORT || 3000),
    dataDir: process.env.DATA_DIR || 'data',
    databaseUrl: process.env.DATABASE_URL || '',
    databaseSsl: envBool('DATABASE_SSL', false),
    apiLimit: Number(process.env.KEITARO_API_LIMIT || 1000),
    cabinetUpdateHour: Number(process.env.CABINET_UPDATE_HOUR || 11),
    cabinetTimezone: process.env.CABINET_TIMEZONE || process.env.KEITARO_TIMEZONE || 'Asia/Tbilisi',
    costCampaignIds: (process.env.KEITARO_COST_CAMPAIGN_IDS || '')
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item) && item > 0),
    costCurrency: process.env.COST_CURRENCY || 'USD',
    costCampaignGroup: process.env.COST_CAMPAIGN_GROUP || '',
    costAutoPush: envBool('COST_AUTO_PUSH', false),
    costOnlyCampaignUniques: !['0', 'false', 'no', 'off'].includes((process.env.COST_ONLY_CAMPAIGN_UNIQUES || '').toLowerCase()),
  };
}
