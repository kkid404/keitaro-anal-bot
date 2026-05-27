# План Telegram-бота для Keitaro

## Статус на сейчас

Сделано:

- вынесена общая логика отчетов в `report.js`;
- сохранен CLI-запуск через `index.js`;
- добавлен единый запуск сервиса через `app.js`;
- добавлен Telegram bot через `bot.js`;
- добавлен dependency-free Telegram API client через `telegram.js`;
- добавлен C2S/S2S webhook receiver через `server.js`;
- добавлено локальное хранилище live-событий через `db.js`;
- добавлен `.env.example`;
- добавлена настройка `CABINET_UPDATE_HOUR` / `CABINET_TIMEZONE` для учета обновления кабинетов около 11 утра;
- бот помечает сегодняшние отчеты и live-статистику до времени обновления кабинетов как предварительные;
- добавлен профиль бота в `data/settings.json`;
- Keitaro URL, API key, таймзона и время обновления кабинетов теперь могут настраиваться через Telegram-команды, а не только через `.env`;
- добавлен поиск по точному `sub_id_5` через `/find` и через простую отправку полного `sub_id_5` в чат;
- поиск по `sub_id_5` теперь считает дневную логику: реги по `postback_datetime`, депы по `sale_datetime`, late-депы отдельно;
- учтена проблема Keitaro, когда `sale` перезаписывается `lead`: такие депы добираются через `previous_status = sale`;
- добавлен отчет по офферам через `/offers` и кнопки `Офферы сегодня` / `Офферы вчера`;
- если вместо `sub_id_5` приходит макрос, бот пробует восстановить sub5 из поля `campaign`;
- `yesterday`-отчеты закреплены как полные календарные сутки `00:00:00`-`23:59:59`;
- исправлен недосчет депов в первые минуты суток: продажи грузятся из Keitaro API с запасом на предыдущий день и затем фильтруются по точному `sale_datetime` в коде;
- добавлен режим поиска `/findmode`, где можно отправлять `sub_id_5` обычными сообщениями до команды `/done`;
- ключевые ответы поиска переведены на Telegram HTML-разметку: заголовки, monospace для `sub_id_5`, выделенные цифры;
- добавлены inline-кнопки Telegram для основных сценариев: отчеты, статистика, поиск, настройки;
- добавлена обработка `callback_query`;
- настройки профиля можно менять кнопками: нажать настройку и отправить значение следующим сообщением;
- обновлен `README.md`;
- добавлены npm-команды `npm run app`, `npm run bot`, `npm run report`;
- проверен синтаксис всех Node-модулей;
- проверен CLI на реальном Keitaro API;
- проверен webhook smoke-тестом;
- проверены обработчики команд бота без обращения к Telegram API.
- добавлены отдельные команды `/digest` и `/alerts`;
- добавлены алиасы `/roi` и `/cpa` к аккаунтному отчету с ROI/CPA/CPL;
- добавлен in-process daily digest после `DAILY_DIGEST_HOUR` за предыдущий день;
- добавлены автоалерты "много рег без депа" и "CR просел" с сравнением CR против медианы прошлых дней;
- live-уведомление по late sale теперь приходит отдельным форматом `Late sale`;
- кнопочные live-действия больше не присылают второе отдельное меню после результата.

Важно: SQLite из первоначального плана пока заменен на JSONL-хранилище в `data/*.jsonl`, потому что текущая реализация не требует установки npm-зависимостей и работает на чистом Node.js. Интерфейс вынесен в `db.js`, поэтому позже можно заменить JSONL на SQLite без переписывания бота, webhook и отчетов.

## Реализованные файлы

- `report.js` - Keitaro API, CSV, даты, парсинг `sub_id_5`, сводки.
- `index.js` - CLI-обертка для CSV-отчетов.
- `app.js` - единый запуск Telegram bot + webhook server.
- `bot.js` - команды Telegram-бота.
- `telegram.js` - клиент Telegram Bot API.
- `server.js` - HTTP webhook receiver.
- `db.js` - JSONL-хранилище live-конверсий, webhook-логов и чатов.
- `settings.js` - загрузка `.env` и конфигурации.
- `.env.example` - пример настроек.
- `README.md` - инструкция по запуску.

## Реализованные команды бота

- `/start` - старт и помощь.
- `/help` - список команд.
- `/menu` - открыть кнопочное меню.
- `/status` - статус сервиса.
- `/settings` / `/profile` - показать профиль бота.
- `/set url https://...` - сохранить Keitaro URL.
- `/set key ...` - сохранить Keitaro API key.
- `/set timezone Asia/Yerevan` - сохранить таймзону Keitaro.
- `/set update_hour 11` - сохранить час обновления кабинетов.
- `/set cabinet_timezone Asia/Tbilisi` - сохранить таймзону кабинетов.
- `/report 2026-05-26` - CSV из Keitaro API.
- `/today` - CSV за сегодня.
- `/yesterday` - CSV за вчера.
- `/stats [date]` - live-статистика из webhook-журнала.
- `/last 20` - последние live-конверсии.
- `/sales [date]` - live-продажи за дату.
- `/regs [date]` - live-реги за дату.
- `/top [date]` - топ live-`sub_id_5` по депам.
- `/bad [date]` - live-`sub_id_5` с регами без депов.
- `/late [date]` - live-депы за дату по регам других дней.
- `/week` - live-сводка за 7 дней.
- `/sub5 2505|TZ|...` - разбор `sub_id_5`.
- `/find 2505|TZ|...` - поиск сегодняшних регов и депов по точному `sub_id_5`.
- `/findmode` / `/searchmode` - включить режим поиска.
- `/done` / `/exit` / `/stop` - выйти из режима поиска.

Дополнительно бот понимает полный `sub_id_5`, отправленный обычным сообщением без команды.

## Реализованный webhook

Endpoint:

```text
GET /health
GET /webhook/conversion
POST /webhook/conversion
```

Поддержано:

- token через query `?token=...`;
- token через заголовок `X-Webhook-Token`;
- token через `Authorization: Bearer ...`;
- прием JSON body;
- прием form-urlencoded body;
- прием GET query params;
- нормализация полей;
- дедупликация;
- сохранение событий в `data/conversions.jsonl`;
- логирование webhook-запросов в `data/webhook_logs.jsonl`;
- хранение профиля бота в `data/settings.json`;
- уведомление Telegram при новом `sale`.

## Инструкция по настройке Keitaro для новых депов

Чтобы бот присылал сообщения о новых депозитах, Keitaro должен отправлять S2S/C2S postback на webhook бота.

Есть два режима.

### Быстрый режим: Keitaro -> Telegram API

Если нужна только отправка сообщения о депе, можно слать из Keitaro напрямую в Telegram Bot API:

```text
https://api.telegram.org/botTELEGRAM_BOT_TOKEN/sendMessage?chat_id=TELEGRAM_CHAT_ID&text=New%20sale%0Asub5:%20{sub_id_5}%0Arevenue:%20{revenue}%0Asale_time:%20{sale_datetime}
```

Плюсы:

- не нужен наш HTTP webhook;
- проще настроить;
- сообщение приходит сразу в Telegram.

Минусы:

- Telegram bot token находится в Keitaro postback URL;
- нет дедупликации;
- нет локальной базы событий;
- команды live-аналитики не увидят эти события;
- нельзя нормально развивать автоаналитику.

### Полный режим: Keitaro -> bot webhook -> Telegram

Этот режим нужен для live-базы, команд `/last`, `/sales`, `/stats`, `/top`, `/bad`, `/late`, дедупликации и будущей автоаналитики.

Что нужно сделать:

1. Запустить `npm run app` на сервере, доступном из интернета.
2. Настроить домен/HTTPS или временный tunnel.
3. Проверить `GET /health`.
4. В Keitaro открыть postback/S2S/C2S настройки нужной кампании или источника.
5. Добавить URL:

```text
https://your-domain.com/webhook/conversion?token=WEBHOOK_TOKEN&conversion_id={conversion_id}&status={status}&sub_id={sub_id}&sub_id_1={sub_id_1}&sub_id_2={sub_id_2}&sub_id_3={sub_id_3}&sub_id_4={sub_id_4}&sub_id_5={sub_id_5}&sub_id_6={sub_id_6}&postback_datetime={postback_datetime}&sale_datetime={sale_datetime}&revenue={revenue}&campaign={campaign}&offer={offer}
```

Критичные поля:

- `status`;
- `sub_id_5`;
- `sale_datetime`;
- `previous_status`;
- `conversion_id`;
- `revenue`.

Если конкретные макросы в Keitaro называются иначе, их нужно выбрать из списка макросов в интерфейсе Keitaro. Бот принимает разные варианты названий для части полей, но `status` и `sub_id_5` лучше передавать явно.

Проверка:

```text
https://your-domain.com/webhook/conversion?token=WEBHOOK_TOKEN&conversion_id=test-sale-1&status=sale&sub_id_5=2505%7CTZ%7Ckkid%7C817%7CVL_TZ22%7C1-1-2%7Ccbo%7C1&postback_datetime=2026-05-26%2010:00:00&sale_datetime=2026-05-26%2011:00:00&revenue=5
```

После теста бот должен прислать `New sale`, а команды `/last 5`, `/sales today`, `/stats today` должны увидеть событие.

## Что еще нужно сделать

Ближайшие задачи:

1. Реально подключить Telegram bot token и проверить команды в Telegram.
2. Получить свой Telegram `chat_id` и прописать `TELEGRAM_ALLOWED_CHAT_IDS`.
3. Настроить postback/C2S URL в Keitaro.
4. Проверить live-уведомления по настоящим `sale`.
5. Прогнать день-два live-событий и сравнить `/stats` с Keitaro.
6. Проверить, что предупреждение до 11:00 корректно совпадает с реальным временем обновления кабинетов.
7. Протестировать загрузку FB CSV на маленьком отчете.
8. После теста проверить в Keitaro, что бот сам нашел campaign_id по `sub_id_5` и costs легли на нужные `sub_id_5`.

## Модуль: расходы Facebook -> Keitaro/бот

Статус: частично реализовано через ручной CSV-обход без Meta developer account.

Сделано:

- бот принимает CSV-файл из Facebook Ads Manager в Telegram;
- парсит `campaign name` / `Nom de la campagne` как наш `sub_id_5`;
- парсит `amount spent` / `Montant dépensé`;
- группирует расходы по дате и `sub_id_5`;
- сохраняет локально в `data/facebook_spend.jsonl`;
- показывает `/spend today`;
- хранит историю импортов в `data/facebook_imports.jsonl`;
- умеет отправлять imported costs в Keitaro через Admin API `/admin_api/v1/clicks/update_costs`;
- отправка в Keitaro идет только после кнопки или `/pushcosts IMPORT_ID`;
- Keitaro campaign_id ищется автоматически через report по `sub_id_5`;
- повторная CSV-выгрузка того же аккаунта за ту же дату считается новым snapshot, а не плюсуется к старому spend;
- настройки добавлены в профиль бота:
  - `/set cost_currency USD`;
  - `/set cost_auto_push off`.

Задача: подтягивать spend из Facebook Ads и использовать его в Keitaro/боте для баерской аналитики:

- spend;
- CPL;
- CPA;
- ROI/ROAS;
- расход по account;
- расход по campaign/adset/ad;
- расход по creative из `sub_id_5`;
- алерты "тратит, но нет депов";
- алерты "CPA выше нормы".

Есть три возможных пути.

### Путь 0. Ручной CSV из Facebook Ads Manager

Это текущий рабочий обход, если не хочется заводить Meta developer account.

Идея:

1. Баер выгружает CSV из Ads Manager за нужный день.
2. Название кампании в FB уже совпадает с нашим `sub_id_5`.
3. Бот принимает CSV файлом в Telegram.
4. Бот сохраняет spend локально и показывает `/spend today`.
5. Бот сам ищет Keitaro campaign_id по `sub_id_5` и может отправить spend обратно в Keitaro bulk update costs.

Плюсы:

- не нужен Meta developer account;
- не нужен Facebook API token;
- можно быстро сверять spend/депы по текущей схеме названий.

Минусы:

- ручная выгрузка CSV;
- если CSV выгружен не полным отчетом за день, старые локальные строки могут остаться в аналитике;
- для записи в Keitaro нужно точно знать ID кампаний Keitaro, где лежат клики с этими `sub_id_5`.

### Путь 1. Встроенная Facebook Cost integration в Keitaro

Это самый правильный первый вариант, если нужно именно записывать расходы в Keitaro.

По документации Keitaro умеет сам забирать расходы Facebook:

- создается Facebook Cost integration;
- выбираются кампании Keitaro;
- указывается Ad Account ID;
- указывается Facebook Access Token;
- задается период обновления;
- Keitaro сам обновляет расходы.

Плюсы:

- меньше своего кода;
- Keitaro официально поддерживает этот сценарий;
- расходы попадают в стандартные отчеты Keitaro;
- есть кнопка ручного обновления расходов.

Минусы:

- нужно правильно настроить Facebook параметры в кампании;
- важно, чтобы в ссылках были Facebook template-параметры, особенно `{{adset.id}}`;
- меньше гибкости для аналитики именно по нашему `sub_id_5`.

### Путь 2. Кастомный sync через Meta Marketing API

Этот путь нужен, если мы хотим не просто расходы в Keitaro, а умную баерскую аналитику внутри бота.

Идея:

1. В профиле бота добавить:
   - Meta access token;
   - Meta API version;
   - список ad account ids;
   - currency;
   - sync window, например последние 7 дней.
2. По расписанию дергать Meta Insights API:
   - уровень `ad`, `adset` или `campaign`;
   - поля `spend`, `date_start`, `date_stop`, `campaign_id`, `campaign_name`, `adset_id`, `adset_name`, `ad_id`, `ad_name`.
3. Сохранять spend локально:
   - `data/facebook_spend.jsonl` или позже SQLite table `facebook_spend`.
4. Маппить spend к нашим сущностям:
   - по `account_id` из `sub_id_5`;
   - по creative name из `sub_id_5`;
   - по campaign/adset/ad id, если мы начнем передавать их в `sub_id` или webhook.
5. Добавить команды:
   - `/fbsettings`;
   - `/sets fb_token ...`;
   - `/sets fb_account act_...`;
   - `/spend today`;
   - `/costs today`;
   - `/roi today`;
   - `/cpa today`;
6. Добавить кнопки:
   - `Расходы сегодня`;
   - `CPA сегодня`;
   - `ROI сегодня`;
   - `Синк FB spend`.

### Важная проблема маппинга

Чтобы расходы точно связались с `sub_id_5`, нужно решить, какой Facebook идентификатор хранить в треке.

Сейчас `sub_id_5` выглядит так:

```text
2505|TZ|kkid|1460255925848277|YU_ZM24|1-1-2|cbo|2
```

Там есть account id и creative name, но нет явного `campaign_id`, `adset_id`, `ad_id`.

Лучше добавить в Keitaro/FB ссылки параметры:

- `fb_campaign_id={{campaign.id}}`;
- `fb_adset_id={{adset.id}}`;
- `fb_ad_id={{ad.id}}`;
- `fb_campaign_name={{campaign.name}}`;
- `fb_adset_name={{adset.name}}`;
- `fb_ad_name={{ad.name}}`.

Тогда бот сможет точно соединять:

- spend из Facebook;
- реги/депы из Keitaro;
- `sub_id_5`;
- late deps.

### MVP для расходов

Выполнено:

1. Реализован CSV import из Facebook Ads Manager.
2. Добавлена локальная запись spend.
3. Добавлена команда `/spend today`.
4. Добавлена кнопка отправки costs в Keitaro.
5. Добавлены настройки `cost_currency`, `cost_auto_push`.

Дальше:

1. Протестировать отправку costs на небольшой дате и одном Keitaro campaign ID.
2. Сверить, как Keitaro распределил cost по `sub_id_5` в отчете.
3. Добавить `/roi today` и `/cpa today`, когда появятся реальные spend + revenue в одном дне.
4. Решить, нужен ли автоматический Meta sync без ручного CSV.

Следующие улучшения:

Обновление 2026-05-27: daily digest, автоалерты "много рег без депа" / "CR просел" и сравнение с медианой уже реализованы. Оставшиеся пункты ниже относятся к следующим расширениям и проверкам.

1. Перевести JSONL-хранилище на SQLite.
2. Расширить `/settings`: добавить удаление/сброс отдельных настроек.
3. Добавить включение/выключение уведомлений по типам событий.
4. Добавить фильтры уведомлений по GEO, buyer, account, creative.
5. Добавить аналитику лага от реги до депа.
6. Добавить экспорт live-статистики из локального хранилища в CSV.

Технический долг:

- текущий Telegram client работает через long polling; для VPS можно оставить так, но для продакшена можно добавить Telegram webhook;
- текущий планировщик digest реализован как in-process таймер; если сервис будет запускаться в нескольких инстансах, нужен внешний scheduler или distributed lock;
- кабинетное окно пока используется как предупреждение в сообщениях, а не как жесткий запрет на алерты;
- local JSONL подходит для MVP, но при большом объеме событий лучше SQLite;
- нужно решить, какие поля Keitaro будет передавать в C2S webhook, и зафиксировать готовый URL-шаблон;
- текущий Keitaro API key лучше перевыпустить, потому что он был отправлен в чат.

## Цель

Сделать не просто бота для выгрузки CSV, а небольшой рабочий сервис для баера:

- строит отчеты по `sub_id_5`;
- принимает live-конверсии через C2S/S2S webhook;
- хранит события локально;
- отправляет уведомления о важных событиях;
- делает автоаналитику по связкам, креативам, GEO и аккаунтам.

## Текущая база

Уже есть Node.js CLI-скрипт:

- файл: `index.js`;
- берет данные из Keitaro Admin API;
- считает реги по `postback_datetime`;
- считает депы по `sale_datetime`;
- группирует по `sub_id_5`;
- сохраняет CSV.

Эту логику нужно сохранить, но вынести из CLI в отдельный модуль, чтобы ее мог использовать и бот.

## Архитектура

Сервис будет состоять из нескольких частей:

1. `report.js`
   - общая логика работы с Keitaro API;
   - построение CSV-отчетов;
   - парсинг дат;
   - группировка по `sub_id_5`;
   - расчет регов, депов, CR и других метрик.

2. `index.js`
   - CLI-обертка;
   - запуск отчета из консоли;
   - сохранение CSV в файл.

3. `bot.js`
   - Telegram bot;
   - команды пользователя;
   - отправка CSV;
   - отправка сводок и алертов.

4. `server.js`
   - HTTP endpoint для C2S/S2S;
   - прием новых конверсий;
   - проверка webhook token;
   - сохранение событий в базу;
   - вызов уведомлений.

5. `db.js`
   - SQLite;
   - таблицы конверсий, настроек, логов и разрешенных чатов;
   - дедупликация событий.

6. `app.js`
   - единый запуск сервиса;
   - старт Telegram bot;
   - старт HTTP server;
   - инициализация базы.

## Конфигурация

Все секреты и настройки должны быть в `.env`.

```env
KEITARO_BASE_URL=https://ibrkeit.xyz
KEITARO_API_KEY=your-keitaro-api-key
KEITARO_TIMEZONE=Asia/Yerevan
CABINET_UPDATE_HOUR=11
CABINET_TIMEZONE=Asia/Tbilisi

TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_ALLOWED_CHAT_IDS=123456789,987654321

WEBHOOK_TOKEN=random-secret-token
WEBHOOK_PORT=3000
```

Эти значения остаются fallback для первого запуска. После старта бот умеет сохранять Keitaro URL, API key, timezone и время обновления кабинетов в профиль через Telegram-команды `/set ...`.

Важно: текущий Keitaro API key лучше перевыпустить, потому что он уже был отправлен в чат.

## Telegram-команды

### Базовые

- `/start` - подключение и краткая инструкция.
- `/help` - список команд и примеры.
- `/status` - состояние бота, API, базы и webhook.

### Отчеты

- `/report 2026-05-26` - CSV за дату.
- `/report 26.05.2026` - то же самое.
- `/report 26 мая 2026` - то же самое.
- `/today` - отчет за сегодня.
- `/yesterday` - отчет за вчера.
- `/week` - краткая сводка за последние 7 дней.

### Быстрые данные

- `/stats` - статистика за сегодня.
- `/last 20` - последние 20 конверсий из локальной базы.
- `/sales today` - продажи за сегодня.
- `/regs today` - реги за сегодня.

### Работа с `sub_id_5`

- `/sub5 2505|TZ|kkid|...` - детали по конкретному `sub_id_5`.
- `/top today` - лучшие `sub_id_5` за сегодня.
- `/bad today` - слабые `sub_id_5` за сегодня.
- `/late today` - депы сегодня по регам прошлых дней.

## C2S/S2S Webhook

Endpoint:

```text
POST /webhook/conversion
```

Или для простых postback-ссылок:

```text
GET /webhook/conversion?token=SECRET&conversion_id=...&status=sale&sub_id_5=...
```

Минимальные поля:

- `conversion_id`;
- `status`;
- `sub_id_5`;
- `postback_datetime`;
- `sale_datetime`;
- `revenue`;
- `campaign`;
- `offer`;
- `geo`;
- `sub_id`;
- `sub_id_1`;
- `sub_id_2`;
- `sub_id_3`;
- `sub_id_4`;
- `sub_id_6`.

Webhook должен:

- проверять `WEBHOOK_TOKEN`;
- принимать `GET` и `POST`;
- нормализовать поля;
- писать событие в SQLite;
- не дублировать уже сохраненные события;
- отправлять уведомление в Telegram при новом `sale`.

## SQLite

### `conversions`

Хранит live-события.

Поля:

- `id`;
- `conversion_id`;
- `status`;
- `sub_id`;
- `sub_id_1`;
- `sub_id_2`;
- `sub_id_3`;
- `sub_id_4`;
- `sub_id_5`;
- `sub_id_6`;
- `campaign`;
- `offer`;
- `geo`;
- `revenue`;
- `postback_datetime`;
- `sale_datetime`;
- `raw_json`;
- `created_at`.

Уникальность:

- `conversion_id + status`;
- возможно дополнительно `conversion_id + status + sale_datetime`.

### `telegram_chats`

Хранит разрешенные чаты.

Поля:

- `chat_id`;
- `title`;
- `enabled`;
- `created_at`.

### `webhook_logs`

Логирует входящие webhook-запросы.

Поля:

- `id`;
- `method`;
- `path`;
- `status_code`;
- `message`;
- `raw_json`;
- `created_at`.

### `settings`

Для будущих пользовательских настроек:

- фильтры уведомлений;
- дневное время дайджеста;
- лимиты алертов;
- настройки GEO/кампаний.

## Уведомления

### New Sale

При новом `sale` бот отправляет:

```text
Sale
sub5: 2505|TZ|kkid|...
GEO: TZ
creative: VL_TZ22
revenue: 5.00
sale time: 2026-05-26 14:30:09
```

### Late Sale

Если регистрация была раньше, а продажа пришла сегодня:

```text
Late sale
reg date: 2026-05-12
sale date: 2026-05-26
lag: 14 days
sub5: ...
```

### Алерт "много рег, нет депов"

Пример условия:

- `regs >= 10`;
- `deps = 0`;
- прошло минимум 2-4 часа с первой реги.

Сообщение:

```text
Alert: много рег без депов
sub5: ...
regs: 12
deps: 0
first reg: 10:14
```

### Алерт по просадке CR

Сравниваем текущий CR с медианой за 3-7 дней.

Пример:

```text
CR drop
creative: VL_TZ22
today CR: 8%
7d median CR: 17%
drop: -53%
```

## Парсинг `sub_id_5`

Текущий формат похож на:

```text
2505|TZ|kkid|817171078066414|VL_TZ22|1-1-2|cbo|1
```

Можно разобрать на части:

1. `launch_date` - `2505`;
2. `geo` - `TZ`;
3. `buyer` - `kkid`;
4. `account_id` - `817171078066414`;
5. `creative` - `VL_TZ22`;
6. `funnel` - `1-1-2`;
7. `campaign_type` - `cbo`;
8. `ad_number` - `1`.

Это даст аналитику не только по полному `sub_id_5`, но и по:

- GEO;
- buyer;
- account;
- creative;
- funnel;
- campaign type;
- ad number.

## Автоаналитика для баера

### 1. Топы и антитопы

Команды:

- `/top today`;
- `/bad today`;
- `/top week`;
- `/bad week`.

Метрики:

- regs;
- deps;
- CR;
- revenue;
- revenue per reg;
- late sales.

### 2. Много рег без депа

Бот сам ищет связки, где есть трафик, но нет продаж.

Полезно, чтобы быстро стопать слабые креативы или аккаунты.

### 3. Просадка CR

Бот сравнивает:

- сегодняшний CR;
- вчерашний CR;
- медиану за 7 дней.

Если просадка сильная, присылает алерт.

### 4. Late Sales

Показывает продажи, которые пришли сегодня, но регистрация была в прошлые дни.

Это важно, чтобы не недооценивать связки с длинным лагом.

### 5. Лаг рега до депа

Метрики:

- средний лаг;
- медианный лаг;
- доля депов в первые 10 минут;
- доля депов в первый час;
- доля депов в первые 24 часа.

Это помогает понимать, когда рано делать выводы по кампании.

### 6. Аналитика по креативам

Если `creative` берется из 5-й части `sub_id_5`, можно строить:

- топ креативов по депам;
- топ креативов по CR;
- креативы с регами без депов;
- креативы, которые стали хуже относительно прошлых дней.

### 7. Аналитика по аккаунтам

По `account_id` можно смотреть:

- какой аккаунт дает лучшие депы;
- какой аккаунт просел;
- где много регов без продаж.

### 8. GEO-аналитика

По второй части `sub_id_5`:

- TZ, ZM и другие GEO;
- сравнение CR по GEO;
- топ креативов внутри GEO.

### 9. Дневной дайджест

Каждый день в заданное время:

```text
Daily digest 2026-05-26
Regs: 109
Deps: 39
CR: 35.8%
Top sub5:
1. ...
2. ...
3. ...

Problems:
1. 12 regs / 0 deps - ...
2. CR drop - ...

Late sales:
12 sales from older regs
```

### 10. Рекомендации

Автоматические выводы:

- "можно докинуть бюджет";
- "подождать, высокий late-sale лаг";
- "стопнуть, много рег без депа";
- "креатив просел относительно 7 дней";
- "аккаунт дает хуже среднего".

Это не должно быть магией. Рекомендация должна показывать причину и цифры.

## MVP

### Этап 1. Рефакторинг

- Вынести отчетную логику из `index.js` в `report.js`.
- Оставить CLI рабочим.
- Проверить, что CSV за `2026-05-26` совпадает с текущим результатом.

### Этап 2. Telegram Bot

- Добавить `bot.js`.
- Команды:
  - `/start`;
  - `/help`;
  - `/report`;
  - `/today`;
  - `/yesterday`.
- Отправлять CSV документом.
- Отправлять короткую сводку текстом.

### Этап 3. SQLite

- Добавить `db.js`.
- Создавать базу автоматически.
- Добавить таблицы `conversions`, `telegram_chats`, `webhook_logs`, `settings`.

### Этап 4. C2S/S2S Receiver

- Добавить `server.js`.
- Endpoint `/webhook/conversion`.
- Проверка `WEBHOOK_TOKEN`.
- Сохранение событий.
- Дедупликация.

### Этап 5. Live-уведомления

- Уведомлять о новых `sale`.
- Уведомлять о late sale.
- Добавить настройку разрешенных chat id.

### Этап 6. Автоаналитика

- `/top today`;
- `/bad today`;
- алерт "много рег без депа";
- алерт "CR просел";
- дневной digest.

## Что сделать первым

Первым делом нужно сделать этап 1:

1. Разделить `index.js` на `report.js` и CLI.
2. Убедиться, что текущий CSV не изменился.
3. После этого добавлять Telegram bot без риска сломать отчетную логику.
