export class TelegramClient {
  constructor(token) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async request(method, payload = {}) {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      throw new Error(`Telegram ${method} failed: ${JSON.stringify(data)}`);
    }
    return data.result;
  }

  async sendMessage(chatId, text, options = {}) {
    return this.request('sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...options,
    });
  }

  async editMessageText({ chatId, messageId, text, options = {} }) {
    return this.request('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      disable_web_page_preview: true,
      ...options,
    });
  }

  async answerCallbackQuery(callbackQueryId, options = {}) {
    return this.request('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...options,
    });
  }

  async sendDocument(chatId, { filename, content, caption = '' }) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption);
    form.append(
      'document',
      new Blob([content], { type: 'text/csv;charset=utf-8' }),
      filename,
    );

    const response = await fetch(`${this.baseUrl}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      throw new Error(`Telegram sendDocument failed: ${JSON.stringify(data)}`);
    }
    return data.result;
  }

  async getFile(fileId) {
    return this.request('getFile', {
      file_id: fileId,
    });
  }

  async downloadFile(filePath) {
    const response = await fetch(`https://api.telegram.org/file/bot${this.token}/${filePath}`);
    if (!response.ok) {
      throw new Error(`Telegram file download failed: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async getUpdates({ offset = 0, timeout = 30 } = {}) {
    return this.request('getUpdates', {
      offset,
      timeout,
      allowed_updates: ['message', 'callback_query'],
    });
  }
}
