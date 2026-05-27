# Быстрый деплой на сервер

## 1. Домен

В DNS у домена создай A-запись:

```text
bot.example.com -> SERVER_IP
```

Можно использовать корневой домен, но удобнее отдельный поддомен вроде `bot.example.com`.

На сервере должны быть открыты порты:

```bash
80/tcp
443/tcp
```

Caddy в Docker Compose сам выпустит HTTPS-сертификат, когда домен уже смотрит на сервер.

## 2. Настройки

Скопируй проект на сервер и создай `.env`:

```bash
cp .env.example .env
```

Заполни минимум:

```env
APP_DOMAIN=bot.example.com
KEITARO_API_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_CHAT_IDS=...
WEBHOOK_TOKEN=...
POSTGRES_PASSWORD=long-random-password
WEBHOOK_PORT=3000
```

`DATABASE_URL` в `.env` можно оставить пустым: `docker-compose.yml` сам подключит приложение к контейнеру PostgreSQL.

## 3. Запуск

```bash
docker compose up -d --build
```

Логи приложения:

```bash
docker compose logs -f app
```

Логи Caddy и выпуска HTTPS:

```bash
docker compose logs -f caddy
```

## 4. Проверка

После того как DNS обновился:

```bash
curl https://bot.example.com/health
```

Ожидаемый ответ:

```json
{"ok":true}
```

Локально на самом сервере Node-сервис также доступен так:

```bash
curl http://127.0.0.1:3000/health
```

## 5. Webhook для Keitaro

```text
https://bot.example.com/webhook/conversion?token=WEBHOOK_TOKEN&conversion_id={conversion_id}&status={status}&sub_id={sub_id}&sub_id_5={sub_id_5}&postback_datetime={postback_datetime}&sale_datetime={sale_datetime}&revenue={revenue}&campaign={campaign}&offer={offer}
```

Замени `bot.example.com` и `WEBHOOK_TOKEN` на свои значения.

## Без Docker

Если PostgreSQL уже установлен отдельно:

```bash
npm ci --omit=dev
DATABASE_URL=postgres://user:password@host:5432/database npm start
```

Для managed PostgreSQL с обязательным TLS добавь:

```env
DATABASE_SSL=true
```

## Режимы хранения

- `DATABASE_URL` задан: используется PostgreSQL.
- `DATABASE_URL` пустой: используется старое файловое хранилище `DATA_DIR`.
