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
  const cabinetUpdateHour = Number(process.env.CABINET_UPDATE_HOUR || 11);
  return {
    keitaroBaseUrl: process.env.KEITARO_BASE_URL || process.env.KEITARO_URL || 'https://ibrkeit.xyz',
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
    cabinetUpdateHour,
    cabinetTimezone: process.env.CABINET_TIMEZONE || process.env.KEITARO_TIMEZONE || 'Asia/Tbilisi',
    costCampaignIds: (process.env.KEITARO_COST_CAMPAIGN_IDS || '')
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item) && item > 0),
    costCurrency: process.env.COST_CURRENCY || 'USD',
    costCampaignGroup: process.env.COST_CAMPAIGN_GROUP || '',
    costAutoPush: envBool('COST_AUTO_PUSH', false),
    costOnlyCampaignUniques: !['0', 'false', 'no', 'off'].includes((process.env.COST_ONLY_CAMPAIGN_UNIQUES || '').toLowerCase()),
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    gptCostRoutingEnabled: envBool('GPT_COST_ROUTING_ENABLED', true),
    gptCostRoutingMinConfidence: Number(process.env.GPT_COST_ROUTING_MIN_CONFIDENCE || 0.85),
    gptCostRoutingCandidateLimit: Number(process.env.GPT_COST_ROUTING_CANDIDATE_LIMIT || 40),
    dailyDigestEnabled: envBool('DAILY_DIGEST_ENABLED', true),
    dailyDigestHour: Number(process.env.DAILY_DIGEST_HOUR || cabinetUpdateHour),
    autoAlertsEnabled: envBool('AUTO_ALERTS_ENABLED', true),
    alertMinRegsNoDeps: Number(process.env.ALERT_MIN_REGS_NO_DEPS || 10),
    alertCrMinRegs: Number(process.env.ALERT_CR_MIN_REGS || 10),
    alertCrDropPercent: Number(process.env.ALERT_CR_DROP_PERCENT || 50),
  };
}
