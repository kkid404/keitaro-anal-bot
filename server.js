import http from 'node:http';
import { clean } from './report.js';

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function collectBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseBody(contentType, bodyText) {
  if (!bodyText) return {};
  if (contentType.includes('application/json')) {
    return JSON.parse(bodyText);
  }
  if (
    contentType.includes('application/x-www-form-urlencoded')
    || contentType.includes('multipart/form-data') === false
  ) {
    return Object.fromEntries(new URLSearchParams(bodyText));
  }
  return { raw_body: bodyText };
}

function requestToken(req, url, payload) {
  return clean(
    req.headers['x-webhook-token']
    || req.headers.authorization?.replace(/^Bearer\s+/i, '')
    || url.searchParams.get('token')
    || payload.token,
  );
}

function queryPayload(url) {
  return Object.fromEntries(url.searchParams.entries());
}

async function handleConversionWebhook({ req, res, url, config, db, bot }) {
  let payload = queryPayload(url);

  if (req.method === 'POST') {
    const bodyText = await collectBody(req);
    const bodyPayload = parseBody(clean(req.headers['content-type']), bodyText);
    payload = { ...payload, ...bodyPayload };
  }

  const expectedToken = clean(config.webhookToken);
  if (expectedToken && requestToken(req, url, payload) !== expectedToken) {
    await db.logWebhook({
      method: req.method,
      path: url.pathname,
      status_code: 401,
      message: 'invalid_token',
      raw_json: payload,
    });
    sendJson(res, 401, { ok: false, error: 'invalid_token' });
    return;
  }

  const result = await db.insertConversion(payload);
  await db.logWebhook({
    method: req.method,
    path: url.pathname,
    status_code: result.inserted ? 200 : 202,
    message: result.reason || 'inserted',
    raw_json: payload,
  });

  if (result.inserted && (clean(result.event.status) === 'sale' || clean(result.event.previous_status) === 'sale')) {
    await bot?.notifyConversion(result.event);
  }

  sendJson(res, result.inserted ? 200 : 202, {
    ok: true,
    inserted: result.inserted,
    reason: result.reason || null,
  });
}

export function startWebhookServer({ config, db, bot }) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (
        (req.method === 'GET' || req.method === 'POST')
        && url.pathname === '/webhook/conversion'
      ) {
        await handleConversionWebhook({ req, res, url, config, db, bot });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      console.error(`Webhook error: ${error.message}`);
      sendJson(res, 500, { ok: false, error: error.message });
    }
  });

  server.listen(config.webhookPort, () => {
    console.log(`Webhook server listening on http://localhost:${config.webhookPort}`);
  });

  return server;
}
