# Keitaro Dashboard

Это отдельный проект для рабочего kill/scale dashboard по Keitaro и расходам.

Главная идея: не делать каждый раз одноразовый отчет, а складывать данные в локальную SQLite-базу. Тогда можно быстро получать срезы за сегодня, вчера, 3 дня, 7 дней, 14 дней, месяц к дате и любой кастомный период.

Dashboard лежит отдельно от Telegram-бота, чтобы не смешивать две разные задачи:

- корень репозитория отвечает за Telegram-бота, webhook и отчеты;
- `dashboard/` отвечает за локальное хранилище, аналитику, kill/scale решения и web-интерфейс.

## Что Уже Есть

MVP умеет:

- хранить расходы из таблицы в SQLite;
- хранить Keitaro reports в SQLite;
- хранить ручной `Offer_Map`, чтобы склеивать названия офферов из расходов и Keitaro;
- считать KPI: revenue, spend, profit, ROI, deposits, CPA, RPD;
- делать срезы по периодам;
- выдавать summary: KPI, scale candidates, kill candidates, creative refresh, tracking issues;
- хранить рабочие задачи в тудушке, привязывать их к выбранному периоду и отдавать этот контекст Codex;
- находить базовые tracking-проблемы: `offer_null`, битые sub_id, zero revenue clicks, high bot, missing cost;
- собирать sub5-отчёт из raw `/conversions/log`: installs, реги, депы, recovered deps, late deps и revenue.

Расходы можно грузить прямо из web-интерфейса: CSV, TSV, XLSX, XLSM или JSON выгрузки из Facebook Ads Manager. JSON-импорт через CLI тоже оставлен, чтобы было удобно автоматизировать или отлаживать отдельные пачки данных.

## Где Хранятся Данные

По умолчанию база создается здесь:

```text
dashboard/data/keitaro-dashboard.sqlite3
```

Папка `dashboard/data/` добавлена в `.gitignore`, потому что база локальная и может содержать рабочие финансовые данные.

Путь можно переопределить:

```powershell
$env:KEITARO_DASHBOARD_DB = "C:\tmp\my-keitaro-dashboard.sqlite3"
```

Или через аргумент:

```powershell
python -m keitaro_dashboard --db-path C:\tmp\my-keitaro-dashboard.sqlite3 summary --period-key last_7_days
```

## Быстрый Старт

Все команды ниже выполняются из папки `dashboard/`:

```powershell
cd dashboard
```

Проверить, что CLI работает:

```powershell
python -m keitaro_dashboard --help
```

Запустить web-dashboard:

```powershell
python -m keitaro_dashboard serve
```

После запуска открой:

```text
http://127.0.0.1:8765
```

Если порт занят Docker dashboard, не запускай второй localhost на `8766` или другом порту. Нужно обновить основной Docker-процесс:

```powershell
docker compose up -d --build dashboard
```

Из корня репозитория можно запускать `.\run-keitaro-dashboard.ps1`. Скрипт проверяет порт: если `8765` уже занят, он не подбирает новый порт, а останавливается и напоминает обновить Docker dashboard.

React подключен на фронте через CDN (`unpkg.com`), поэтому для первого открытия UI нужен доступ к интернету. Backend и SQLite работают локально.

## Python Backend + React UI

В проекте теперь две части:

```text
dashboard/
├── src/keitaro_dashboard/
│   ├── web.py       # Python HTTP server + API
│   ├── store.py     # SQLite-хранилище и аналитика
│   ├── client.py    # Keitaro API client через curl
│   └── cli.py       # CLI-команды
└── static/
    ├── index.html   # React entry
    ├── app.js       # React dashboard
    └── styles.css   # UI стили
```

Python server отдает:

- React UI из `dashboard/static/`;
- API для summary и query;
- API для refresh данных из Keitaro;
- API для загрузки Facebook CSV/TSV/XLSX/XLSM/JSON;
- API для JSON-импорта расходов при ручной отладке и автоматизации;
- API для тудушки: добавить задачу, отметить выполненной, удалить.
- API для Codex bridge: короткий машинный контекст по KPI, задачам и решениям.
- API для sub5-отчёта напрямую из Keitaro.
- API для GEO-обзора: история по GEO, активные GEO-задачи и рекомендации.
- API для ручных GEO-карточек: статус, ответственный, план, бюджет, cap, payout, заметки и теги.

Основные API:

| Endpoint | Метод | Что делает |
|---|---|---|
| `/api/config` | GET | показывает путь к базе и статус Keitaro env |
| `/api/summary` | GET | возвращает KPI, scale/kill, creative refresh, tracking QA |
| `/api/query` | GET | возвращает точечный срез из SQLite |
| `/api/sub5-report` | GET | собирает live sub5-отчёт напрямую из Keitaro |
| `/api/geo/overview` | GET | возвращает GEO-срез, историю и активные GEO-задачи |
| `/api/geo/manual` | GET/POST | читает или сохраняет ручную карточку GEO без изменения авто-расходов и авто-доходов |
| `/api/geo/manual/delete` | POST | удаляет ручную карточку GEO |
| `/api/geo/tests` | GET/POST | читает или сохраняет тесты запусков по GEO |
| `/api/geo/tests/delete` | POST | удаляет тест запуска |
| `/api/refresh` | POST | тянет Keitaro reports и сохраняет в SQLite |
| `/api/upload-spend` | POST | загружает один или несколько Facebook-файлов через форму |
| `/api/ingest-spend` | POST | импортирует spend rows |
| `/api/offer-map` | POST | обновляет Offer_Map |
| `/api/todos` | GET/POST | читает список задач или создает новую |
| `/api/todos/update` | POST | меняет статус, название, дедлайн или привязку задачи |
| `/api/todos/delete` | POST | удаляет задачу |
| `/api/codex/context` | GET | отдает компактный JSON-контекст для Codex |

UI сейчас показывает:

- KPI по выбранному периоду;
- progress до `$1000/day`;
- top offers по profit;
- scale / kill / hold решения;
- creative refresh;
- tracking QA;
- загрузку расходов из Facebook CSV/TSV/XLSX;
- отдельную страницу GEO `#/geo`;
- краткий блок тудушки на главной;
- отдельную страницу тудушки `#/todos`;
- отдельную страницу sub5-отчёта `#/sub5`;
- быстрый JSON-импорт расходов через API.

## GEO Страница

Вкладка **"GEO"** показывает, что исторически происходило по гео и какие GEO сейчас в работе.

Что есть на странице:

- общий KPI-срез за выбранный период;
- таблица **"Что сделать по GEO"** с рекомендацией по каждому GEO;
- блок **"GEO в работе"** с открытыми задачами категории `geo`;
- история по дням: расход, доход, прибыль, ROI, депозиты;
- ручные карточки GEO: статус, ответственный, план действий, дневной бюджет, cap, payout, целевой ROI, заметки и теги;
- журнал тестов запусков: настройка таргета, гипотеза, ключ теста, список sub5-вариантов, креативы, статус и итоговый вывод;
- таблица креативов по GEO: доход, profit, клики, CR, EPC и burnout-оценка;
- кнопка **"В работу"**, которая создает задачу по GEO в тудушке.

Расход берется из Facebook spend rows. Депозиты и revenue подтягиваются из точного Keitaro deposits-слоя. Если Keitaro не отдает отдельное поле GEO, dashboard восстанавливает GEO из `sub_id_5`, offer или campaign: поддерживаются форматы `2505|ZM|buyer|...` и `ZM | 22BET | ...`. Если GEO все равно не распознан, dashboard показывает строку `UNKNOWN` и рекомендацию **"Починить GEO"**.

Ручные поля хранятся отдельно в таблице `geo_manual`, а тесты запусков - в `geo_tests`. Это важно: ты можешь руками вести GEO как рабочую карточку и сохранять результаты тестов, но `Расход`, `Доход`, `Депы`, `Profit`, `ROI`, `CPA` и `RPD` остаются фактическими метриками из импортированных расходов и Keitaro. Если у теста указан список `sub5_values`, dashboard суммирует метрики этих sub5 в текущем периоде и показывает их в строке теста.

API:

```text
GET /api/geo/overview?period_key=last_7_days&limit=80
```

Сохранить ручную карточку:

```text
POST /api/geo/manual
{
  "geo": "CO",
  "status": "in_work",
  "priority": "high",
  "owner": "kkid",
  "action": "проверить связки и добрать крео",
  "daily_budget": 120,
  "cap": 40,
  "target_roi": 0.35,
  "payout": 7,
  "notes": "оставить только связки с нормальным sub5",
  "tags": ["fb", "pwa", "scale"]
}
```

Сохранить тест запуска:

```text
POST /api/geo/tests
{
  "geo": "AR",
  "title": "18-45 man fb inst",
  "test_key": "AR|kkid|1845man|fb-inst|1-3-1|abo",
  "status": "running",
  "start_date": "2026-06-02",
  "sub5_values": [
    "0306|AR|kkid|123123|12|1845man|fb-inst|1-3-1|abo|2",
    "0406|AR|kkid|123123|12|1845man|fb-inst|1-3-1|abo|5",
    "0306|AR|kkid|321312|15|1845man|fb-inst|1-3-1|abo|1"
  ],
  "targeting": "мужчины 18-45, плейсы инста фб, старт с 00 по МСК",
  "hypothesis": "один таргет тестируется разными крео, аккаунтами и датами",
  "planned_budget": 120,
  "creatives": ["12", "15"],
  "result": "сравнить CR, депы и ROI по общей группе",
  "notes": "если ключ теста пустой, dashboard попробует вывести его из первого sub5"
}
```

Поле `sub5` в API остается для совместимости со старыми тестами. В интерфейсе достаточно заполнять `Sub5 варианты`: первый вариант автоматически становится основным `sub5`.

CLI:

```powershell
python -m keitaro_dashboard geo-report --period-key last_7_days
```

## Sub5 Report

Вкладка **"Sub5"** переносит в dashboard основную логику из проекта `keitaro-sub5-report`: отчёт строится напрямую по Keitaro API, без отдельного Node-сервиса и Telegram-бота.

Что считает:

- `installs` из `campaign_unique_clicks`;
- `regs` по `postback_datetime` и статусам `lead` / `sale`;
- `deps` по `sale_datetime`;
- `recovered_deps` по строкам, где `previous_status = sale`;
- `late_deps`, если деп пришёл в выбранное окно, а рега была вне этого окна;
- `revenue` по депам.

Окно дня можно считать с `00:00` или с buyer/cabinet часа, например `11:00`. Для даты `2026-05-26` и старта `11` отчёт считает период `2026-05-26 11:00:00` - `2026-05-27 10:59:59`.

API:

```text
GET /api/sub5-report?date=2026-05-26&group_by=sub5&start_hour=11
```

Поддерживаемые `group_by`:

- `sub5`
- `account`
- `offer`

Можно отфильтровать один `sub_id_5`:

```text
GET /api/sub5-report?date=2026-05-26&group_by=sub5&start_hour=11&sub5=2505|ZM|kkid|...
```

## Тудушка

В интерфейсе есть отдельная страница **"Тудушка"**: `http://127.0.0.1:8765/#/todos`.

На главной странице dashboard показывает только короткий блок: сколько задач открыто, сколько в работе, сколько важных и сколько просрочено. Это сделано специально, чтобы главная не превращалась в кашу, но важные дела все равно были видны рядом с KPI.

Полная страница тудушки нужна, чтобы рядом с цифрами фиксировать рабочие действия: что проверить, что выключить, что пересмотреть после обновления отчетов.

Как это работает:

1. Выбираешь период в верхней панели: сегодня, вчера, 7 дней и т.д.
2. Открываешь вкладку **"Тудушка"**.
3. Пишешь задачу, заметку, приоритет, категорию, дедлайн, ответственного и теги.
4. Dashboard сохраняет задачу в SQLite вместе с текущим `period_key`, `date_from`, `date_to` и базовыми KPI текущего экрана.
5. Потом задачу можно перевести в `open`, `in_progress`, `done`, отправить в архив или удалить.

Задачи хранятся в таблице `dashboard_actions` с `entity_type = 'todo'`. Это сделано специально: позже из этой же таблицы можно будет строить историю решений по дням, смотреть, какие действия были приняты на минусовых связках, и связывать ручные задачи с kill/scale логикой.

Поля задачи:

| Поле | Что означает |
|---|---|
| `title` | короткое название задачи |
| `note` | рабочий контекст или гипотеза |
| `status` | `open`, `in_progress`, `done`, `archived` |
| `priority` | `urgent`, `high`, `normal`, `low` |
| `category` | например `ops`, `geo`, `traffic`, `creative`, `tracking`, `finance`, `codex` |
| `deadline` | дедлайн в формате `YYYY-MM-DD` |
| `owner` | кто отвечает |
| `tags` | быстрые метки для поиска |
| `source` | откуда пришла задача: `dashboard`, `codex`, `manual` |
| `test_id` | id связанного GEO-теста из `geo_tests` |
| `test_key` | ключ связанного GEO-теста; используется как запасная привязка |
| `test_title` | название связанного GEO-теста для отображения в задачах |

Фильтры на странице позволяют смотреть активные задачи, архив, конкретный приоритет, период, источник и текстовый поиск.

## Codex Bridge

Codex bridge нужен, чтобы я мог быстро получать из dashboard не только сырые таблицы, но и рабочий контекст: KPI выбранного периода, открытые задачи, scale/kill candidates, креативы на обновление и tracking issues.

HTTP endpoint:

```text
GET /api/codex/context?period_key=today&todo_limit=30
```

CLI-команда из папки `dashboard/`:

```powershell
python -m keitaro_dashboard codex-context --period-key today
```

Добавить задачу от Codex:

```powershell
python -m keitaro_dashboard todo-add "Проверить связки без депов" --priority high --category tracking --source codex --tag deps
```

Посмотреть активные задачи:

```powershell
python -m keitaro_dashboard todo-list --status active
```

Обновить статус:

```powershell
python -m keitaro_dashboard todo-update 12 --status done
```

Это и есть простая интеграция между мной и dashboard: я могу читать состояние через `codex-context`, создавать задачи через `todo-add` или API, а ты видишь эти задачи в интерфейсе.

## Загрузка Facebook Таблиц

На главном экране есть блок **"Загрузка расходов Facebook"**. В нем можно выбрать один файл или сразу несколько таблиц за раз.

Можно загрузить:

- `.csv`
- `.tsv`
- `.xlsx`
- `.xlsm`
- `.json`

Для Facebook Ads Manager обычно достаточно выгрузить таблицу с такими колонками:

| Что нужно | Примеры колонок |
|---|---|
| дата | `Day`, `Date`, `Reporting starts`, `День`, `Дата`, `Начало отчетности` |
| расход | `Amount spent`, `Amount spent (USD)`, `Сумма затрат`, `Потраченная сумма` |
| кампания | `Campaign name`, `Название кампании` |
| адсет | `Ad set name`, `Название группы объявлений` |
| объявление / креатив | `Ad name`, `Название объявления` |
| депозиты / покупки | `Purchases`, `Website purchases`, `Покупки`, `Deposits` |
| value / revenue | `Purchase conversion value`, `Conversion value`, `Revenue`, `Ценность покупок` |

Минимально нужны только дата и расход. Если есть campaign/adset/ad, dashboard использует их как `offer_raw`, пока для них нет ручного `Offer_Map`.

Если выбрать несколько файлов и указать одну `Пачку данных`, dashboard сначала распознает все таблицы, объединит строки и только потом одним действием запишет общий batch в SQLite.

Режим **"Заменить расходы за даты из файлов"** удаляет старые Facebook-расходы за даты, найденные в загружаемых таблицах, и записывает новую пачку. Это защищает от ситуации, когда за один день случайно загружено несколько batch-ов и расход становится выше фактического.

После загрузки UI покажет:

- сколько файлов выбрано;
- сколько строк было во всех файлах;
- сколько строк удалось импортировать;
- сколько строк импортировалось по каждому файлу;
- какие строки пропущены;
- первые распознанные строки.

Если строки пропускаются, почти всегда причина одна из двух:

- не распознана колонка даты;
- не распознана колонка расхода.

В таком случае можно либо переименовать колонки в CSV/XLSX, либо позже добавить новый вариант названия в `dashboard/src/keitaro_dashboard/imports.py`.

## Ежедневный Workflow

Обычный порядок такой:

1. Обновить `Offer_Map`, если появились новые офферы или названия.
2. Загрузить расходы за день или период.
3. Обновить Keitaro reports.
4. Посмотреть summary за нужный период.
5. Использовать query для точечных срезов.

При обновлении Keitaro dashboard отдельно загружает точный слой `deposits` из `/conversions/log`. Это нужно для сегодняшних депозитов: часть депов может не попасть в обычный агрегированный report, особенно если конверсия зарегистрирована раньше или статус был перезаписан. Для KPI по депозитам, RPD и revenue по депам dashboard использует этот raw conversions слой.

## 1. Offer Map

`Offer_Map` нужен, чтобы привести разные названия одного оффера к единому `normalized_offer`.

Например, в таблице расходов оффер может называться:

```text
ZM | 22bet | 5
```

А в Keitaro:

```text
ZM | 22BET | 22BET AFRICA | reg
```

Для dashboard это должен быть один оффер:

```text
ZM 22BET 5
```

Пример файла `offer-map.json`:

```json
[
  {
    "normalized_offer": "ZM 22BET 5",
    "spend_offer_raw": "ZM | 22bet | 5",
    "keitaro_offer_pattern": "ZM | 22BET | 22BET AFRICA | reg",
    "geo": "ZM",
    "network": "22BET AFRICA",
    "brand": "22BET",
    "payout": 5,
    "status": "active",
    "notes": "Main Zambia 22bet offer"
  }
]
```

Загрузить маппинг:

```powershell
python -m keitaro_dashboard offer-map offer-map.json
```

Маппинг можно запускать повторно. Строки обновятся по ключу:

```text
normalized_offer + spend_offer_raw + keitaro_offer_pattern
```

## 2. Импорт Расходов

Расходы импортируются в таблицу `spend_rows`.

Основной способ теперь проще: открыть web-dashboard и загрузить Facebook export через блок **"Загрузка расходов Facebook"**.

CLI/JSON-импорт остается для ручной отладки и автоматизации.

Минимальный пример `spend-rows.json`:

```json
[
  {
    "date": "2026-05-29",
    "offer_raw": "ZM | 22bet | 5",
    "normalized_offer": "ZM 22BET 5",
    "geo": "ZM",
    "network": "22BET AFRICA",
    "brand": "22BET",
    "payout": 5,
    "deposits": 25,
    "revenue": 125,
    "acc_spend": 60,
    "pwa_spend": 10
  }
]
```

Загрузить расходы:

```powershell
python -m keitaro_dashboard ingest-spend spend-rows.json --batch-id 2026-05-29
```

Если нужно перезалить тот же batch заново:

```powershell
python -m keitaro_dashboard ingest-spend spend-rows.json --batch-id 2026-05-29 --replace-batch
```

Если `total_spend`, `profit`, `roi`, `cpa`, `rpd` не переданы, dashboard считает их сам:

```text
total_spend = acc_spend + pwa_spend
profit = revenue - total_spend
roi = profit / total_spend
cpa = total_spend / deposits
rpd = revenue / deposits
```

## 3. Обновление Keitaro Reports

Для refresh нужны `KEITARO_URL` и `KEITARO_API_KEY`.

Их можно задать в окружении:

```powershell
$env:KEITARO_URL = "https://your-tracker.example.com"
$env:KEITARO_API_KEY = "your-api-key"
```

Либо положить в `.env` в корне репозитория:

```text
KEITARO_URL=https://your-tracker.example.com
KEITARO_API_KEY=your-api-key
```

Dashboard читает эти значения из общих настроек проекта:

- переменные окружения `KEITARO_URL` и `KEITARO_API_KEY`;
- `.env` в папке `dashboard/`;
- `.env` в корне этого репозитория.

Обновить стандартные отчеты за последние 7 дней и month-to-date:

```powershell
python -m keitaro_dashboard refresh --period last_7_days --period month_to_date
```

Обновить только creative report:

```powershell
python -m keitaro_dashboard refresh --period last_7_days --report creative
```

Обновить кастомный период:

```powershell
python -m keitaro_dashboard refresh --date-from 2026-05-20 --date-to 2026-05-29 --period-key custom_may_20_29
```

Поддерживаемые периоды:

```text
today
yesterday
last_3_days
last_7_days
last_14_days
month_to_date
full_period
```

Стандартные Keitaro reports:

| Report | Dimensions |
|---|---|
| `daily` | `day` |
| `offer` | `offer` |
| `campaign` | `campaign` |
| `creative` | `offer, sub_id_6` |
| `placement` | `offer, sub_id_6, sub_id_8` |
| `tracking_quality` | `offer, campaign, sub_id_4, sub_id_6` |

## 4. Summary

Summary дает главный рабочий экран в JSON:

```powershell
python -m keitaro_dashboard summary --period-key last_7_days
```

В ответе будут:

- `kpis`: общие KPI;
- `scale_candidates`: что можно масштабировать;
- `kill_candidates`: что нужно резать или ставить на паузу;
- `hold_candidates`: что оставить под наблюдением;
- `creative_refresh`: какие креативы надо обновить;
- `tracking_issues`: проблемы трекинга.

Пример:

```powershell
python -m keitaro_dashboard summary --period-key month_to_date --target-daily-profit 1000 --target-roi 0.6
```

`target_daily_profit` и `target_roi` нужны для расчета:

```text
required_spend_for_target_profit = target_daily_profit / target_roi
profit_gap = target_daily_profit - current_profit
```

## 5. Query: Точечные Срезы

`query` нужен, когда надо не весь dashboard, а конкретный разрез.

Топ офферов по расходам за 7 дней:

```powershell
python -m keitaro_dashboard query --source spend --period-key last_7_days --group-by normalized_offer --order-by profit --order DESC
```

Keitaro creative performance:

```powershell
python -m keitaro_dashboard query --source keitaro --period-key last_7_days --report-name creative --group-by normalized_offer --group-by creative --order-by revenue --order DESC
```

Campaign performance:

```powershell
python -m keitaro_dashboard query --source keitaro --period-key last_7_days --report-name campaign --group-by campaign --order-by profit --order DESC
```

Кастомный период по расходам:

```powershell
python -m keitaro_dashboard query --source spend --date-from 2026-05-20 --date-to 2026-05-29 --group-by normalized_offer
```

## Какие Таблицы Есть В SQLite

### `spend_rows`

Сюда попадают расходы из таблицы.

Важные поля:

| Поле | Что означает |
|---|---|
| `date` | дата расхода |
| `offer_raw` | название оффера из таблицы расходов |
| `normalized_offer` | единое название оффера |
| `geo` | GEO |
| `network` | партнерка/сеть |
| `brand` | бренд |
| `payout` | payout |
| `deposits` | депозиты |
| `revenue` | доход |
| `acc_spend` | расход аккаунтов |
| `pwa_spend` | расход PWA |
| `total_spend` | общий расход |
| `profit` | прибыль |
| `roi` | ROI |
| `cpa` | стоимость депозита |
| `rpd` | revenue per deposit |

### `keitaro_report_rows`

Сюда попадают сохраненные Keitaro reports.

Важные поля:

| Поле | Что означает |
|---|---|
| `report_name` | тип отчета: offer, campaign, creative и т.д. |
| `period_key` | период: last_7_days, month_to_date и т.д. |
| `date_from` / `date_to` | границы периода |
| `offer` | offer из Keitaro |
| `normalized_offer` | offer после маппинга |
| `campaign` | кампания |
| `creative` / `sub_id_6` | креатив |
| `placement` / `sub_id_8` | placement |
| `clicks` | клики |
| `conversions` | конверсии |
| `revenue` | revenue |
| `cost` | cost из Keitaro |
| `profit` | profit из Keitaro |
| `roi` | ROI из Keitaro |
| `cr` | conversion rate |
| `epc` | earnings per click |
| `bot_share` | доля ботов |
| `raw_json` | исходная строка Keitaro без потерь |

### `offer_map`

Ручная склейка названий.

### `dashboard_actions`

Сюда попадают ручные задачи и будущие действия по связкам.

Для тудушки используются такие поля:

| Поле | Что означает |
|---|---|
| `entity_type` | тип записи, для задач это `todo` |
| `entity_name` | текст задачи |
| `period_key` | период, на котором задача была создана |
| `date_from` / `date_to` | границы периода |
| `metrics_json` | KPI текущего экрана на момент создания задачи |
| `reason` | комментарий или заметка |
| `deadline` | дедлайн, если указан |
| `status` | `open`, `in_progress`, `done` или `archived` |

### `dashboard_snapshots`

История refresh-запусков: когда, какой период и какой отчет был загружен.

## Decision Logic

Пока логика простая, MVP-уровня.

`scale`, если:

- ROI `>= 80%`;
- депозитов `>= 20`;
- bot share не выше `7%`.

`hold`, если:

- ROI от `20%` до `80%`;
- или депозиты есть, но данных пока мало.

`kill`, если:

- `offer` пустой или `null`;
- расход больше `2 payout`, а депозитов нет;
- ROI ниже `-20%`;
- клики есть, а revenue = 0.

Эти правила лежат в `dashboard/src/keitaro_dashboard/store.py`. Их можно спокойно менять по мере того, как появится больше реальных данных.

## Tracking QA

Dashboard отмечает проблемы:

| Issue | Условие |
|---|---|
| `offer_null` | offer пустой, `null`, `none`, `unknown` |
| `placeholder_subid` | `sub_id_4` или `sub_id_6` содержит `{sub` или `{{` |
| `no_revenue_clicks` | клики есть, revenue = 0 |
| `high_bot` | bot_share выше 10% |
| `cost_missing` | cost = 0 при наличии кликов |

## Как Это Должно Использоваться Дальше

MVP сейчас закрывает хранение, срезы, web-экран и загрузку Facebook-таблиц. Следующие логичные шаги:

- добавить историю загрузок расходов и кнопку отката пачки;
- добавить экспорт dashboard в `.xlsx`;
- добавить графики daily profit, spend, ROI, CPA;
- расширить creative burnout score;
- добавить отдельный budget planner до `$1000/day`.

Главное уже заложено: данные лежат не в одноразовом отчете, а в нормальной локальной базе, поэтому их можно удобно резать по любым периодам и группировкам.
