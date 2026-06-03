# Keitaro dashboard bot

This bot now lives inside the main `keitaro-mcp` workspace under `bot/`.
Run it from the repository root with `.\run-keitaro-bot.ps1`, or from this
folder with `npm run app`.

It reads `bot/.env` first and then the root `.env` as a shared fallback.
For Docker, use the root `docker-compose.yml` from `keitaro-mcp`.

The original standalone project name was `keitaro-sub5-report`.

Node.js сервис для баера:

- строит CSV по `sub_id_5` из Keitaro API;
- считает реги по `postback_datetime`;
- считает депы по `sale_datetime`;
- добирает стертые депы через `previous_status = sale`, если Keitaro перезаписал продажу регой;
- запускает Telegram-бота;
- принимает live-конверсии через C2S/S2S webhook;
- хранит live-события в `data/*.jsonl` или PostgreSQL при заданном `DATABASE_URL`;
- отправляет Telegram-уведомления о новых `sale`.

## Настройка

Самый быстрый путь - запустить мастер настройки:

```bash
npm run setup
```

Он соберет `.env`, сгенерирует `WEBHOOK_TOKEN` и `POSTGRES_PASSWORD`, подскажет webhook URL для Keitaro и команды запуска. Для автоматического запуска на сервере можно передать параметры:

```bash
npm run setup -- --docker --domain=bot.example.com --telegram-token=123:abc --chat-ids=123456789 --force
```

Вручную `.env` можно создать рядом с `app.js` по примеру `.env.example`:

```env
KEITARO_BASE_URL=https://ibrkeit.xyz
KEITARO_API_KEY=your-keitaro-api-key
KEITARO_TIMEZONE=Asia/Yerevan
KEITARO_API_LIMIT=1000
CABINET_UPDATE_HOUR=11
CABINET_TIMEZONE=Asia/Tbilisi
KEITARO_COST_CAMPAIGN_IDS=
COST_CURRENCY=USD
COST_CAMPAIGN_GROUP=
COST_AUTO_PUSH=false
COST_ONLY_CAMPAIGN_UNIQUES=true
DAILY_DIGEST_ENABLED=true
DAILY_DIGEST_HOUR=11
AUTO_ALERTS_ENABLED=true
ALERT_MIN_REGS_NO_DEPS=10
ALERT_CR_MIN_REGS=10
ALERT_CR_DROP_PERCENT=50

TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_ALLOWED_CHAT_IDS=123456789

WEBHOOK_TOKEN=random-secret-token
WEBHOOK_PORT=3000
APP_DOMAIN=bot.example.com
DATA_DIR=data
DATABASE_URL=
DATABASE_SSL=false
POSTGRES_PASSWORD=change-me
```

`TELEGRAM_ALLOWED_CHAT_IDS` можно оставить пустым, тогда бот будет отвечать всем, кто знает токен бота. Лучше указать свой chat id.

`KEITARO_BASE_URL`, `KEITARO_API_KEY`, `KEITARO_TIMEZONE`, `CABINET_UPDATE_HOUR`, `CABINET_TIMEZONE` и настройки costs можно потом менять прямо в Telegram через профиль бота. `.env` остается fallback-настройкой для первого запуска.

`CABINET_UPDATE_HOUR` нужен для баерской логики: если кабинеты обновляются примерно в 11 утра, бот будет помечать сегодняшние отчеты до 11:00 как предварительные.

## CLI-отчет

```powershell
node .\index.js --date "2026-05-26"
```

С явным файлом:

```powershell
node .\index.js --date "26 мая 2026" --output .\sub5-2026-05-26.csv
```

Отчет по офферам:

```powershell
node .\index.js --date "2026-05-26" --offers --output .\offers-2026-05-26.csv
```

## Запуск бота и webhook

```powershell
npm run app
```

Или:

```powershell
node .\app.js
```

Сервис стартует:

- Telegram long polling;
- HTTP server на `WEBHOOK_PORT`;
- локальное хранилище в `DATA_DIR`;
- in-process планировщик daily digest и автоалертов.

## Telegram-команды

После `/start` бот показывает короткое меню разделов. Команды остаются как быстрый способ, но основные действия можно делать кнопками:

- `Отчеты` - sub5-отчеты, офферы и выбор даты;
- `Live` - статистика, продажи, реги, топ sub5 и sub5 без депов;
- `Расходы` - spend из Facebook CSV, инструкция загрузки и costs;
- `Поиск` - режим поиска по одному или нескольким `sub5`;
- `Настройки` - группы настроек Keitaro, времени, costs и алертов;
- `Помощь` - короткая справка.

В настройках сначала выбери группу, например `Keitaro` или `Costs`, затем нажми нужную настройку и пришли значение следующим сообщением.

- `/start` - старт и помощь.
- `/help` - короткая справка.
- `/commands` - полный список команд.
- `/menu` - открыть кнопочное меню.
- `/status` - настройки и состояние.
- `/settings` - профиль бота: Keitaro URL, API key, timezone, время обновления кабинетов.
- `/set url https://ibrkeit.xyz` - сохранить Keitaro URL в профиле бота.
- `/set key KEITARO_API_KEY` - сохранить Keitaro API key в профиле бота.
- `/set timezone Asia/Yerevan` - сохранить таймзону Keitaro.
- `/set update_hour 11` - сохранить час обновления кабинетов.
- `/set cabinet_timezone Asia/Tbilisi` - сохранить таймзону кабинетов.
- `/set cost_currency USD` - валюта расходов из FB CSV.
- `/set cost_campaign_group kkid` - точная группа кампаний Keitaro для auto-push costs. Если не задано, бот берет buyer из `sub_id_5`, например `kkid`.
- `/set cost_auto_push off` - автоотправка costs в Keitaro после загрузки CSV.
- `/set openai_key sk-...` - OpenAI API key для GPT fallback в costs routing.
- `/set gpt_cost_routing on` - включить GPT fallback, когда обычный поиск не нашел campaign_id.
- `/set gpt_cost_confidence 0.85` - минимальная уверенность GPT для auto-route.
- `/set daily_digest on` - ежедневный digest за вчера после `DAILY_DIGEST_HOUR`.
- `/set auto_alerts on` - автоалерты по live-данным.
- `/set alert_min_regs 10` - порог для алерта "реги без депа".
- `/report 2026-05-26` - CSV из Keitaro API. Перед генерацией бот спросит, считать с 11:00 или с 00:00 по времени Keitaro.
- `/offers 2026-05-26` - CSV по офферам в формате `Оффер, Выплата, Количество, Общий доход`. Перед генерацией бот спросит, считать с 11:00 или с 00:00 по времени Keitaro.
- `/offers суббота`, `/offers позавчера` или `/offers 2d` - быстрый отчет по офферам за нужный прошедший день, например в понедельник за субботу.
- `/today` - CSV за сегодня.
- `/yesterday` - CSV за вчера.
- `/stats [date]` - live-статистика из webhook-журнала.
- `/spend [date]` - расходы из загруженных Facebook CSV.
- `/accounts [date]` - эффективность рекламных аккаунтов: spend, revenue, profit, ROI, CPA, CPL и CR по каждому account id из `sub_id_5`.
- `/accounts 7d` или `/accounts 2026-05-20 2026-05-26` - тренд по аккаунтам в разрезе дней; проблемные аккаунты сортируются сверху.
- `/roi [date]` и `/cpa [date]` - быстрые алиасы к отчету `/accounts`.
- `/digest [date]` - дневной digest по live-данным.
- `/alerts [date]` - проверить автоалерты вручную.
- `/costs` - инструкция по загрузке CSV-расходов.
- `/pushcosts IMPORT_ID` - отправить конкретный импорт расходов в Keitaro.
- `/pushcosts_to IMPORT_ID CAMPAIGN_ID 2,4,7` - вручную отправить выбранные строки импорта в указанную кампанию.
- `/last 20` - последние live-конверсии.
- `/sales [date]` - live-продажи за дату.
- `/regs [date]` - live-реги за дату.
- `/top [date]` - топ live-sub5 по депам.
- `/bad [date]` - live-sub5 с регами без депов.
- `/late [date]` - live-депы за дату по регам других дней.
- `/week` - live-сводка за 7 дней.
- `/sub5 2505|TZ|...` - разобрать `sub_id_5`.
- `/find 2505|TZ|...` - найти сегодняшние реги и депы по `sub_id_5`.
- `/findmode` - включить режим поиска: дальше можно просто слать `sub_id_5` без команды.
- `/done`, `/exit`, `/stop` - выйти из режима поиска.

Также можно просто прислать боту полный `sub_id_5` без команды:

```text
2505|ZM|kkid|1460255925848277|YU_ZM24|1-1-2|cbo|2
```

Он ответит:

```text
по саб5 2505|ZM|kkid|1460255925848277|YU_ZM24|1-1-2|cbo|2
найдено за сегодня: 0 рег и 1 деп
late deps: 1
source: Keitaro API
```

Важно: поиск считает так же, как дневной отчет:

- реги - по `postback_datetime` за сегодня;
- депы - по `sale_datetime` за выбранное окно дня;
- стертые депы - по `previous_status = sale` и `sale_datetime`, если он есть, иначе по `postback_datetime`;
- если деп сегодня, а рега была раньше, он попадет в `late deps`.
- для отчетов за `today` и `yesterday` бот сначала спрашивает окно: с 11:00 или с 00:00.
- для депов бот грузит реги за последние 30 дней по `postback_datetime`, а затем точно проверяет нужный `sale_datetime` в коде, чтобы не потерять долеты.
- если вместо `sub_id_5` пришел макрос вроде `{sub_id_5}`, бот попробует взять настоящий sub5 из поля `campaign`, если оно выглядит как `2505|TZ|...`.

В режиме `/findmode` можно прислать сразу несколько строк:

```text
2505|ZM|kkid|1460255925848277|YU_ZM24|1-1-2|cbo|2
2505|TZ|kkid|817171078066414|VL_TZ22|1-1-2|cbo|1
```

Бот обработает каждую строку отдельным ответом. Для выхода:

```text
/done
```

## Facebook CSV -> расходы

Если не хочется подключать Facebook Cost integration через Meta developer/app token, можно работать через ручной CSV из Ads Manager.

1. В Ads Manager открой отчет по кампаниям за нужную дату.
2. В экспорте должны быть колонки:
   - campaign name / `Nom de la campagne`;
   - amount spent / `Montant dépensé`;
   - date start / `Début des rapports`.
3. Название кампании в FB должно совпадать с нашим `sub_id_5`, например:

   ```text
   2505|ZM|kkid|1460255925848277|YU_ZM24|1-1-2|cbo|2
   ```

4. Отправь один CSV-файл или несколько CSV-файлов одним сообщением прямо в Telegram-бота.

Бот:

- распарсит расходы из всех присланных CSV;
- объединит несколько CSV в один импорт;
- сгруппирует их по `account_id` из `sub_id_5` и самому `sub_id_5`;
- сохранит локально в `data/facebook_spend.jsonl`;
- покажет `/spend today`;
- даст кнопку `Отправить costs в Keitaro`, если задан Keitaro API key;
- перед отправкой costs попросит подтверждение.

Чтобы бот мог залить costs в Keitaro:

```text
/set cost_currency USD
```

Campaign IDs вводить не нужно. При отправке costs бот сам делает Keitaro report по `sub_id_5`, находит `campaign_id`, где были клики с этим `sub_id_5`, и отправляет cost туда.
Если один `sub_id_5` найден в нескольких группах кампаний, бот выбирает только точную группу из настройки `cost_campaign_group`, а если она не задана - buyer из `sub_id_5`, например `kkid`. Группа вроде `kkid Для копий` не будет выбрана для auto-push `kkid`.
Дата из FB CSV отправляется в Keitaro как баерское окно от `CABINET_UPDATE_HOUR` до следующего такого часа. Например при `CABINET_UPDATE_HOUR=11` расход FB за `2026-05-26` уйдет в период `2026-05-26 11:00:00` - `2026-05-27 10:59:59` по timezone Keitaro.

После загрузки CSV или пачки CSV можно нажать кнопку `Отправить costs в Keitaro`, подтвердить отправку или выполнить:

```text
/pushcosts IMPORT_ID
```

Если часть строк не нашлась в нужной группе, бот покажет их с номерами. Их можно допушить вручную в конкретную кампанию:

```text
/pushcosts_to IMPORT_ID CAMPAIGN_ID 2,4,7
```

Технически бот отправляет bulk update в Keitaro Admin API `/admin_api/v1/clicks/update_costs` и для каждой строки ставит фильтр:

```json
{"sub_id_5":"2505|ZM|kkid|1460255925848277|YU_ZM24|1-1-2|cbo|2"}
```

Если за день ты грузишь CSV из 5 рекламных аккаунтов, бот хранит их как 5 отдельных snapshot по ключу `date + account_id + currency`. Повторная выгрузка того же аккаунта и даты заменяет предыдущий snapshot этого аккаунта. Например, если в 12:00 было `$12`, а в 14:00 стало `$16`, в текущей аналитике и при следующем пуше будет `$16`, а не `$28`.

## Webhook

Healthcheck:

```text
GET /health
```

Прием конверсии:

```text
POST /webhook/conversion
```

Можно передавать токен в query:

```text
GET /webhook/conversion?token=SECRET&conversion_id=abc&status=sale&sub_id_5=2505|TZ|kkid|817|VL_TZ22|1-1-2|cbo|1&sale_datetime=2026-05-26%2014:30:00&revenue=5
```

Или заголовком:

```http
X-Webhook-Token: SECRET
```

Поддерживаемые поля:

- `conversion_id`;
- `status`;
- `sub_id`;
- `sub_id_1`;
- `sub_id_2`;
- `sub_id_3`;
- `sub_id_4`;
- `sub_id_5`;
- `sub_id_6`;
- `postback_datetime`;
- `sale_datetime`;
- `previous_status`;
- `revenue`;
- `campaign`;
- `offer`;
- `geo`.

При новом `sale` бот отправляет уведомление в разрешенные чаты.

## Что настроить в Keitaro для уведомлений о новых депах

Есть два варианта.

### Вариант 1. Напрямую Keitaro -> Telegram API

Это самый простой способ, если нужны только уведомления о новых депах и не нужна локальная база/автоаналитика.

В Keitaro можно поставить postback URL прямо на Telegram Bot API:

```text
https://api.telegram.org/botTELEGRAM_BOT_TOKEN/sendMessage?chat_id=TELEGRAM_CHAT_ID&text=New%20sale%0Asub5:%20{sub_id_5}%0Arevenue:%20{revenue}%0Asale_time:%20{sale_datetime}
```

Что нужно заменить:

- `TELEGRAM_BOT_TOKEN` - токен бота от BotFather;
- `TELEGRAM_CHAT_ID` - id чата, куда слать сообщение;
- `{sub_id_5}`, `{revenue}`, `{sale_datetime}` - макросы Keitaro.

Минусы прямого способа:

- токен Telegram-бота будет лежать в Keitaro postback URL и может попасть в логи;
- бот не сможет дедуплицировать события;
- бот не сохранит событие в локальную базу;
- команды `/last`, `/sales`, `/stats`, `/top`, `/bad`, `/late` не увидят эти депы;
- сложнее делать автоаналитику и фильтры.

Если нужен только сигнал "пришел деп", прямой вариант нормальный.

### Вариант 2. Keitaro -> bot webhook -> Telegram

1. Запусти бота на сервере, который доступен из интернета.

   Локальный `localhost:3000` Keitaro не увидит. Для теста можно использовать tunnel вроде ngrok/cloudflared, для постоянной работы лучше VPS + домен + HTTPS.

2. В `.env` задай секрет webhook:

   ```env
   WEBHOOK_TOKEN=random-secret-token
   WEBHOOK_PORT=3000
   ```

3. Запусти сервис:

   ```powershell
   npm run app
   ```

4. Проверь healthcheck снаружи:

   ```text
   https://your-domain.com/health
   ```

   Ответ должен быть:

   ```json
   {"ok":true}
   ```

5. В Keitaro открой настройки postback/S2S/C2S для источника или кампании, где нужно слать новые конверсии.

6. Добавь postback URL на endpoint бота:

   ```text
   https://your-domain.com/webhook/conversion?token=random-secret-token&conversion_id={conversion_id}&status={status}&sub_id={sub_id}&sub_id_1={sub_id_1}&sub_id_2={sub_id_2}&sub_id_3={sub_id_3}&sub_id_4={sub_id_4}&sub_id_5={sub_id_5}&sub_id_6={sub_id_6}&postback_datetime={postback_datetime}&sale_datetime={sale_datetime}&revenue={revenue}&campaign={campaign}&offer={offer}
   ```

   Названия макросов в Keitaro могут отличаться. Если какой-то макрос не подставляется, выбери соответствующий из интерфейса Keitaro. Главное для уведомлений о депах:

   - `status`;
   - `sub_id_5`;
   - `sale_datetime`;
   - `conversion_id`;
   - `revenue`.

7. Если Keitaro умеет отправлять postback только на sale, включи отправку только для `sale`. Если отправляет все статусы, бот сам отфильтрует и уведомит только по новым `sale`.

8. Сделай тестовый запрос вручную:

   ```text
   https://your-domain.com/webhook/conversion?token=random-secret-token&conversion_id=test-sale-1&status=sale&sub_id_5=2505%7CTZ%7Ckkid%7C817%7CVL_TZ22%7C1-1-2%7Ccbo%7C1&postback_datetime=2026-05-26%2010:00:00&sale_datetime=2026-05-26%2011:00:00&revenue=5
   ```

   Если все настроено, бот должен прислать сообщение `New sale`.

9. Проверь в Telegram:

   ```text
   /last 5
   /sales today
   /stats today
   ```

10. После теста можно удалить тестовую строку из `data/conversions.jsonl` вручную или оставить, если она не мешает.

## Хранилище

Есть два режима:

- `DATABASE_URL` пустой: используется локальное JSONL-хранилище в `DATA_DIR`.
- `DATABASE_URL` задан: используется PostgreSQL.

Для быстрого деплоя на сервере добавлен Docker Compose: он поднимает приложение и PostgreSQL вместе. Короткая инструкция лежит в `DEPLOY.md`.
