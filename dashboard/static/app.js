const h = React.createElement;
const { useEffect, useMemo, useRef, useState } = React;

const PERIODS = [
  ["today", "Сегодня"],
  ["yesterday", "Вчера"],
  ["last_3_days", "3 дня"],
  ["last_7_days", "7 дней"],
  ["last_14_days", "14 дней"],
  ["month_to_date", "Месяц"],
  ["full_period", "Весь период"],
];
const CUSTOM_PERIOD_KEY = "custom";
const PERIOD_OPTIONS = [...PERIODS, [CUSTOM_PERIOD_KEY, "Точные даты"]];

const DECISION_RU = {
  scale: "Скейлить",
  kill: "Выключить",
  hold: "Оставить",
  test: "Тест",
  watch: "Следить",
};

const REASON_RU = {
  "not enough volume for a confident action": "мало данных для уверенного решения",
  "tracking issue: offer is empty": "проблема трекинга: оффер пустой",
  "spent at least 2 payouts with zero deposits": "потрачено 2+ payout без депозитов",
  "ROI below -20% on tracked spend": "ROI ниже -20% на учтенном расходе",
  "ROI >= 80%, enough deposits, bot share acceptable": "ROI >= 80%, депозитов достаточно, ботность в норме",
  "has deposits or ROI is between 20% and 80%": "есть депозиты или ROI между 20% и 80%",
  "event prices are within target CPA guardrails": "цены событий в лимитах target CPA",
  "event prices are above target CPA guardrails": "цены событий выше лимитов target CPA",
  "has deposits but deposit price is above target CPA guardrail": "деп есть, но цена депа выше лимита target CPA",
  "clicks exist but revenue is zero": "клики есть, доход нулевой",
};

const ISSUE_RU = {
  offer_null: "пустой оффер",
  placeholder_subid: "плейсхолдер в sub_id",
  no_revenue_clicks: "клики без дохода",
  high_bot: "высокая ботность",
  cost_missing: "нет расхода",
};

const SEVERITY_RU = {
  high: "высокий",
  medium: "средний",
  low: "низкий",
};

const CREATIVE_ACTION_RU = {
  watch: "наблюдать",
  refresh: "обновить",
  "kill/remake": "остановить / пересобрать",
};

const TODO_STATUS_RU = {
  open: "Открыто",
  in_progress: "В работе",
  done: "Готово",
  archived: "Архив",
};

const TODO_PRIORITY_RU = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  urgent: "Срочно",
};

const TODO_PRIORITY_OPTIONS = ["urgent", "high", "normal", "low"];
const TODO_STATUS_OPTIONS = ["open", "in_progress", "done", "archived"];
const TODO_CATEGORY_OPTIONS = ["ops", "geo", "traffic", "creative", "tracking", "finance", "codex"];
const GEO_STATUS_RU = {
  planned: "В плане",
  in_work: "В работе",
  testing: "Тест",
  scaling: "Скейл",
  paused: "Пауза",
  done: "Готово",
  "": "Не заполнено",
};
const GEO_STATUS_OPTIONS = ["planned", "in_work", "testing", "scaling", "paused", "done"];
const GEO_TEST_STATUS_RU = {
  planned: "Запланирован",
  running: "Идет",
  finished: "Завершен",
  paused: "Пауза",
  failed: "Не зашел",
};
const GEO_TEST_STATUS_OPTIONS = ["planned", "running", "finished", "paused", "failed"];
const SUB5_GROUP_OPTIONS = [
  ["sub5", "Sub5"],
  ["account", "Аккаунты"],
  ["offer", "Офферы"],
];
const SUB5_NUMERIC_SORT_KEYS = new Set(["installs", "regs", "deps", "revenue", "total_spend", "cr", "cpi", "cpr", "cpd", "recovered_deps", "late_deps"]);
const SUB5_FILTER_KEYS = ["sub5", "buyer", "geo", "creative", "offer", "account_id"];
const SUB5_CSV_COLUMNS = ["sub5", "buyer", "geo", "creative", "offer", "account_id", "installs", "regs", "deps", "recovered_deps", "late_deps", "revenue", "total_spend", "cr", "cpi", "cpr", "cpd"];

const DASHBOARD_SECTIONS = [
  ["plan", "План работы"],
  ["import", "Импорт файлов"],
  ["todos", "Сводка задач"],
  ["kpis", "Ключевые метрики"],
  ["decisions", "Решения и аналитика"],
];

const DASHBOARD_KPIS = [
  ["profit", "Прибыль"],
  ["roi", "ROI"],
  ["revenue", "Доход"],
  ["spend", "Расход"],
  ["deposits", "Депозиты"],
  ["cpa", "CPA"],
  ["rpd", "RPD"],
  ["gap", "Недобор до цели"],
];

function defaultVisibility() {
  const sections = {};
  DASHBOARD_SECTIONS.forEach(([key]) => { sections[key] = true; });
  const kpis = {};
  DASHBOARD_KPIS.forEach(([key]) => { kpis[key] = true; });
  return { sections, kpis };
}

function mergeVisibility(saved) {
  const base = defaultVisibility();
  if (!saved || typeof saved !== "object") return base;
  return {
    sections: { ...base.sections, ...(saved.sections || {}) },
    kpis: { ...base.kpis, ...(saved.kpis || {}) },
  };
}

function defaultKeitaroRefreshSettings() {
  return { enabled: false, interval_minutes: 60 };
}

function mergeKeitaroRefreshSettings(saved) {
  const base = defaultKeitaroRefreshSettings();
  if (!saved || typeof saved !== "object") return base;
  const interval = Math.min(24 * 60, Math.max(5, Number(saved.interval_minutes || base.interval_minutes)));
  return {
    enabled: Boolean(saved.enabled),
    interval_minutes: Number.isFinite(interval) ? interval : base.interval_minutes,
  };
}

const TIMEZONE_OPTIONS = [
  "Asia/Tbilisi",
  "Europe/Moscow",
  "Europe/Kyiv",
  "Europe/Istanbul",
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
];

function defaultProfileSettings() {
  return {
    timezone: "Asia/Tbilisi",
    keitaro_token_present: false,
    env_keitaro_token_present: false,
    keitaro_base_url_present: false,
  };
}

function mergeProfileSettings(saved) {
  const base = defaultProfileSettings();
  if (!saved || typeof saved !== "object") return base;
  return {
    ...base,
    ...saved,
    timezone: saved.timezone || base.timezone,
    keitaro_token_present: Boolean(saved.keitaro_token_present),
    env_keitaro_token_present: Boolean(saved.env_keitaro_token_present),
    keitaro_base_url_present: Boolean(saved.keitaro_base_url_present),
  };
}

function refreshIntervalLabel(settings) {
  const minutes = Number(settings?.interval_minutes || 60);
  if (minutes >= 60 && minutes % 60 === 0) {
    return `${minutes / 60} ч`;
  }
  return `${minutes} мин`;
}

function getStoredTheme() {
  try {
    const saved = localStorage.getItem("dashboard-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch (err) { /* ignore */ }
  return "light";
}

function translate(map, value) {
  return map[value] || value || "-";
}

function apiGet(path, params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => search.append(key, item));
    } else if (value !== undefined && value !== null && value !== "") {
      search.set(key, value);
    }
  });
  return fetch(`${path}${search.toString() ? `?${search}` : ""}`).catch(() => {
    throw new Error("Dashboard API не ответил. Обнови Docker-контейнер и страницу.");
  }).then(readResponse);
}

function apiPost(path, body = {}) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    throw new Error("Dashboard API не ответил. Обнови Docker-контейнер и страницу.");
  }).then(readResponse);
}

function apiUpload(path, formData) {
  return fetch(path, { method: "POST", body: formData }).then(readResponse);
}

async function readResponse(response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function money(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(numeric) >= 1000 ? 0 : 2,
  }).format(numeric);
}

function number(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function percent(value) {
  const raw = Number(value || 0);
  const normalized = raw * 100;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(normalized)}%`;
}

function todayYmd() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function daysAgoYmd(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function addDaysYmd(ymd, days) {
  const date = new Date(`${ymd}T00:00:00`);
  date.setDate(date.getDate() + days);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function normalizePeriodDates(dateFrom, dateTo) {
  const from = dateFrom || dateTo || daysAgoYmd(6);
  const to = dateTo || dateFrom || todayYmd();
  return from <= to ? [from, to] : [to, from];
}

function periodRequestParams(periodKey, dateFrom, dateTo, customPeriodKey = CUSTOM_PERIOD_KEY) {
  if (periodKey === CUSTOM_PERIOD_KEY || dateFrom || dateTo) {
    const [from, to] = normalizePeriodDates(dateFrom, dateTo);
    return { period_key: customPeriodKey, date_from: from, date_to: to };
  }
  return { period_key: periodKey };
}

function refreshPeriodPayload(periodKey, dateFrom, dateTo, customPeriodKey = CUSTOM_PERIOD_KEY) {
  const params = periodRequestParams(periodKey, dateFrom, dateTo, customPeriodKey);
  if (params.date_from && params.date_to) return params;
  return { periods: [params.period_key] };
}

function formatPeriodLabel(periodKey, dateFrom = "", dateTo = "") {
  if (periodKey === CUSTOM_PERIOD_KEY || dateFrom || dateTo) {
    const [from, to] = normalizePeriodDates(dateFrom, dateTo);
    return from === to ? from : `${from} - ${to}`;
  }
  return PERIODS.find(([key]) => key === periodKey)?.[1] || periodKey;
}

function PeriodControl({
  periodKey,
  setPeriodKey,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  options = PERIOD_OPTIONS,
  resetPeriodKey = "last_7_days",
  keyPrefix = "period",
}) {
  function selectPeriod(value) {
    setPeriodKey(value);
    if (value === CUSTOM_PERIOD_KEY) {
      setDateFrom(dateFrom || daysAgoYmd(6));
      setDateTo(dateTo || todayYmd());
    } else {
      setDateFrom("");
      setDateTo("");
    }
  }

  function setCustomDate(setter, value) {
    setter(value);
    if (value) setPeriodKey(CUSTOM_PERIOD_KEY);
  }

  const customActive = periodKey === CUSTOM_PERIOD_KEY || dateFrom || dateTo;

  return [
    h("div", { className: cx("period-control", customActive && "is-custom"), key: `${keyPrefix}-control` }, [
      h("label", { className: "period-select", key: "select" }, [
        h("span", null, "Период"),
        h("select", { value: periodKey, onChange: (event) => selectPeriod(event.target.value) },
          options.map(([value, label]) => h("option", { value, key: value }, label))
        ),
      ]),
      customActive ? h("div", { className: "period-date-range", key: "range" }, [
        h("label", { className: "period-date", key: "from" }, [
          h("span", null, "С"),
          h("input", {
            type: "date",
            value: dateFrom,
            onChange: (event) => setCustomDate(setDateFrom, event.target.value),
          }),
        ]),
        h("span", { className: "period-date-dash", key: "dash" }, "-"),
        h("label", { className: "period-date", key: "to" }, [
          h("span", null, "По"),
          h("input", {
            type: "date",
            value: dateTo,
            onChange: (event) => setCustomDate(setDateTo, event.target.value),
          }),
        ]),
        h("button", {
          className: "period-reset",
          type: "button",
          onClick: () => {
            setDateFrom("");
            setDateTo("");
            setPeriodKey(resetPeriodKey);
          },
          title: "Сбросить точные даты",
          key: "reset",
        }, "×"),
      ]) : h("button", {
        className: "period-custom-button",
        type: "button",
        onClick: () => selectPeriod(CUSTOM_PERIOD_KEY),
        key: "custom",
      }, "Точные даты"),
    ]),
  ];
}

function downloadText(filename, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text || ""], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
  return Promise.resolve();
}

function cx(...items) {
  return items.filter(Boolean).join(" ");
}

function Panel({ title, eyebrow, right, children, className, id }) {
  return h("section", { className: cx("panel", className), id }, [
    h("div", { className: "panel-header", key: "header" }, [
      h("div", { className: "panel-title", key: "title" }, [
        eyebrow ? h("span", { className: "eyebrow", key: "eyebrow" }, eyebrow) : null,
        h("h2", { key: "h2" }, title),
      ]),
      right ? h("div", { className: "panel-actions", key: "right" }, right) : null,
    ]),
    h("div", { className: "panel-body", key: "body" }, children),
  ]);
}

function Pill({ children, tone }) {
  return h("span", { className: cx("pill", tone) }, children);
}

function KpiCard({ label, value, helper, tone, featured, loading }) {
  return h("div", { className: cx("kpi", !loading && tone, featured && "featured", loading && "is-loading") }, [
    h("div", { className: "label", key: "label" }, label),
    loading
      ? h("div", { className: "value", key: "value" }, h("span", { className: "skeleton skeleton-value" }))
      : h("div", { className: "value", key: "value" }, value),
    helper ? h("div", { className: "helper", key: "helper" }, helper) : null,
  ]);
}

function SectionTitle({ children, hint }) {
  return h("div", { className: "section-title" }, [
    h("span", { className: "section-title-text", key: "text" }, children),
    hint ? h("span", { className: "section-title-hint", key: "hint" }, hint) : null,
  ]);
}

function Empty({ children = "Данных пока нет" }) {
  return h("div", { className: "empty" }, children);
}

function WorkPlan({ config, onRefreshKeitaro, onOpenAutoRefresh, refreshSettings, refreshing, lastRefresh }) {
  return h(Panel, { title: "Порядок работы", eyebrow: "утро / день / вечер", className: "work-plan-panel" }, [
    h("div", { className: "steps work-plan-steps", key: "steps" }, [
      ["Загрузить расходы", "Facebook CSV/XLSX или JSON. Расход попадет в SQLite."],
      ["Обновить Keitaro", "Клики, доход, креативы, кампании и качество трекинга."],
      ["Принять решения", "Скейлить плюсовое, резать минус, обновлять выгорающие крео."],
    ].map(([title, text], index) => h("div", { className: "step", key: index }, [
      h("span", { className: "step-num", key: "num" }, index + 1),
      h("div", { className: "step-body", key: "body" }, [
        h("b", { key: "t" }, title),
        h("span", { key: "d" }, text),
      ]),
    ]))),
    h("div", { className: "work-plan-side", key: "side" }, [
      h("div", { className: "status-row compact", key: "status" }, [
        h(Pill, { tone: config?.keitaro?.configured ? "good" : "bad" },
          config?.keitaro?.configured ? "Keitaro подключен" : "Keitaro env не найден"
        ),
        h(Pill, null, "База: dashboard/data"),
        h(Pill, { tone: refreshSettings?.enabled ? "good" : null },
          refreshSettings?.enabled ? `Авто: ${refreshIntervalLabel(refreshSettings)}` : "Авто: выкл"
        ),
        lastRefresh ? h(Pill, null, `Последний refresh: ${lastRefresh}`) : null,
      ]),
      h("div", { className: "keitaro-refresh-actions", key: "refresh-actions" }, [
        h("button", { className: "primary wide", onClick: onRefreshKeitaro, disabled: refreshing, key: "refresh" },
          refreshing ? "Обновляю Keitaro..." : "Подтянуть данные Keitaro"
        ),
        h("button", { className: "wide", onClick: onOpenAutoRefresh, key: "auto" }, "Автообновление"),
      ]),
    ]),
  ]);
}

function FileImportPanel({ onImported }) {
  const fileRef = useRef(null);
  const [batchId, setBatchId] = useState("");
  const [replaceBatch, setReplaceBatch] = useState(true);
  const [fileCount, setFileCount] = useState(0);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload() {
    const files = Array.from(fileRef.current?.files || []);
    if (!files.length) {
      setError("Сначала выбери один или несколько CSV/XLSX файлов из Facebook Ads.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("file", file));
      if (batchId) {
        form.append("batch_id", batchId);
      }
      form.append("replace_batch", replaceBatch ? "true" : "false");
      form.append("replace_dates", replaceBatch ? "true" : "false");
      const data = await apiUpload("/api/upload-spend", form);
      setResult(data);
      onImported(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return h(Panel, {
    title: "Загрузка расходов Facebook",
    eyebrow: "CSV / TSV / XLSX / JSON",
    className: "upload-panel",
  }, [
    h("div", { className: "upload-box", key: "box" }, [
      h("input", {
        ref: fileRef,
        className: "file-picker-input",
        type: "file",
        multiple: true,
        accept: ".csv,.tsv,.txt,.xlsx,.xlsm,.json",
        onChange: (event) => setFileCount(event.target.files?.length || 0),
        key: "file",
      }),
      h("div", { className: "file-picker", key: "picker" }, [
        h("button", {
          type: "button",
          className: "file-picker-button",
          onClick: () => fileRef.current?.click(),
          key: "button",
        }, "Выбрать файлы"),
        h("span", { className: "file-picker-status", key: "status" },
          fileCount ? `${number(fileCount)} выбрано` : "Файлы не выбраны"
        ),
      ]),
      h("div", { className: "upload-copy", key: "copy" }, [
        h("b", null, "Можно выбрать сразу несколько выгрузок из Ads Manager"),
        h("span", null, "CSV, TSV, XLSX, XLSM и JSON сложатся в одну пачку данных."),
      ]),
    ]),
    h("div", { className: "form-row upload-form", key: "form" }, [
      h("label", null, [
        h("span", null, "Пачка данных"),
        h("input", {
          value: batchId,
          placeholder: "например 2026-05-29-fb-all",
          onChange: (event) => setBatchId(event.target.value),
        }),
      ]),
      h("label", { className: "check" }, [
        h("input", {
          type: "checkbox",
          checked: replaceBatch,
          onChange: (event) => setReplaceBatch(event.target.checked),
        }),
        "Заменить расходы за даты из файлов",
      ]),
      h("button", { type: "button", className: "primary", onClick: upload, disabled: busy }, busy ? "Загружаю..." : "Загрузить файлы"),
    ]),
    error ? h("div", { className: "error compact-error", key: "error" }, error) : null,
    result ? h("div", { className: "import-result", key: "result" }, [
      h("div", { className: "result-grid", key: "grid" }, [
        h("div", null, [h("b", null, number(result.file_count || 1)), h("span", null, "файлов выбрано")]),
        h("div", null, [h("b", null, number(result.source_rows)), h("span", null, "строк в файлах")]),
        h("div", null, [h("b", null, number(result.importable_rows)), h("span", null, "импортировано")]),
        h("div", null, [h("b", null, number(result.deleted)), h("span", null, "старых строк заменено")]),
        h("div", null, [h("b", null, result.batch_id || "-"), h("span", null, "пачка данных")]),
      ]),
      result.files?.length ? h("div", { className: "file-list", key: "files" },
        result.files.map((item, index) => h("div", { className: cx("file-item", item.error && "bad"), key: `${item.filename}-${index}` }, [
          h("b", null, item.filename),
          h("span", null, item.error
            ? item.error
            : `${number(item.importable_rows)} из ${number(item.source_rows)} строк импортировано`
          ),
        ]))
      ) : null,
      result.warnings?.length ? h("ul", { className: "warnings", key: "warnings" },
        result.warnings.map((warning, index) => h("li", { key: index }, warning))
      ) : null,
      h(PreviewTable, { rows: result.preview || [], key: "preview" }),
    ]) : null,
  ]);
}

function PreviewTable({ rows }) {
  if (!rows.length) return null;
  return h("div", { className: "preview-table" }, [
    h("div", { className: "preview-title", key: "title" }, "Первые строки после распознавания"),
    h(SimpleTable, {
      key: "table",
      rows,
      columns: [
        { key: "date", label: "Дата" },
        { key: "offer_raw", label: "Оффер / кампания" },
        { key: "acc_spend", label: "Расход", numeric: true, format: money },
        { key: "deposits", label: "Депы", numeric: true, format: number },
        { key: "revenue", label: "Доход", numeric: true, format: money },
      ],
    }),
  ]);
}

function TodoSummaryCard({ periodKey, dateFrom = "", dateTo = "" }) {
  const [todos, setTodos] = useState([]);
  const [stats, setStats] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadTodos() {
    setBusy(true);
    setError("");
    try {
      const data = await apiGet("/api/todos", { status: "active", include_done: "false", limit: 6 });
      setTodos(data.todos || []);
      setStats(data.stats || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadTodos();
  }, [periodKey, dateFrom, dateTo]);

  const periodLabel = formatPeriodLabel(periodKey, dateFrom, dateTo);

  return h(Panel, {
    title: "Тудушка",
    eyebrow: "кратко на сегодня",
    className: "todo-panel todo-brief",
    right: h("div", { className: "todo-summary" }, [
      h(Pill, { key: "period" }, periodLabel),
      h("a", { className: "button-link", href: "#/todos", key: "link" }, "Открыть"),
    ]),
  }, [
    error ? h("div", { className: "error compact-error", key: "error" }, error) : null,
    h("div", { className: "todo-stat-row", key: "stats" }, [
      h("div", null, [h("b", null, number(stats.open || 0)), h("span", null, "открыто")]),
      h("div", null, [h("b", null, number(stats.in_progress || 0)), h("span", null, "в работе")]),
      h("div", null, [h("b", null, number((stats.urgent || 0) + (stats.high || 0))), h("span", null, "важных")]),
      h("div", null, [h("b", null, number(stats.overdue || 0)), h("span", null, "просрочено")]),
    ]),
    todos.length ? h("div", { className: "todo-list brief-list", key: "list" },
      todos.slice(0, 4).map((todo) => h(TodoCard, {
        todo,
        compact: true,
        key: todo.id,
      }))
    ) : h(Empty, { key: "empty" }, busy ? "Загружаю задачи..." : "Открытых задач нет."),
  ]);
}

function TodoDeadlineField({ value, onChange }) {
  const today = localDateISO(0);
  const tomorrow = localDateISO(1);
  return h("div", { className: "todo-editor-field todo-deadline-field" }, [
    h("span", { key: "label" }, "Дедлайн"),
    h("div", { className: "todo-deadline-controls", key: "controls" }, [
      h("input", {
        type: "date",
        value: value || "",
        onChange: (event) => onChange(event.target.value),
        key: "input",
      }),
      h("div", { className: "todo-date-quick", key: "quick" }, [
        h("button", {
          type: "button",
          className: cx("todo-date-chip", value === today && "active"),
          onClick: () => onChange(value === today ? "" : today),
          key: "today",
        }, "Сегодня"),
        h("button", {
          type: "button",
          className: cx("todo-date-chip", value === tomorrow && "active"),
          onClick: () => onChange(value === tomorrow ? "" : tomorrow),
          key: "tomorrow",
        }, "Завтра"),
        value ? h("button", {
          type: "button",
          className: "todo-date-chip is-clear",
          onClick: () => onChange(""),
          title: "Очистить дедлайн",
          key: "clear",
        }, "×") : null,
      ]),
    ]),
  ]);
}

function TodoPage({ periodKey, summary }) {
  const [todos, setTodos] = useState([]);
  const [stats, setStats] = useState({});
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [selectedTodo, setSelectedTodo] = useState(null);
  const [geoTests, setGeoTests] = useState([]);
  const [bridgeCopied, setBridgeCopied] = useState("");
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    status: "active",
    priority: "all",
    period_key: "all",
    date_from: "",
    date_to: "",
    category: "all",
    source: "all",
    q: "",
  });
  const [draft, setDraft] = useState({
    title: "",
    note: "",
    owner: "",
    deadline: "",
    priority: "normal",
    category: "ops",
    tags: "",
    entity: "",
    source: "dashboard",
  });

  async function loadTodos() {
    setBusy(true);
    setError("");
    try {
      const params = {
        status: filters.status,
        priority: filters.priority,
        period_key: filters.period_key,
        date_from: filters.date_from,
        date_to: filters.date_to,
        category: filters.category,
        source: filters.source,
        q: filters.q,
        include_done: "true",
        include_archived: filters.status === "archived" ? "true" : "false",
        limit: 250,
      };
      const data = await apiGet("/api/todos", params);
      setTodos(data.todos || []);
      setStats(data.stats || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadGeoTestsForTodos() {
    try {
      const data = await apiGet("/api/geo/tests", { include_finished: "true", limit: 500 });
      setGeoTests(data.tests || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadTodos();
  }, [filters.status, filters.priority, filters.period_key, filters.date_from, filters.date_to, filters.category, filters.source]);

  useEffect(() => {
    loadGeoTestsForTodos();
  }, []);

  useEffect(() => {
    setSelectedTodo((current) => {
      if (!todos.length) return null;
      if (!current) return todos[0];
      return todos.find((todo) => todo.id === current.id) || todos[0];
    });
  }, [todos]);

  function updateDraft(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateDraftGeo(value) {
    const geo = normalizeTodoGeo(value);
    setDraft((current) => ({
      ...current,
      entity: geo,
      category: geo ? "geo" : current.category,
    }));
  }

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function createTodo(event) {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      setError("Напиши название задачи.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const geo = normalizeTodoGeo(draft.entity);
      const tags = withGeoTag(splitTags(draft.tags), geo);
      const category = geo ? "geo" : draft.category;
      await apiPost("/api/todos", {
        ...draft,
        title,
        category,
        tags,
        entity: geo,
        period_key: periodKey,
        date_from: summary?.date_from,
        date_to: summary?.date_to,
        metrics: {
          ...(geo ? { geo } : {}),
          revenue: summary?.kpis?.revenue || 0,
          total_spend: summary?.kpis?.total_spend || 0,
          profit: summary?.kpis?.profit || 0,
          deposits: summary?.kpis?.deposits || 0,
        },
      });
      setDraft((current) => ({
        ...current,
        title: "",
        note: "",
        deadline: "",
        tags: "",
        entity: "",
      }));
      await loadTodos();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateTodo(todo, patch) {
    setSavingId(todo.id);
    setError("");
    try {
      const data = await apiPost("/api/todos/update", { id: todo.id, ...patch });
      if (data.todo) {
        setTodos((items) => items.map((item) => (item.id === todo.id ? data.todo : item)));
        setSelectedTodo((current) => (current?.id === todo.id ? data.todo : current));
      }
      await loadTodos();
      return data.todo;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSavingId(null);
    }
  }

  async function deleteTodo(todo) {
    setSavingId(todo.id);
    setError("");
    try {
      await apiPost("/api/todos/delete", { id: todo.id });
      setTodos((items) => items.filter((item) => item.id !== todo.id));
      setSelectedTodo((current) => (current?.id === todo.id ? null : current));
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }

  async function copyBridgeCommand(key, text) {
    try {
      await copyText(text);
      setBridgeCopied(key);
      window.setTimeout(() => {
        setBridgeCopied((current) => (current === key ? "" : current));
      }, 1800);
    } catch (err) {
      setError("Не удалось скопировать. Команду можно выделить вручную.");
    }
  }

  const periodLabel = formatPeriodLabel(periodKey, summary?.date_from, summary?.date_to);
  const codexContextCommand = `python -m keitaro_dashboard codex-context --period-key ${periodKey}`;
  const codexTodoCommand = 'python -m keitaro_dashboard todo-add "Разобрать связку: что проверить и какой результат нужен" --priority high --category tracking --source codex --tag tracking';
  const codexEndpoint = `/api/codex/context?period_key=${encodeURIComponent(periodKey)}`;
  const visiblePeriodLabel = filters.period_key === "all"
    ? periodLabel
    : formatPeriodLabel(filters.period_key, filters.date_from, filters.date_to);
  const listTitle = filters.status === "active" ? "Активные" : TODO_STATUS_RU[filters.status] || "Задачи";
  const importantCount = Number(stats.urgent || 0) + Number(stats.high || 0);
  const activeTodo = selectedTodo ? (todos.find((todo) => todo.id === selectedTodo.id) || selectedTodo) : null;
  const categoryCounts = useMemo(() => {
    const counts = new Map();
    todos.forEach((todo) => {
      const key = todo.category || "ops";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 9);
  }, [todos]);
  const statusNav = [
    ["active", "Активные", stats.total || todos.length],
    ["in_progress", "В работе", stats.in_progress || 0],
    ["open", "Открытые", stats.open || 0],
    ["done", "Готово", stats.done || 0],
    ["archived", "Архив", stats.archived || 0],
  ];

  return h("div", { className: "todo-page" }, [
    h("section", { className: "todo-workspace", key: "workspace" }, [
      h("aside", { className: "todo-sidebar", key: "sidebar" }, [
        h("div", { className: "todo-sidebar-head", key: "head" }, [
          h("span", { className: "todo-avatar", key: "avatar" }, "K"),
          h("div", { key: "copy" }, [
            h("b", null, "Задачи"),
            h("span", null, visiblePeriodLabel),
          ]),
        ]),
        h("div", { className: "todo-nav-list", key: "status" },
          statusNav.map(([value, label, count]) => h("button", {
            type: "button",
            className: cx("todo-nav-button", filters.status === value && "active"),
            onClick: () => updateFilter("status", value),
            key: value,
          }, [
            h("span", { className: "todo-nav-dot", key: "dot" }),
            h("span", { key: "label" }, label),
            h("b", { key: "count" }, number(count || 0)),
          ]))
        ),
        h("div", { className: "todo-sidebar-section", key: "lists" }, [
          h("div", { className: "todo-sidebar-title", key: "title" }, [
            h("span", null, "Списки"),
            h("button", {
              type: "button",
              className: cx("todo-mini-action", filters.category === "all" && "active"),
              onClick: () => updateFilter("category", "all"),
            }, "Все"),
          ]),
          h("div", { className: "todo-list-links", key: "links" },
            (categoryCounts.length ? categoryCounts : [["ops", 0], ["tracking", 0], ["geo", 0]]).map(([category, count]) => h("button", {
              type: "button",
              className: cx("todo-list-link", filters.category === category && "active"),
              onClick: () => updateFilter("category", category),
              key: category,
            }, [
              h("span", { key: "name" }, category),
              h("b", { key: "count" }, number(count || 0)),
            ]))
          ),
        ]),
        h("div", { className: "todo-sidebar-section todo-sidebar-stats", key: "stats" }, [
          h("div", null, [h("b", null, number(stats.open || 0)), h("span", null, "открыто")]),
          h("div", null, [h("b", null, number(stats.in_progress || 0)), h("span", null, "в работе")]),
          h("div", null, [h("b", null, number(importantCount)), h("span", null, "важных")]),
          h("div", null, [h("b", null, number(stats.overdue || 0)), h("span", null, "просрочено")]),
        ]),
        h("details", { className: "todo-sidebar-section todo-new-task", key: "create", open: false }, [
          h("summary", null, "Новая задача"),
          h("form", { className: "todo-create todo-create-compact", onSubmit: createTodo }, [
            h("label", { className: "wide", key: "title" }, [
              h("span", null, "Задача"),
              h("input", {
                value: draft.title,
                placeholder: "Разобрать офферы без депов",
                onChange: (event) => updateDraft("title", event.target.value),
              }),
            ]),
            h("label", { className: "wide", key: "note" }, [
              h("span", null, "Заметка"),
              h("textarea", {
                value: draft.note,
                rows: 3,
                placeholder: "Контекст, гипотеза, что проверить",
                onChange: (event) => updateDraft("note", event.target.value),
              }),
            ]),
            h("label", { key: "priority" }, [
              h("span", null, "Приоритет"),
              h("select", { value: draft.priority, onChange: (event) => updateDraft("priority", event.target.value) },
                TODO_PRIORITY_OPTIONS.map((value) => h("option", { value, key: value }, TODO_PRIORITY_RU[value]))
              ),
            ]),
            h("label", { key: "category" }, [
              h("span", null, "Категория"),
              h("select", { value: draft.category, onChange: (event) => updateDraft("category", event.target.value) },
                TODO_CATEGORY_OPTIONS.map((value) => h("option", { value, key: value }, value))
              ),
            ]),
            h("label", { key: "entity" }, [
              h("span", null, "GEO"),
              h("input", { value: draft.entity, placeholder: "ZM", onChange: (event) => updateDraftGeo(event.target.value) }),
            ]),
            h(TodoDeadlineField, { value: draft.deadline, onChange: (value) => updateDraft("deadline", value), key: "deadline" }),
            h("label", { key: "owner" }, [
              h("span", null, "Ответственный"),
              h("input", { value: draft.owner, placeholder: "я / buyer / codex", onChange: (event) => updateDraft("owner", event.target.value) }),
            ]),
            h("label", { className: "wide", key: "tags" }, [
              h("span", null, "Теги"),
              h("input", { value: draft.tags, placeholder: "fb, deps, tracking", onChange: (event) => updateDraft("tags", event.target.value) }),
            ]),
            h("button", { className: "primary wide", type: "submit", disabled: busy, key: "submit" },
              busy ? "Сохраняю..." : "Добавить"
            ),
          ]),
        ]),
        h("details", { className: "todo-sidebar-section codex-bridge todo-bridge-compact", key: "bridge" }, [
          h("summary", null, "Codex bridge"),
          h("div", { className: "bridge-step", key: "context" }, [
            h("span", { className: "bridge-step-num", key: "num" }, "1"),
            h("div", { className: "bridge-step-body", key: "body" }, [
              h("div", { className: "bridge-step-head", key: "head" }, [
                h("b", null, "Передать контекст"),
                h("span", null, "KPI, задачи и кандидаты за выбранный период."),
              ]),
              h("div", { className: "bridge-command", key: "command" }, [
                h("code", null, codexContextCommand),
                h("button", {
                  type: "button",
                  onClick: () => copyBridgeCommand("context", codexContextCommand),
                }, bridgeCopied === "context" ? "Скопировано" : "Копировать"),
              ]),
            ]),
          ]),
          h("div", { className: "bridge-step", key: "todo" }, [
            h("span", { className: "bridge-step-num", key: "num" }, "2"),
            h("div", { className: "bridge-step-body", key: "body" }, [
              h("div", { className: "bridge-step-head", key: "head" }, [
                h("b", null, "Создать карточку"),
                h("span", null, "Codex пишет следующий шаг в тудушку."),
              ]),
              h("div", { className: "bridge-command", key: "command" }, [
                h("code", null, codexTodoCommand),
                h("button", {
                  type: "button",
                  onClick: () => copyBridgeCommand("todo", codexTodoCommand),
                }, bridgeCopied === "todo" ? "Скопировано" : "Копировать"),
              ]),
            ]),
          ]),
          h("details", { className: "bridge-technical", key: "api" }, [
            h("summary", null, "HTTP endpoint"),
            h("div", { className: "bridge-command", key: "endpoint" }, [
              h("code", null, codexEndpoint),
              h("button", {
                type: "button",
                onClick: () => copyBridgeCommand("endpoint", codexEndpoint),
              }, bridgeCopied === "endpoint" ? "Скопировано" : "Копировать"),
            ]),
          ]),
        ]),
      ]),
      h("main", { className: "todo-list-pane", key: "list" }, [
        h("div", { className: "todo-main-head", key: "head" }, [
          h("div", { className: "todo-main-title", key: "title" }, [
            h("span", null, visiblePeriodLabel),
            h("h2", null, listTitle),
          ]),
          h(Pill, { tone: stats.overdue ? "bad" : "", key: "pill" },
            stats.overdue
              ? `${number(stats.overdue)} просрочено`
              : `${number(stats.total || todos.length)} задач`
          ),
        ]),
        h("form", { className: "todo-quick-add", onSubmit: createTodo, key: "quick" }, [
          h("span", { className: "todo-quick-plus", key: "plus" }, "+"),
          h("input", {
            value: draft.title,
            placeholder: "Добавить задачу",
            onChange: (event) => updateDraft("title", event.target.value),
            key: "input",
          }),
          h("button", { type: "submit", disabled: busy || !draft.title.trim(), key: "button" },
            busy ? "..." : "Добавить"
          ),
        ]),
        h("div", { className: "todo-filter-strip", key: "filters" }, [
          h("select", { value: filters.priority, onChange: (event) => updateFilter("priority", event.target.value), key: "priority" }, [
            h("option", { value: "all" }, "Любой приоритет"),
            ...TODO_PRIORITY_OPTIONS.map((value) => h("option", { value, key: value }, TODO_PRIORITY_RU[value])),
          ]),
          ...PeriodControl({
            periodKey: filters.period_key,
            setPeriodKey: (value) => updateFilter("period_key", value),
            dateFrom: filters.date_from,
            setDateFrom: (value) => updateFilter("date_from", value),
            dateTo: filters.date_to,
            setDateTo: (value) => updateFilter("date_to", value),
            options: [["all", "Все периоды"], ...PERIOD_OPTIONS],
            resetPeriodKey: "all",
            keyPrefix: "todo-period",
          }),
          h("select", { value: filters.source, onChange: (event) => updateFilter("source", event.target.value), key: "source" }, [
            h("option", { value: "all" }, "Все источники"),
            h("option", { value: "dashboard" }, "dashboard"),
            h("option", { value: "codex" }, "codex"),
            h("option", { value: "manual" }, "manual"),
          ]),
          h("input", {
            value: filters.q,
            placeholder: "Поиск",
            onChange: (event) => updateFilter("q", event.target.value),
            onKeyDown: (event) => {
              if (event.key === "Enter") loadTodos();
            },
            key: "q",
          }),
          h("button", { type: "button", onClick: loadTodos, disabled: busy, key: "refresh" }, busy ? "Ищу..." : "Применить"),
        ]),
        error ? h("div", { className: "error compact-error", key: "error" }, error) : null,
        todos.length ? h("div", { className: "todo-board", key: "board" },
          todos.map((todo) => h(TodoCard, {
            todo,
            filters,
            saving: savingId === todo.id,
            selected: activeTodo?.id === todo.id,
            onOpen: () => setSelectedTodo(todo),
            onStatus: (status) => updateTodo(todo, { status }),
            onArchive: () => updateTodo(todo, { status: "archived" }),
            onDelete: () => deleteTodo(todo),
            key: todo.id,
          }))
        ) : h(Empty, { key: "empty" }, busy ? "Загружаю задачи..." : "По этим фильтрам задач нет."),
      ]),
      h("aside", { className: "todo-detail-pane", key: "detail" }, [
        activeTodo ? h(TodoCardEditor, {
          todo: activeTodo,
          geoTests,
          saving: savingId === activeTodo.id,
          mode: "pane",
          onSave: updateTodo,
          onArchive: async () => {
            await updateTodo(activeTodo, { status: "archived" });
            setSelectedTodo(null);
          },
          onDelete: async () => {
            await deleteTodo(activeTodo);
          },
          onClose: () => setSelectedTodo(null),
          key: "todo-editor",
        }) : h("div", { className: "todo-detail-empty", key: "empty" }, [
          h("b", null, "Выбери задачу"),
          h("span", null, "Карточка появится здесь."),
        ]),
      ]),
    ]),
  ]);
}

function TodoCard({ todo, compact = false, saving = false, selected = false, onOpen, onStatus, onArchive, onDelete, filters }) {
  const metricLine = todo.metrics?.profit !== undefined
    ? `срез: profit ${money(todo.metrics.profit)} / spend ${money(todo.metrics.total_spend)} / deps ${number(todo.metrics.deposits)}`
    : "";
  const checklist = checklistProgress(todo.checklist);
  const isDone = todo.status === "done";
  const period = todo.period_key
    ? PERIODS.find(([key]) => key === todo.period_key)?.[1] || todo.period_key
    : "";
  const categoryImplied = filters && filters.category !== "all" && filters.category === todo.category;
  const sideParts = [
    categoryImplied ? "" : todo.category,
    todo.entity ? (todo.category === "geo" ? `GEO ${normalizeTodoGeo(todo.entity)}` : todo.entity) : "",
    period,
  ].filter(Boolean);
  const openProps = onOpen && !compact ? {
    role: "button",
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen();
      }
    },
  } : {};
  function stop(handler) {
    return (event) => {
      event.stopPropagation();
      handler?.();
    };
  }
  return h("div", {
    className: cx("todo-item", `priority-${todo.priority}`, isDone && "done", compact && "compact", selected && "selected", onOpen && !compact && "is-clickable"),
    ...openProps,
  }, [
    !compact && onStatus ? h("label", {
      className: "todo-row-check",
      onClick: (event) => event.stopPropagation(),
      title: isDone ? "Открыть задачу" : "Отметить готовой",
      key: "check",
    }, [
      h("input", {
        type: "checkbox",
        checked: isDone,
        disabled: saving,
        onChange: (event) => onStatus(event.target.checked ? "done" : "open"),
        key: "input",
      }),
      h("span", { key: "box" }),
    ]) : null,
    h("div", { className: "todo-card-main", key: "main" }, [
      h("div", { className: "todo-card-head", key: "head" }, [
        h("b", null, todo.title),
        h("span", { className: cx("todo-badge", todo.priority) }, TODO_PRIORITY_RU[todo.priority] || todo.priority),
      ]),
      todo.note && !compact ? h("p", { className: "todo-note", key: "note" }, todo.note) : null,
      h("div", { className: "todo-meta", key: "meta" }, todoMeta(todo)),
      todo.tags?.length && !compact ? h("div", { className: "todo-tags", key: "tags" },
        todo.tags.map((tag) => h("span", { key: tag }, `#${tag}`))
      ) : null,
      checklist.total && !compact ? h("div", { className: "todo-checklist-meta", key: "checklist" }, `чеклист ${checklist.done}/${checklist.total}`) : null,
      metricLine && !compact ? h("div", { className: "todo-metrics", key: "metrics" }, metricLine) : null,
    ]),
    compact ? null : h("div", { className: "todo-row-side", key: "side" }, [
      filters && filters.status === todo.status
        ? null
        : h("span", { className: "todo-row-status", key: "status" }, TODO_STATUS_RU[todo.status] || todo.status),
      sideParts.length ? h("span", { className: "todo-row-meta", key: "meta" }, sideParts.join(" / ")) : null,
      onOpen ? h("button", {
        className: "todo-row-menu",
        type: "button",
        disabled: saving,
        onClick: stop(onOpen),
        title: "Открыть карточку",
        key: "open",
      }, "...") : null,
    ]),
  ]);
}

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean);
}

function normalizeTodoGeo(value) {
  return String(value || "").trim().toUpperCase();
}

function withGeoTag(tags, geo) {
  const normalizedGeo = normalizeTodoGeo(geo);
  if (!normalizedGeo) return tags;
  if (tags.some((tag) => normalizeTodoGeo(tag) === normalizedGeo)) return tags;
  return [...tags, normalizedGeo];
}

function joinTags(tags) {
  return Array.isArray(tags) ? tags.join(", ") : "";
}

function normalizeChecklistItem(item) {
  if (item && typeof item === "object") {
    return {
      text: String(item.text || item.title || "").trim(),
      checked: Boolean(item.checked || item.done),
    };
  }
  return {
    text: String(item || "").trim(),
    checked: false,
  };
}

function normalizeChecklist(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map(normalizeChecklistItem)
    .filter((item) => item.text);
}

function checklistProgress(items) {
  const normalized = normalizeChecklist(items);
  const total = normalized.length;
  const done = normalized.filter((item) => item.checked).length;
  return { total, done };
}

function todoEditorDraft(todo) {
  return {
    title: todo.title || "",
    note: todo.note || "",
    status: todo.status || "open",
    priority: todo.priority || "normal",
    category: todo.category || "ops",
    owner: todo.owner || "",
    deadline: todo.deadline || "",
    source: todo.source || "dashboard",
    tags: joinTags(todo.tags),
    link: todo.link || "",
    entity: todo.entity || "",
    test_id: todo.test_id || "",
    test_key: todo.test_key || "",
    test_title: todo.test_title || "",
    checklist: normalizeChecklist(todo.checklist),
  };
}

function TodoCardEditor({ todo, geoTests = [], saving = false, mode = "modal", onSave, onArchive, onDelete, onClose, onOpenGeo, onOpenTest }) {
  const [draft, setDraft] = useState(() => todoEditorDraft(todo));
  const [newChecklistItem, setNewChecklistItem] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setDraft(todoEditorDraft(todo));
    setNewChecklistItem("");
    setLocalError("");
  }, [todo.id]);

  function updateDraft(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateDraftGeo(value) {
    const geo = normalizeTodoGeo(value);
    setDraft((current) => ({
      ...current,
      entity: geo,
      category: geo ? "geo" : current.category,
    }));
  }

  function updateDraftTest(value) {
    const selected = geoTests.find((test) => String(test.id) === String(value));
    setDraft((current) => {
      if (!selected) {
        return {
          ...current,
          test_id: "",
          test_key: "",
          test_title: "",
        };
      }
      const geo = normalizeTodoGeo(selected.geo);
      return {
        ...current,
        test_id: selected.id || "",
        test_key: selected.test_key || "",
        test_title: selected.title || "",
        entity: geo || current.entity,
        category: geo ? "geo" : current.category,
        tags: geo ? joinTags(withGeoTag(splitTags(current.tags), geo)) : current.tags,
      };
    });
  }

  function updateChecklistItem(index, patch) {
    setDraft((current) => ({
      ...current,
      checklist: current.checklist.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      ),
    }));
  }

  function removeChecklistItem(index) {
    setDraft((current) => ({
      ...current,
      checklist: current.checklist.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function addChecklistItem() {
    const text = newChecklistItem.trim();
    if (!text) return;
    setDraft((current) => ({
      ...current,
      checklist: [...current.checklist, { text, checked: false }],
    }));
    setNewChecklistItem("");
  }

  async function save(event) {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      setLocalError("Название задачи обязательно.");
      return;
    }
    setLocalError("");
    try {
      const selectedTest = geoTests.find((test) => String(test.id) === String(draft.test_id));
      const selectedTestGeo = normalizeTodoGeo(selectedTest?.geo || "");
      const isGeoTodo = draft.category === "geo" || Boolean(selectedTestGeo);
      const entity = isGeoTodo ? normalizeTodoGeo(draft.entity || selectedTestGeo) : String(draft.entity || "").trim();
      const tags = isGeoTodo ? withGeoTag(splitTags(draft.tags), entity) : splitTags(draft.tags);
      const metricsPatch = isGeoTodo || todo.metrics?.geo ? { geo: isGeoTodo ? entity : "" } : undefined;
      await onSave(todo, {
        title,
        note: draft.note,
        status: draft.status,
        priority: draft.priority,
        category: draft.category,
        owner: draft.owner,
        deadline: draft.deadline,
        source: draft.source,
        tags,
        link: draft.link,
        entity,
        test_id: selectedTest ? selectedTest.id : "",
        test_key: selectedTest ? selectedTest.test_key || "" : "",
        test_title: selectedTest ? selectedTest.title || "" : "",
        ...(metricsPatch ? { metrics: metricsPatch } : {}),
        checklist: normalizeChecklist(draft.checklist),
      });
    } catch (err) {
      setLocalError(err.message);
    }
  }

  async function quickStatus(status) {
    updateDraft("status", status);
    setLocalError("");
    try {
      await onSave(todo, { status });
    } catch (err) {
      setLocalError(err.message);
    }
  }

  const progress = checklistProgress(draft.checklist);
  const isPane = mode === "pane";
  const selectedTest = geoTests.find((test) => String(test.id) === String(draft.test_id));
  const testOptions = draft.test_id && !selectedTest
    ? [{ id: draft.test_id, geo: draft.entity, title: draft.test_title || draft.test_key || `Test ${draft.test_id}`, test_key: draft.test_key }, ...geoTests]
    : geoTests;
  const linkedGeo = normalizeTodoGeo(draft.entity || selectedTest?.geo || todo.metrics?.geo || "");
  const linkedTest = selectedTest || (draft.test_id ? {
    id: draft.test_id,
    geo: linkedGeo,
    title: draft.test_title || draft.test_key || `Test ${draft.test_id}`,
    test_key: draft.test_key,
  } : null);

  const card = h("form", {
    className: cx("todo-card-modal", isPane && "todo-card-pane-card"),
    onClick: isPane ? undefined : (event) => event.stopPropagation(),
    onSubmit: save,
    key: "modal",
  }, [
      h("div", { className: "todo-card-modal-head", key: "head" }, [
        h("div", { className: "todo-card-title-edit", key: "title" }, [
          h("span", { className: cx("todo-badge", draft.priority), key: "badge" }, TODO_PRIORITY_RU[draft.priority] || draft.priority),
          h("input", {
            value: draft.title,
            onChange: (event) => updateDraft("title", event.target.value),
            placeholder: "Название карточки",
            autoFocus: !isPane,
            key: "input",
          }),
        ]),
        h("button", { className: "icon-btn", type: "button", onClick: onClose, title: "Закрыть", key: "close" }, "×"),
      ]),
      h("div", { className: "todo-card-modal-body", key: "body" }, [
        h("div", { className: "todo-card-main-edit", key: "main" }, [
          h("label", { className: "todo-editor-field", key: "note" }, [
            h("span", null, "Описание"),
            h("textarea", {
              className: "todo-card-textarea",
              value: draft.note,
              rows: 3,
              placeholder: "Контекст, гипотеза, что проверить",
              onChange: (event) => updateDraft("note", event.target.value),
            }),
          ]),
          h(TodoChecklistEditor, {
            items: draft.checklist,
            done: progress.done,
            total: progress.total,
            newItem: newChecklistItem,
            onNewItem: setNewChecklistItem,
            onAdd: addChecklistItem,
            onUpdate: updateChecklistItem,
            onRemove: removeChecklistItem,
            key: "checklist",
          }),
          h("label", { className: "todo-editor-field", key: "tags" }, [
            h("span", null, "Теги"),
            h("input", {
              value: draft.tags,
              placeholder: "fb, deps, tracking",
              onChange: (event) => updateDraft("tags", event.target.value),
            }),
          ]),
          (linkedGeo || linkedTest) ? h("div", { className: "entity-link-row", key: "links" }, [
            linkedGeo && onOpenGeo ? h("button", {
              type: "button",
              className: "entity-link",
              onClick: () => onOpenGeo(linkedGeo),
              key: "geo",
            }, `GEO ${linkedGeo}`) : null,
            linkedTest && onOpenTest ? h("button", {
              type: "button",
              className: "entity-link",
              onClick: () => onOpenTest(linkedTest),
              key: "test",
            }, `Тест ${linkedTest.title || linkedTest.test_key || linkedTest.id}`) : null,
          ]) : null,
          h("div", { className: "todo-card-muted", key: "meta" }, todoMeta({ ...todo, ...draft, tags: splitTags(draft.tags) })),
        ]),
        h("aside", { className: "todo-card-side-edit", key: "side" }, [
          h("label", { className: "todo-editor-field", key: "status" }, [
            h("span", null, "Статус"),
            h("select", { value: draft.status, onChange: (event) => updateDraft("status", event.target.value) },
              TODO_STATUS_OPTIONS.map((value) => h("option", { value, key: value }, TODO_STATUS_RU[value]))
            ),
          ]),
          h("label", { className: "todo-editor-field", key: "priority" }, [
            h("span", null, "Приоритет"),
            h("select", { value: draft.priority, onChange: (event) => updateDraft("priority", event.target.value) },
              TODO_PRIORITY_OPTIONS.map((value) => h("option", { value, key: value }, TODO_PRIORITY_RU[value]))
            ),
          ]),
          h("label", { className: "todo-editor-field", key: "category" }, [
            h("span", null, "Категория"),
            h("select", { value: draft.category, onChange: (event) => updateDraft("category", event.target.value) },
              TODO_CATEGORY_OPTIONS.map((value) => h("option", { value, key: value }, value))
            ),
          ]),
          h("label", { className: "todo-editor-field", key: "owner" }, [
            h("span", null, "Ответственный"),
            h("input", { value: draft.owner, onChange: (event) => updateDraft("owner", event.target.value) }),
          ]),
          h(TodoDeadlineField, { value: draft.deadline, onChange: (value) => updateDraft("deadline", value), key: "deadline" }),
          h("label", { className: "todo-editor-field", key: "source" }, [
            h("span", null, "Источник"),
            h("input", { value: draft.source, onChange: (event) => updateDraft("source", event.target.value) }),
          ]),
          h("label", { className: "todo-editor-field", key: "entity" }, [
            h("span", null, "GEO"),
            h("input", { value: draft.entity, placeholder: "ZM", onChange: (event) => updateDraftGeo(event.target.value) }),
          ]),
          h("label", { className: "todo-editor-field", key: "test" }, [
            h("span", null, "Тест"),
            h("select", { value: draft.test_id || "", onChange: (event) => updateDraftTest(event.target.value) }, [
              h("option", { value: "", key: "none" }, "Без теста"),
              ...testOptions.map((test) => h("option", { value: test.id, key: test.id }, [
                test.geo ? `${test.geo} / ` : "",
                test.title || `Test ${test.id}`,
                test.test_key ? ` / ${test.test_key}` : "",
              ])),
            ]),
          ]),
          h("label", { className: "todo-editor-field", key: "link" }, [
            h("span", null, "Ссылка"),
            h("input", { value: draft.link, placeholder: "https://...", onChange: (event) => updateDraft("link", event.target.value) }),
          ]),
        ]),
      ]),
      (localError ? h("div", { className: "error compact-error", key: "error" }, localError) : null),
      h("div", { className: "todo-card-modal-actions", key: "actions" }, [
        h("div", { className: "todo-card-quick-actions", key: "quick" }, [
          draft.status !== "in_progress" ? h("button", { type: "button", disabled: saving, onClick: () => quickStatus("in_progress"), key: "progress" }, "В работу") : null,
          draft.status !== "done" ? h("button", { type: "button", className: "primary", disabled: saving, onClick: () => quickStatus("done"), key: "done" }, "Готово") : null,
          draft.status === "done" ? h("button", { type: "button", disabled: saving, onClick: () => quickStatus("open"), key: "open" }, "Открыть") : null,
        ]),
        h("div", { className: "todo-card-save-actions", key: "save" }, [
          h("button", { type: "button", disabled: saving, onClick: onArchive, key: "archive" }, "Архив"),
          h("button", { type: "button", className: "ghost danger", disabled: saving, onClick: onDelete, key: "delete" }, "Удалить"),
          h("button", { type: "button", disabled: saving, onClick: onClose, key: "cancel" }, isPane ? "Скрыть" : "Отмена"),
          h("button", { type: "submit", className: "primary", disabled: saving, key: "submit" }, saving ? "Сохраняю..." : "Сохранить"),
        ]),
      ]),
  ]);
  if (isPane) return card;
  return h("div", { className: "todo-card-overlay", onClick: onClose }, [card]);
}

function TodoChecklistEditor({ items, done, total, newItem, onNewItem, onAdd, onUpdate, onRemove }) {
  return h("div", { className: "todo-checklist-editor" }, [
    h("div", { className: "todo-checklist-head", key: "head" }, [
      h("span", { className: "todo-checklist-label", key: "label" }, "Чеклист"),
      h("span", { className: "todo-checklist-count", key: "count" }, total ? `${done}/${total}` : "0"),
    ]),
    total ? h("div", { className: "todo-checklist-progress", key: "progress" }, [
      h("span", { style: { width: `${Math.round((done / total) * 100)}%` } }),
    ]) : null,
    h("div", { className: "todo-checklist-items", key: "items" }, [
      ...items.map((item, index) => h("div", {
        className: cx("todo-checklist-row", item.checked && "checked"),
        key: `check-${index}`,
      }, [
        h("label", { className: "todo-checklist-check", key: "check", title: item.checked ? "Отметить невыполненным" : "Отметить выполненным" }, [
          h("input", {
            type: "checkbox",
            checked: item.checked,
            onChange: (event) => onUpdate(index, { checked: event.target.checked }),
          }),
          h("span", null),
        ]),
        h("input", {
          className: "todo-checklist-text",
          value: item.text,
          placeholder: "Пункт чеклиста",
          onChange: (event) => onUpdate(index, { text: event.target.value }),
          onKeyDown: (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAdd();
            }
          },
          key: "text",
        }),
        h("button", {
          className: "todo-checklist-remove",
          type: "button",
          onClick: () => onRemove(index),
          title: "Удалить пункт",
          key: "remove",
        }, "×"),
      ])),
      h("div", { className: "todo-checklist-add", key: "add" }, [
        h("span", { className: "todo-checklist-add-icon", key: "icon" }, "+"),
        h("input", {
          value: newItem,
          placeholder: "Добавить пункт",
          onChange: (event) => onNewItem(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAdd();
            }
          },
          key: "input",
        }),
        h("button", {
          type: "button",
          onClick: onAdd,
          disabled: !newItem.trim(),
          key: "button",
        }, "Добавить"),
      ]),
    ]),
  ]);
}

function TodoPanel({ periodKey, summary }) {
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function addTodo(event) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Напиши задачу, которую нужно зафиксировать.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiPost("/api/todos", {
        title: trimmed,
        deadline,
        period_key: periodKey,
        date_from: summary?.date_from,
        date_to: summary?.date_to,
        source: "dashboard",
        metrics: {
          revenue: summary?.kpis?.revenue || 0,
          total_spend: summary?.kpis?.total_spend || 0,
          profit: summary?.kpis?.profit || 0,
          deposits: summary?.kpis?.deposits || 0,
        },
      });
      setTitle("");
      setDeadline("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return h(Panel, { title: "Быстро добавить", eyebrow: "ручная задача", className: "todo-panel" }, [
    h("form", { className: "todo-form", onSubmit: addTodo, key: "form" }, [
      h("input", {
        value: title,
        placeholder: "Например: проверить минусовые связки после залива",
        onChange: (event) => setTitle(event.target.value),
        key: "title",
      }),
      h("input", {
        type: "date",
        value: deadline,
        onChange: (event) => setDeadline(event.target.value),
        key: "deadline",
      }),
      h("button", { className: "primary", type: "submit", disabled: busy, key: "submit" },
        busy ? "Сохраняю..." : "Добавить"
      ),
    ]),
    error ? h("div", { className: "error compact-error", key: "error" }, error) : null,
  ]);
}

function todoStatusTone(status) {
  if (status === "done") return "good";
  if (status === "in_progress") return "accent";
  if (status === "archived") return "muted";
  return "";
}

function localDateISO(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const tzAdjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return tzAdjusted.toISOString().slice(0, 10);
}

function todoDeadlineTone(deadline) {
  if (!deadline) return "";
  const today = localDateISO(0);
  if (deadline < today) return "bad";
  if (deadline === today) return "warn";
  return "";
}

function todoMeta(todo) {
  const chips = [];
  const push = (kind, text, tone) => {
    if (!text) return;
    chips.push(h("span", { className: cx("todo-meta-chip", `kind-${kind}`, tone), key: kind }, text));
  };
  if (todo.status) push("status", TODO_STATUS_RU[todo.status] || todo.status, todoStatusTone(todo.status));
  if (todo.category) push("category", todo.category);
  if (todo.entity) push("entity", todo.category === "geo" ? `GEO ${normalizeTodoGeo(todo.entity)}` : todo.entity, "accent");
  if (todo.test_title || todo.test_key) push("test", `тест ${todo.test_title || todo.test_key}`, "accent");
  if (todo.owner) push("owner", todo.owner);
  if (todo.deadline) push("deadline", `дедлайн ${todo.deadline}`, todoDeadlineTone(todo.deadline));
  if (todo.date_from && todo.date_to) {
    push("dates", todo.date_from === todo.date_to ? todo.date_from : `${todo.date_from} – ${todo.date_to}`, "muted");
  }
  if (todo.source) push("source", todo.source, "muted");
  return chips;
}

function BarList({ rows, labelKey, valueKey, format = money }) {
  if (!rows.length) return h(Empty, null, "После загрузки расходов здесь появятся офферы.");
  const max = Math.max(...rows.map((row) => Math.abs(Number(row[valueKey] || 0))), 1);
  return h("div", { className: "bar-list" }, rows.map((row, index) => {
    const value = Number(row[valueKey] || 0);
    const width = `${Math.max(2, Math.round((Math.abs(value) / max) * 100))}%`;
    return h("div", { className: "bar-row", key: `${row[labelKey]}-${index}` }, [
      h("div", { className: "bar-label", title: row[labelKey] || "-", key: "label" }, row[labelKey] || "-"),
      h("div", { className: "bar-track", key: "track" }, h("div", {
        className: cx("bar-fill", value < 0 && "negative"),
        style: { width },
      })),
      h("div", { className: cx("bar-value", value > 0 && "pos", value < 0 && "neg"), key: "value" }, format(value)),
    ]);
  }));
}

function signedCell(value, format) {
  const num = Number(value || 0);
  const tone = num > 0 ? "pos" : num < 0 ? "neg" : "zero";
  return h("span", { className: cx("num-cell", tone) }, format(num));
}

const EVENT_PRICE_LABELS = {
  click: "CPC",
  install: "CPI",
  reg: "CPR",
  dep: "CPD",
};

const EVENT_PRICE_ORDER = ["dep", "reg", "install", "click"];

function eventPriceRows(metrics) {
  const events = metrics?.event_signals || {};
  return EVENT_PRICE_ORDER.map((event) => {
    const signal = events[event];
    if (!signal || Number(signal.count || 0) <= 0) return null;
    const status = signal.status || "";
    const tone = status === "ok" ? "ok" : status === "expensive" ? "bad" : "muted";
    const label = status === "ok" ? "OK" : status === "expensive" ? "дорого" : "нет CPA";
    return {
      event,
      label: EVENT_PRICE_LABELS[event],
      price: Number(signal.price || 0),
      limit: Number(signal.limit || 0),
      status,
      statusLabel: label,
      tone,
    };
  }).filter(Boolean);
}

function eventPriceStack(metrics) {
  const rows = eventPriceRows(metrics);
  if (!rows.length) return null;
  const targetCpa = Number(metrics?.target_cpa || 0);
  return h("div", { className: "event-price-stack" }, [
    h("div", { className: "event-price-grid", key: "grid" }, rows.map((row) => h("span", {
      className: cx("event-price-chip", row.tone),
      key: row.event,
    }, [
      h("b", { key: "label" }, row.label),
      h("strong", { key: "price" }, money(row.price)),
      h("small", { key: "limit" }, ["лимит ", h("b", { key: "limit-value" }, money(row.limit))]),
      h("em", { key: "status" }, row.statusLabel),
    ]))),
    targetCpa ? h("div", { className: "event-price-target", key: "target" }, [
      "Target CPA ",
      h("b", null, money(targetCpa)),
    ]) : null,
  ]);
}

function decisionPriceExplain(metrics, title, fallback, extra = "") {
  const stack = eventPriceStack(metrics);
  return h("div", { className: "decision-reason-detail" }, [
    h("div", { className: "decision-reason-title", key: "title" }, title),
    stack || h("div", { className: "decision-reason-text", key: "fallback" }, fallback),
    extra ? h("div", { className: "decision-reason-note", key: "extra" }, extra) : null,
  ]);
}

function decisionExplain(row) {
  const m = row.metrics || {};
  const roi = percent(m.roi);
  const deps = number(m.deposits);
  const bots = `${number(m.bot_share)}%`;
  const spend = money(m.spend);
  const payout = money(m.payout);
  switch (row.reason) {
    case "ROI >= 80%, enough deposits, bot share acceptable":
      return `ROI ${roi} ≥ 80%, депозитов ${deps} ≥ 20, боты ${bots} ≤ 7%`;
    case "has deposits or ROI is between 20% and 80%":
      return `ROI ${roi} в зоне 20–80% или есть депозиты (${deps})`;
    case "event prices are within target CPA guardrails":
      return decisionPriceExplain(m, "Дешевый funnel-сигнал", "цены событий в норме");
    case "event prices are above target CPA guardrails":
      return decisionPriceExplain(m, "События выше лимитов", "известные цены событий дорогие");
    case "has deposits but deposit price is above target CPA guardrail":
      return decisionPriceExplain(m, "Деп есть, CPD дорогой", "CPD выше лимита", "Не скейлить до улучшения цены депа.");
    case "ROI below -20% on tracked spend":
      return `ROI ${roi} ниже −20% при расходе ${spend}`;
    case "spent at least 2 payouts with zero deposits":
      return `0 депозитов при расходе ${spend} (≥ 2× выплата ${payout})`;
    case "tracking issue: offer is empty":
      return "оффер пустой — проблема трекинга";
    case "clicks exist but revenue is zero":
      return "клики есть, доход нулевой";
    case "not enough volume for a confident action":
      return `мало данных: депозитов ${deps}, расход ${spend}`;
    default:
      return translate(REASON_RU, row.reason);
  }
}

function DecisionTable({ rows }) {
  if (!rows.length) return h(Empty, null, "Решений пока нет: загрузите расходы и обновите Keitaro.");
  const hasSub5 = rows.some((row) => row.entity_type === "sub5");
  const hasOffer = rows.some((row) => row.entity_type !== "sub5");
  const entityLabel = hasSub5 && !hasOffer ? "Sub5" : hasOffer && !hasSub5 ? "Оффер" : "Связка";
  return h(SimpleTable, {
    rows,
    columns: [
      { key: "entity_name", label: entityLabel },
      { key: "decision", label: "Решение", format: (value) => h("span", { className: cx("decision", value) }, DECISION_RU[value] || value) },
      { key: "profit", label: "Прибыль", numeric: true, format: (_, row) => signedCell(row.metrics?.profit, money) },
      { key: "roi", label: "ROI", numeric: true, format: (_, row) => signedCell(row.metrics?.roi, percent) },
      { key: "reason", label: "Почему", format: (_, row) => decisionExplain(row) },
    ],
  });
}

function DecisionLegend() {
  const [open, setOpen] = useState(false);
  return h("div", { className: "decision-legend" }, [
    h("button", {
      className: cx("legend-toggle", open && "is-open"),
      onClick: () => setOpen(!open),
      key: "btn",
    }, open ? "Скрыть правила расчёта" : "Как считаются решения?"),
    open ? h("div", { className: "legend-body", key: "body" }, [
      h("p", { className: "legend-intro", key: "intro" }, "Для каждой связки берётся первое подходящее правило сверху вниз:"),
      h("ul", { className: "legend-rules", key: "rules" }, [
        h("li", { key: "k1" }, [h("b", { className: "decision kill" }, "Отключить"), " — оффер пустой (сломан трекинг)"]),
        h("li", { key: "k2" }, [h("b", { className: "decision kill" }, "Отключить"), " — 0 депозитов, а расход ≥ 2× выплаты за депозит"]),
        h("li", { key: "k3" }, [h("b", { className: "decision kill" }, "Отключить"), " — известные цены install/reg/dep выше лимитов target CPA и ROI ниже 20%"]),
        h("li", { key: "k4" }, [h("b", { className: "decision kill" }, "Отключить"), " — ROI ниже −20% на учтённом расходе и нет дешёвого funnel-сигнала"]),
        h("li", { key: "s1" }, [h("b", { className: "decision scale" }, "Масштабировать"), " — ROI ≥ 80%, депозитов ≥ 20 и ботность ≤ 7%"]),
        h("li", { key: "h1" }, [h("b", { className: "decision hold" }, "Оставить"), " — есть дешёвый funnel-сигнал: CPI ≤ 10%, CPR ≤ 20% или CPD ≤ 80% от target CPA"]),
        h("li", { key: "h2" }, [h("b", { className: "decision hold" }, "Оставить"), " — есть депозиты или ROI в зоне 20–80%"]),
        h("li", { key: "k5" }, [h("b", { className: "decision kill" }, "Отключить"), " — есть клики, но доход нулевой"]),
        h("li", { key: "t1" }, [h("b", { className: "decision test" }, "Тест"), " — данных мало для уверенного решения"]),
      ]),
      h("p", { className: "legend-note", key: "note" }, "Target CPA = payout / (1 + целевой ROI). Стартовые лимиты: CPC ≤ 2%, CPI ≤ 10%, CPR ≤ 20%, CPD ≤ 80% от target CPA. Доход и депозиты — из точного отчёта Keitaro, расход — из загруженных файлов FB/PWA."),
    ]) : null,
  ]);
}

function SimpleTable({ rows, columns, sort, onSort }) {
  if (!rows.length) return h(Empty);
  return h("div", { className: "table-wrap" },
    h("table", null, [
      h("thead", { key: "thead" }, h("tr", null, columns.map((column) => {
        const sorted = sort?.key === column.key;
        const sortable = column.sortable && onSort;
        return h("th", {
          className: cx(column.numeric && "num", sortable && "sortable", sorted && "sorted"),
          key: column.key,
          "aria-sort": sorted ? (sort.order === "asc" ? "ascending" : "descending") : undefined,
        }, sortable ? h("button", {
          type: "button",
          className: "sort-button",
          onClick: () => onSort(column.key),
        }, [
          h("span", { key: "label" }, column.label),
          h("span", { className: "sort-indicator", key: "indicator" }, sorted ? (sort.order === "asc" ? "↑" : "↓") : "↕"),
        ]) : column.label);
      }))),
      h("tbody", { key: "tbody" }, rows.map((row, index) => h("tr", { key: index }, columns.map((column) => {
        const rendered = column.format ? column.format(row[column.key], row) : (row[column.key] || "-");
        return h("td", { className: column.numeric ? "num" : "", key: column.key }, rendered);
      })))),
    ])
  );
}

function numericValue(value) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function creativeBadge(row, mode) {
  if (mode === "burnout") {
    const score = numericValue(row.burnout_score);
    return {
      score,
      label: row.burnout_label || "Мало данных",
      reason: row.burnout_reason || "",
      tone: score >= 60 ? "hot" : score > 0 ? "watch" : "neutral",
    };
  }
  const hasScore = row.performance_score !== undefined && row.performance_score !== null;
  const score = hasScore ? numericValue(row.performance_score) : numericValue(row.burnout_score);
  return {
    score,
    label: row.performance_label || row.burnout_label || "Мало данных",
    reason: row.performance_reason || row.burnout_reason || "",
    tone: score >= 60 ? "fresh" : score > 0 ? "watch" : score < 0 ? "hot" : "neutral",
  };
}

function textValue(value) {
  return String(value || "").toLowerCase();
}

function filterSub5Rows(rows, filter) {
  const terms = String(filter || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return rows;
  return rows.filter((row) => {
    const haystack = SUB5_FILTER_KEYS.map((key) => textValue(row[key])).join(" ");
    return terms.every((term) => haystack.includes(term));
  });
}

function sortSub5Rows(rows, sortKey, sortOrder) {
  const direction = sortOrder === "asc" ? 1 : -1;
  const isNumeric = SUB5_NUMERIC_SORT_KEYS.has(sortKey);
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const a = isNumeric ? numericValue(left.row[sortKey]) : textValue(left.row[sortKey]);
      const b = isNumeric ? numericValue(right.row[sortKey]) : textValue(right.row[sortKey]);
      const primary = isNumeric ? a - b : a.localeCompare(b);
      if (primary !== 0) return primary * direction;
      const fallback = textValue(left.row.sub5 || left.row.offer || left.row.account_id)
        .localeCompare(textValue(right.row.sub5 || right.row.offer || right.row.account_id));
      return fallback || left.index - right.index;
    })
    .map((item) => item.row);
}

function summarizeSub5Rows(rows) {
  const totals = rows.reduce((acc, row) => {
    acc.installs += numericValue(row.installs);
    acc.regs += numericValue(row.regs);
    acc.deps += numericValue(row.deps);
    acc.recovered_deps += numericValue(row.recovered_deps);
    acc.late_deps += numericValue(row.late_deps);
    acc.revenue += numericValue(row.revenue);
    acc.total_spend += numericValue(row.total_spend);
    return acc;
  }, { installs: 0, regs: 0, deps: 0, recovered_deps: 0, late_deps: 0, revenue: 0, total_spend: 0 });
  return {
    ...totals,
    groups: rows.length,
    cr: totals.regs ? totals.deps / totals.regs : 0,
    cpi: totals.installs ? totals.total_spend / totals.installs : 0,
    cpr: totals.regs ? totals.total_spend / totals.regs : 0,
    cpd: totals.deps ? totals.total_spend / totals.deps : 0,
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[;"\n\r|]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function makeSub5RowsCsv(rows, groupBy) {
  const groupColumn = groupBy === "account" ? "account_id" : groupBy === "offer" ? "offer" : "sub5";
  const columns = Array.from(new Set([groupColumn, ...SUB5_CSV_COLUMNS]));
  return [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ""))]
    .map((line) => line.map(csvCell).join(";"))
    .join("\r\n");
}

function emptyGeoDraft(geo = "") {
  return {
    geo,
    status: "planned",
    priority: "normal",
    owner: "",
    action: "",
    daily_budget: "",
    cap: "",
    target_roi: "",
    payout: "",
    notes: "",
    tags: "",
  };
}

function geoDraftFromRow(row = {}) {
  const manual = row.manual || row || {};
  const tags = Array.isArray(manual.tags) ? manual.tags.join(", ") : (manual.tags || "");
  return {
    geo: String(row.geo || manual.geo || "").toUpperCase(),
    status: manual.status || row.manual_status || "planned",
    priority: manual.priority || row.manual_priority || "normal",
    owner: manual.owner || row.manual_owner || "",
    action: manual.action || row.manual_action || "",
    daily_budget: manual.daily_budget || row.manual_daily_budget || "",
    cap: manual.cap || row.manual_cap || "",
    target_roi: manual.target_roi || row.manual_target_roi || "",
    payout: manual.payout || row.manual_payout || "",
    notes: manual.notes || row.manual_notes || "",
    tags,
  };
}

function geoRowFromManual(manual = {}) {
  const geo = String(manual.geo || "").toUpperCase();
  return {
    geo,
    manual,
    manual_status: manual.status || "",
    manual_priority: manual.priority || "normal",
    manual_owner: manual.owner || "",
    manual_action: manual.action || "",
    manual_daily_budget: manual.daily_budget || "",
    manual_cap: manual.cap || "",
    manual_target_roi: manual.target_roi || "",
    manual_payout: manual.payout || "",
    manual_notes: manual.notes || "",
    manual_tags: manual.tags || [],
    total_spend: 0,
    revenue: 0,
    profit: 0,
    roi: 0,
    deposits: 0,
    offers: [],
    top_offers: [],
    top_creatives: [],
    tests: [],
    todos: [],
  };
}

function hasManualGeo(row) {
  return Boolean(
    row.manual_status ||
    row.manual_owner ||
    row.manual_action ||
    row.manual_daily_budget ||
    row.manual_cap ||
    row.manual_notes
  );
}

function emptyGeoTestDraft(geo = "") {
  return {
    id: "",
    geo,
    title: "",
    test_key: "",
    status: "planned",
    start_date: todayYmd(),
    end_date: "",
    sub5: "",
    sub5_values: "",
    targeting: "",
    hypothesis: "",
    planned_budget: "",
    creatives: "",
    result: "",
    notes: "",
  };
}

function emptyGeoTaskDraft() {
  return {
    title: "",
    note: "",
    priority: "normal",
  };
}

function geoTestDraftFromRow(row = {}) {
  const creatives = Array.isArray(row.creatives) ? row.creatives.join(", ") : (row.creatives || "");
  const sub5Values = Array.isArray(row.sub5_values) ? row.sub5_values.join("\n") : (row.sub5_values || "");
  return {
    id: row.id || "",
    geo: String(row.geo || "").toUpperCase(),
    title: row.title || "",
    test_key: row.test_key || "",
    status: row.status || "planned",
    start_date: row.start_date || todayYmd(),
    end_date: row.end_date || "",
    sub5: row.sub5 || "",
    sub5_values: sub5Values,
    targeting: row.targeting || "",
    hypothesis: row.hypothesis || "",
    planned_budget: row.planned_budget || "",
    creatives,
    result: row.result || "",
    notes: row.notes || "",
  };
}

function GeoTestTodosCell({ row, onOpenTodo }) {
  const stats = row.todo_stats || {};
  const todos = row.todos || [];
  const total = Number(row.todo_count || todos.length || 0);
  if (!total) return h("span", { className: "geo-test-todos-empty" }, "-");
  return h("div", { className: "geo-test-todos-cell" }, [
    h("div", { className: "geo-test-todos-summary", key: "summary" }, [
      h("b", { key: "active" }, number(row.active_todo_count || 0)),
      h("span", { key: "label" }, ` активно / ${number(total)} всего`),
    ]),
    h("div", { className: "geo-test-todos-stats", key: "stats" }, [
      h("span", { key: "open" }, `open ${number(stats.open || 0)}`),
      h("span", { key: "progress" }, `work ${number(stats.in_progress || 0)}`),
      h("span", { key: "done" }, `done ${number(stats.done || 0)}`),
      Number(stats.overdue || 0) ? h("span", { className: "bad", key: "overdue" }, `late ${number(stats.overdue || 0)}`) : null,
    ]),
    todos.slice(0, 3).length ? h("ul", { className: "geo-test-todos-list", key: "list" },
      todos.slice(0, 3).map((todo) => h("li", { key: todo.id },
        onOpenTodo ? h("button", {
          className: "entity-list-link",
          type: "button",
          onClick: () => onOpenTodo(todo),
        }, [
          h("span", { className: cx("todo-dot", todo.status), key: "dot" }),
          h("span", { key: "title" }, todo.title),
        ]) : [
          h("span", { className: cx("todo-dot", todo.status), key: "dot" }),
          h("span", { key: "title" }, todo.title),
        ]
      ))
    ) : null,
  ]);
}

function parseMultilineList(value) {
  const items = String(value || "").split(/[\n\r,;]+/).map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set(items));
}

function geoTestSub5Values(test = {}) {
  const values = Array.isArray(test.sub5_values)
    ? test.sub5_values
    : parseMultilineList(test.sub5_values || "");
  const allValues = [test.sub5, ...values]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return Array.from(new Set(allValues));
}

function geoTestOptionLabel(test = {}) {
  const values = geoTestSub5Values(test);
  const prefix = test.geo ? `${test.geo} / ` : "";
  const key = test.test_key ? ` / ${test.test_key}` : "";
  const count = values.length ? ` / ${number(values.length)} sub5` : " / без sub5";
  return `${prefix}${test.title || `Test ${test.id}`}${key}${count}`;
}

function GeoCardModal({
  row,
  draft,
  onPatch,
  onSave,
  onDelete,
  onClose,
  saving,
  deleting,
  message,
  taskDraft = emptyGeoTaskDraft(),
  onTaskPatch,
  onTaskCreate,
  taskSaving,
  onOpenTest,
  onOpenTodo,
}) {
  const offers = row.offers || row.top_offers || [];
  const creatives = row.top_creatives || [];
  const tests = row.tests || [];
  const todos = row.todos || [];
  const lifetimeMetrics = row.lifetime_metrics || {};
  const cardMetrics = Object.keys(lifetimeMetrics).length ? lifetimeMetrics : row;
  return h("div", { className: "geo-card-overlay", onClick: onClose }, [
    h("article", { className: "geo-card-modal", onClick: (event) => event.stopPropagation(), key: "card" }, [
      h("header", { className: "geo-card-head", key: "head" }, [
        h("div", { className: "geo-card-title", key: "title" }, [
          h("span", { className: "manual-badge", key: "badge" }, "GEO"),
          h("h2", { key: "geo" }, row.geo || draft.geo || "-"),
          row.recommendation_label ? h("span", { className: cx("geo-decision", row.recommendation), key: "decision" }, row.recommendation_label) : null,
        ]),
        h("button", { className: "icon-btn", type: "button", onClick: onClose, title: "Закрыть", key: "close" }, "×"),
      ]),
      h("section", { className: "geo-card-metrics", key: "metrics" }, [
        h("span", null, [h("small", null, "Расход"), h("b", null, money(cardMetrics.total_spend))]),
        h("span", null, [h("small", null, "Доход"), h("b", null, money(cardMetrics.revenue))]),
        h("span", null, [h("small", null, "Прибыль"), h("b", { className: Number(cardMetrics.profit || 0) >= 0 ? "pos" : "neg" }, money(cardMetrics.profit))]),
        h("span", null, [h("small", null, "ROI"), h("b", { className: Number(cardMetrics.roi || 0) >= 0 ? "pos" : "neg" }, percent(cardMetrics.roi))]),
        h("span", null, [h("small", null, "Депы"), h("b", null, number(cardMetrics.deposits))]),
        h("span", null, [h("small", null, "Офферы"), h("b", null, number(row.offer_count || offers.length))]),
      ]),
      row.reason ? h("p", { className: "geo-card-reason", key: "reason" }, row.reason) : null,
      h("form", { className: "geo-card-form", onSubmit: onSave, key: "form" }, [
        h("div", { className: "geo-manual-grid geo-card-grid" }, [
          h("label", null, [
            h("span", null, "GEO"),
            h("input", { value: draft.geo, readOnly: true }),
          ]),
          h("label", null, [
            h("span", null, "Статус"),
            h("select", { value: draft.status, onChange: (event) => onPatch("status", event.target.value) },
              GEO_STATUS_OPTIONS.map((value) => h("option", { value, key: value }, GEO_STATUS_RU[value]))
            ),
          ]),
          h("label", null, [
            h("span", null, "Приоритет"),
            h("select", { value: draft.priority, onChange: (event) => onPatch("priority", event.target.value) },
              TODO_PRIORITY_OPTIONS.map((value) => h("option", { value, key: value }, TODO_PRIORITY_RU[value]))
            ),
          ]),
          h("label", null, [
            h("span", null, "Ответственный"),
            h("input", { value: draft.owner, onChange: (event) => onPatch("owner", event.target.value), placeholder: "buyer / ты / Codex" }),
          ]),
          h("label", { className: "wide" }, [
            h("span", null, "Что сделать"),
            h("input", { value: draft.action, onChange: (event) => onPatch("action", event.target.value), placeholder: "следующий шаг по GEO" }),
          ]),
          h("label", null, [
            h("span", null, "Бюджет / день"),
            h("input", { type: "number", step: "0.01", value: draft.daily_budget, onChange: (event) => onPatch("daily_budget", event.target.value) }),
          ]),
          h("label", null, [
            h("span", null, "Cap"),
            h("input", { type: "number", step: "1", value: draft.cap, onChange: (event) => onPatch("cap", event.target.value) }),
          ]),
          h("label", null, [
            h("span", null, "Целевой ROI"),
            h("input", { type: "number", step: "0.01", value: draft.target_roi, onChange: (event) => onPatch("target_roi", event.target.value) }),
          ]),
          h("label", null, [
            h("span", null, "Payout"),
            h("input", { type: "number", step: "0.01", value: draft.payout, onChange: (event) => onPatch("payout", event.target.value) }),
          ]),
          h("label", null, [
            h("span", null, "Теги"),
            h("input", { value: draft.tags, onChange: (event) => onPatch("tags", event.target.value), placeholder: "scale, fb, pwa" }),
          ]),
          h("label", { className: "wide notes" }, [
            h("span", null, "Заметки"),
            h("textarea", { value: draft.notes, onChange: (event) => onPatch("notes", event.target.value), rows: 4 }),
          ]),
        ]),
        h("div", { className: "geo-card-actions" }, [
          h("button", { className: "primary", type: "submit", disabled: saving }, saving ? "Сохраняю..." : "Сохранить карточку"),
          h("button", { className: "ghost danger", type: "button", disabled: deleting, onClick: onDelete }, deleting ? "Удаляю..." : "Удалить ручные данные"),
          message ? h("span", { className: "geo-save-message" }, message) : null,
        ]),
      ]),
      h("section", { className: "geo-card-context", key: "context" }, [
        h("div", { key: "offers" }, [
          h("h4", null, "Топ офферы"),
          offers.length ? h("ul", null, offers.slice(0, 6).map((offer) => h("li", { key: `${offer.geo}-${offer.normalized_offer}` }, [
            h("b", null, offer.normalized_offer || offer.offer || "-"),
            h("span", null, `${money(offer.total_spend)} / ${money(offer.revenue)} / ROI ${percent(offer.roi)}`),
          ]))) : h(Empty, null, "Офферов пока нет."),
        ]),
        h("div", { key: "creatives" }, [
          h("h4", null, "Креативы"),
          creatives.length ? h("ul", null, creatives.slice(0, 6).map((creative) => h("li", { key: `${creative.geo}-${creative.creative}` }, [
            h("b", null, creative.creative || "-"),
            h("span", null, `${money(creative.revenue)} / ${number(creative.clicks)} кликов / ${creative.burnout_label || "без метки"}`),
          ]))) : h(Empty, null, "Креативов пока нет."),
        ]),
        h("div", { key: "work" }, [
          h("h4", null, "Тесты и задачи"),
          h("form", { className: "geo-card-task-form", onSubmit: onTaskCreate, key: "task-form" }, [
            h("label", { className: "wide", key: "title" }, [
              h("span", null, "Новая задача"),
              h("input", {
                value: taskDraft.title,
                placeholder: `GEO ${row.geo || draft.geo || ""}: следующий шаг`,
                onChange: (event) => onTaskPatch("title", event.target.value),
              }),
            ]),
            h("label", { key: "priority" }, [
              h("span", null, "Приоритет"),
              h("select", { value: taskDraft.priority, onChange: (event) => onTaskPatch("priority", event.target.value) },
                TODO_PRIORITY_OPTIONS.map((value) => h("option", { value, key: value }, TODO_PRIORITY_RU[value]))
              ),
            ]),
            h("label", { className: "wide", key: "note" }, [
              h("span", null, "Заметка"),
              h("textarea", { rows: 2, value: taskDraft.note, onChange: (event) => onTaskPatch("note", event.target.value) }),
            ]),
            h("button", { className: "primary wide", type: "submit", disabled: taskSaving || !taskDraft.title.trim(), key: "submit" },
              taskSaving ? "Создаю..." : "Добавить"
            ),
          ]),
          tests.length || todos.length ? h("ul", null, [
            ...tests.slice(0, 4).map((test) => h("li", { key: `test-${test.id}` },
              h("button", {
                className: "entity-card-link",
                type: "button",
                onClick: () => onOpenTest?.(test),
              }, [
                h("b", null, GEO_TEST_STATUS_RU[test.status] || test.status),
                h("span", null, test.title),
              ])
            )),
            ...todos.slice(0, 4).map((todo) => h("li", { key: `todo-${todo.id}` },
              h("button", {
                className: "entity-card-link",
                type: "button",
                onClick: () => onOpenTodo?.(todo),
              }, [
                h("b", null, TODO_STATUS_RU[todo.status] || todo.status),
                h("span", null, todo.title),
              ])
            )),
          ]) : h(Empty, null, "Активных тестов и задач пока нет."),
        ]),
      ]),
    ]),
  ]);
}

function GeoTestCardModal({
  row,
  draft,
  onPatch,
  onSave,
  onDelete,
  onClose,
  onOpenGeo,
  onOpenTodo,
  onCreateTodo,
  saving,
  deleting,
  message,
  creatingTodo,
}) {
  const todos = row.todos || [];
  const stats = row.todo_stats || {};
  const metrics = row.metrics || {};
  const sub5Total = Number(row.sub5_count || (row.sub5_values || []).length || (row.sub5 ? 1 : 0));
  const matchedSub5 = Number(row.matched_sub5_count || 0);
  const geo = normalizeTodoGeo(draft.geo || row.geo);

  return h("div", { className: "geo-card-overlay", onClick: onClose }, [
    h("form", { className: "geo-card-modal geo-test-card-modal", onClick: (event) => event.stopPropagation(), onSubmit: onSave, key: "card" }, [
      h("header", { className: "geo-card-head", key: "head" }, [
        h("div", { className: "geo-card-title", key: "title" }, [
          h("span", { className: "manual-badge", key: "badge" }, "Тест"),
          h("h2", { key: "title" }, draft.title || row.title || `Test ${row.id || ""}`),
          h("span", { className: "manual-badge", key: "status" }, GEO_TEST_STATUS_RU[draft.status] || draft.status),
        ]),
        h("button", { className: "icon-btn", type: "button", onClick: onClose, title: "Закрыть", key: "close" }, "×"),
      ]),
      h("section", { className: "geo-card-metrics", key: "metrics" }, [
        h("span", null, [h("small", null, "GEO"), h("b", null, geo || "-")]),
        h("span", null, [h("small", null, "Расход"), h("b", null, money(metrics.total_spend))]),
        h("span", null, [h("small", null, "Депы"), h("b", null, number(metrics.deposits))]),
        h("span", null, [h("small", null, "ROI"), h("b", { className: Number(metrics.roi || 0) >= 0 ? "pos" : "neg" }, percent(metrics.roi))]),
        h("span", null, [h("small", null, "Sub5"), h("b", null, sub5Total ? (matchedSub5 ? `${number(matchedSub5)} / ${number(sub5Total)}` : number(sub5Total)) : "-")]),
        h("span", null, [h("small", null, "Задачи"), h("b", null, `${number(row.active_todo_count || 0)} / ${number(row.todo_count || todos.length || 0)}`)]),
      ]),
      h("section", { className: "geo-test-card-body", key: "body" }, [
        h("div", { className: "geo-card-form geo-test-card-form", key: "form" }, [
          h("div", { className: "geo-manual-grid geo-card-grid" }, [
            h("label", null, [
              h("span", null, "GEO"),
              h("input", { value: draft.geo, placeholder: "CO", onChange: (event) => onPatch("geo", event.target.value.toUpperCase()) }),
            ]),
            h("label", { className: "wide" }, [
              h("span", null, "Название теста"),
              h("input", { value: draft.title, placeholder: "Lookalike 2%, broad, interest stack", onChange: (event) => onPatch("title", event.target.value) }),
            ]),
            h("label", { className: "wide" }, [
              h("span", null, "Ключ теста"),
              h("input", { value: draft.test_key, placeholder: "AR|kkid|1845man|fb-inst|1-3-1|abo", onChange: (event) => onPatch("test_key", event.target.value) }),
            ]),
            h("label", null, [
              h("span", null, "Статус"),
              h("select", { value: draft.status, onChange: (event) => onPatch("status", event.target.value) },
                GEO_TEST_STATUS_OPTIONS.map((value) => h("option", { value, key: value }, GEO_TEST_STATUS_RU[value]))
              ),
            ]),
            h("label", null, [
              h("span", null, "Старт"),
              h("input", { type: "date", value: draft.start_date, onChange: (event) => onPatch("start_date", event.target.value) }),
            ]),
            h("label", null, [
              h("span", null, "Финиш"),
              h("input", { type: "date", value: draft.end_date, onChange: (event) => onPatch("end_date", event.target.value) }),
            ]),
            h("label", null, [
              h("span", null, "План бюджет"),
              h("input", { type: "number", step: "0.01", value: draft.planned_budget, onChange: (event) => onPatch("planned_budget", event.target.value) }),
            ]),
            h("label", { className: "wide notes" }, [
              h("span", null, "Sub5 варианты"),
              h("textarea", {
                rows: 4,
                value: draft.sub5_values,
                placeholder: "0306|AR|kkid|123123|12|1845man|fb-inst|1-3-1|abo|2",
                onChange: (event) => onPatch("sub5_values", event.target.value),
              }),
            ]),
            h("label", { className: "wide" }, [
              h("span", null, "Креативы"),
              h("input", { value: draft.creatives, placeholder: "creo-1, creo-2, UGC hook", onChange: (event) => onPatch("creatives", event.target.value) }),
            ]),
            h("label", { className: "wide notes" }, [
              h("span", null, "Настройка таргета"),
              h("textarea", { rows: 3, value: draft.targeting, placeholder: "аудитория, возраст, плейсменты, оптимизация, исключения", onChange: (event) => onPatch("targeting", event.target.value) }),
            ]),
            h("label", { className: "wide notes" }, [
              h("span", null, "Гипотеза"),
              h("textarea", { rows: 3, value: draft.hypothesis, onChange: (event) => onPatch("hypothesis", event.target.value) }),
            ]),
            h("label", { className: "wide notes" }, [
              h("span", null, "Результат"),
              h("textarea", { rows: 3, value: draft.result, placeholder: "что вышло: CR, депы, качество лидов, вывод", onChange: (event) => onPatch("result", event.target.value) }),
            ]),
            h("label", { className: "wide notes" }, [
              h("span", null, "Заметки"),
              h("textarea", { rows: 3, value: draft.notes, onChange: (event) => onPatch("notes", event.target.value) }),
            ]),
          ]),
        ]),
        h("aside", { className: "geo-test-side", key: "side" }, [
          h("div", { className: "entity-link-row", key: "links" }, [
            geo && onOpenGeo ? h("button", { type: "button", className: "entity-link", onClick: () => onOpenGeo(geo), key: "geo" }, `GEO ${geo}`) : null,
            h("button", { type: "button", className: "entity-link", disabled: creatingTodo, onClick: () => onCreateTodo?.(row), key: "task" }, creatingTodo ? "Создаю..." : "Добавить задачу"),
          ]),
          h("div", { className: "geo-test-linked", key: "todos" }, [
            h("h4", null, "Связанные задачи"),
            h("div", { className: "geo-test-todos-stats", key: "stats" }, [
              h("span", { key: "open" }, `open ${number(stats.open || 0)}`),
              h("span", { key: "progress" }, `work ${number(stats.in_progress || 0)}`),
              h("span", { key: "done" }, `done ${number(stats.done || 0)}`),
              Number(stats.overdue || 0) ? h("span", { className: "bad", key: "overdue" }, `late ${number(stats.overdue || 0)}`) : null,
            ]),
            todos.length ? h("ul", { className: "entity-card-list", key: "list" }, todos.slice(0, 8).map((todo) => h("li", { key: todo.id },
              h("button", { type: "button", className: "entity-card-link", onClick: () => onOpenTodo?.(todo) }, [
                h("b", null, TODO_STATUS_RU[todo.status] || todo.status),
                h("span", null, todo.title),
              ])
            ))) : h(Empty, null, "Связанных задач пока нет."),
          ]),
        ]),
      ]),
      message ? h("span", { className: "geo-save-message", key: "message" }, message) : null,
      h("div", { className: "geo-card-actions", key: "actions" }, [
        h("button", { className: "primary", type: "submit", disabled: saving }, saving ? "Сохраняю..." : "Сохранить тест"),
        h("button", { className: "ghost danger", type: "button", disabled: deleting, onClick: () => onDelete(row) }, deleting ? "Удаляю..." : "Удалить"),
        h("button", { className: "ghost", type: "button", onClick: onClose }, "Закрыть"),
      ]),
    ]),
  ]);
}

function GeoPage({ mode = "geo", periodKey, setPeriodKey, dateFrom, setDateFrom, dateTo, setDateTo }) {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [savingGeo, setSavingGeo] = useState("");
  const [manualDraft, setManualDraft] = useState(emptyGeoDraft());
  const [manualSaving, setManualSaving] = useState(false);
  const [manualDeleting, setManualDeleting] = useState(false);
  const [manualMessage, setManualMessage] = useState("");
  const [testDraft, setTestDraft] = useState(emptyGeoTestDraft());
  const [testSaving, setTestSaving] = useState(false);
  const [testDeleting, setTestDeleting] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [creativeGeoFilter, setCreativeGeoFilter] = useState("all");
  const [creativeMode, setCreativeMode] = useState("best");
  const [offerGeoFilter, setOfferGeoFilter] = useState("all");
  const [offerTypeFilter, setOfferTypeFilter] = useState("offer");
  const [geoCard, setGeoCard] = useState(null);
  const [geoCardDraft, setGeoCardDraft] = useState(emptyGeoDraft());
  const [geoCardSaving, setGeoCardSaving] = useState(false);
  const [geoCardDeleting, setGeoCardDeleting] = useState(false);
  const [geoCardMessage, setGeoCardMessage] = useState("");
  const [geoTaskDraft, setGeoTaskDraft] = useState(emptyGeoTaskDraft());
  const [geoTaskSaving, setGeoTaskSaving] = useState(false);
  const [testCard, setTestCard] = useState(null);
  const [testCardDraft, setTestCardDraft] = useState(emptyGeoTestDraft());
  const [testCardMessage, setTestCardMessage] = useState("");
  const [todoCard, setTodoCard] = useState(null);
  const [todoCardSaving, setTodoCardSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadGeo() {
    setBusy(true);
    setError("");
    try {
      const data = await apiGet("/api/geo/overview", {
        ...periodRequestParams(periodKey, dateFrom, dateTo),
        limit: 120,
      });
      setReport(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createGeoTodo(row) {
    setSavingGeo(row.geo);
    setError("");
    try {
      const priority = ["fix_geo", "stop_or_check", "cut"].includes(row.recommendation) ? "high" : "normal";
      await apiPost("/api/todos", {
        title: `GEO ${row.geo}: ${row.recommendation_label}`,
        note: `${row.reason}. Расход ${money(row.total_spend)}, profit ${money(row.profit)}, ROI ${percent(row.roi)}, депы ${number(row.deposits)}.`,
        status: "in_progress",
        priority,
        category: "geo",
        tags: [row.geo],
        entity: row.geo,
        source: "dashboard",
        period_key: report?.period_key || periodKey,
        date_from: report?.date_from,
        date_to: report?.date_to,
        metrics: {
          geo: row.geo,
          revenue: row.revenue || 0,
          total_spend: row.total_spend || 0,
          profit: row.profit || 0,
          deposits: row.deposits || 0,
          roi: row.roi || 0,
        },
      });
      await loadGeo();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingGeo("");
    }
  }

  async function createGeoTestTodo(row) {
    setSavingGeo(`test-${row.id}`);
    setError("");
    setTestMessage("");
    try {
      await apiPost("/api/todos", {
        title: `Тест ${row.geo}: ${row.title}`,
        note: `Проверить тест ${row.test_key || row.title}: spend ${money(row.metrics?.total_spend)}, deps ${number(row.metrics?.deposits)}, ROI ${percent(row.metrics?.roi)}.`,
        status: "open",
        priority: "normal",
        category: "geo",
        tags: [row.geo, "test"],
        entity: row.geo,
        source: "dashboard",
        period_key: report?.period_key || periodKey,
        date_from: report?.date_from,
        date_to: report?.date_to,
        test_id: row.id,
        test_key: row.test_key || "",
        test_title: row.title || "",
        metrics: {
          geo: row.geo,
          test_id: row.id,
          test_key: row.test_key || "",
          test_title: row.title || "",
          revenue: row.metrics?.revenue || 0,
          total_spend: row.metrics?.total_spend || 0,
          profit: row.metrics?.profit || 0,
          deposits: row.metrics?.deposits || 0,
          roi: row.metrics?.roi || 0,
        },
      });
      setTestMessage("Задача по тесту создана.");
      await loadGeo();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingGeo("");
    }
  }

  function patchManualDraft(key, value) {
    setManualDraft((current) => ({ ...current, [key]: value }));
  }

  function editGeo(row) {
    setManualDraft(geoDraftFromRow(row));
    setManualMessage(`Открыта ручная карточка GEO ${row.geo}.`);
    setTestDraft((current) => ({ ...current, geo: row.geo || current.geo }));
    window.setTimeout(() => {
      document.getElementById("geo-manual-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.querySelector("#geo-manual-editor input")?.focus();
    }, 40);
  }

  function openGeoCard(row) {
    const fullRow = rows.find((item) => item.geo === row.geo) || row;
    setGeoCard(fullRow);
    setGeoCardDraft(geoDraftFromRow(fullRow));
    setGeoTaskDraft(emptyGeoTaskDraft());
    setGeoCardMessage("");
  }

  function closeGeoCard() {
    setGeoCard(null);
    setGeoTaskDraft(emptyGeoTaskDraft());
    setGeoCardMessage("");
  }

  function openGeoTestCard(row) {
    const fullRow = geoTests.find((item) => String(item.id) === String(row.id)) || row;
    setTestCard(fullRow);
    setTestCardDraft(geoTestDraftFromRow(fullRow));
    setTestCardMessage("");
  }

  function closeGeoTestCard() {
    setTestCard(null);
    setTestCardDraft(emptyGeoTestDraft());
    setTestCardMessage("");
  }

  function openTodoCard(todo) {
    setTodoCard(todo);
  }

  function closeTodoCard() {
    setTodoCard(null);
  }

  function patchGeoCardDraft(key, value) {
    setGeoCardDraft((current) => ({ ...current, [key]: value }));
  }

  function patchTestCardDraft(key, value) {
    setTestCardDraft((current) => ({ ...current, [key]: value }));
  }

  function patchGeoTaskDraft(key, value) {
    setGeoTaskDraft((current) => ({ ...current, [key]: value }));
  }

  async function createGeoCardTodo(event) {
    event?.preventDefault();
    const geo = normalizeTodoGeo(geoCardDraft.geo || geoCard?.geo);
    const title = geoTaskDraft.title.trim();
    if (!geo || !title) {
      setError("Для GEO-задачи нужны GEO и название.");
      return;
    }
    setGeoTaskSaving(true);
    setError("");
    setGeoCardMessage("");
    try {
      const lifetimeMetrics = selectedGeoCard?.lifetime_metrics || {};
      const todoMetrics = Object.keys(lifetimeMetrics).length ? lifetimeMetrics : (selectedGeoCard || {});
      await apiPost("/api/todos", {
        title: `GEO ${geo}: ${title}`,
        note: geoTaskDraft.note,
        status: "open",
        priority: geoTaskDraft.priority,
        category: "geo",
        tags: [geo],
        entity: geo,
        source: "dashboard",
        period_key: report?.period_key || periodKey,
        date_from: report?.date_from,
        date_to: report?.date_to,
        metrics: {
          geo,
          revenue: todoMetrics.revenue || 0,
          total_spend: todoMetrics.total_spend || 0,
          profit: todoMetrics.profit || 0,
          deposits: todoMetrics.deposits || 0,
          roi: todoMetrics.roi || 0,
        },
      });
      setGeoTaskDraft(emptyGeoTaskDraft());
      setGeoCardMessage("Задача по GEO создана.");
      await loadGeo();
    } catch (err) {
      setError(err.message);
    } finally {
      setGeoTaskSaving(false);
    }
  }

  async function saveGeoCard(event) {
    event?.preventDefault();
    const geo = geoCardDraft.geo.trim().toUpperCase();
    if (!geo) {
      setError("Укажи GEO для карточки.");
      return;
    }
    setGeoCardSaving(true);
    setError("");
    setGeoCardMessage("");
    try {
      const result = await apiPost("/api/geo/manual", { ...geoCardDraft, geo });
      setGeoCardDraft(geoDraftFromRow({ geo, manual: result.geo }));
      setGeoCardMessage("Карточка сохранена.");
      await loadGeo();
    } catch (err) {
      setError(err.message);
    } finally {
      setGeoCardSaving(false);
    }
  }

  async function deleteGeoCardManual() {
    const geo = geoCardDraft.geo.trim().toUpperCase();
    if (!geo) return;
    setGeoCardDeleting(true);
    setError("");
    setGeoCardMessage("");
    try {
      await apiPost("/api/geo/manual/delete", { geo });
      setGeoCardDraft(emptyGeoDraft(geo));
      setGeoCardMessage("Ручные данные карточки удалены.");
      await loadGeo();
    } catch (err) {
      setError(err.message);
    } finally {
      setGeoCardDeleting(false);
    }
  }

  async function saveManualGeo(event) {
    event?.preventDefault();
    const geo = manualDraft.geo.trim().toUpperCase();
    if (!geo) {
      setError("Укажи GEO, например CO, TZ или ZM.");
      return;
    }
    setManualSaving(true);
    setError("");
    setManualMessage("");
    try {
      const result = await apiPost("/api/geo/manual", { ...manualDraft, geo });
      const savedDraft = geoDraftFromRow({ geo, manual: result.geo });
      setManualDraft(emptyGeoDraft());
      setGeoCard(geoRowFromManual(result.geo));
      setGeoCardDraft(savedDraft);
      setGeoCardMessage("Карточка создана. Дальше редактируй ее здесь.");
      setManualMessage("GEO создан.");
      await loadGeo();
    } catch (err) {
      setError(err.message);
    } finally {
      setManualSaving(false);
    }
  }

  async function deleteManualGeo() {
    const geo = manualDraft.geo.trim().toUpperCase();
    if (!geo) return;
    setManualDeleting(true);
    setError("");
    setManualMessage("");
    try {
      await apiPost("/api/geo/manual/delete", { geo });
      setManualDraft(emptyGeoDraft());
      setManualMessage("Ручная карточка GEO удалена.");
      await loadGeo();
    } catch (err) {
      setError(err.message);
    } finally {
      setManualDeleting(false);
    }
  }

  function patchTestDraft(key, value) {
    setTestDraft((current) => ({ ...current, [key]: value }));
  }

  function editGeoTest(row) {
    openGeoTestCard(row);
  }

  async function saveGeoTestDraft(draft) {
    const geo = draft.geo.trim().toUpperCase();
    if (!geo || !draft.title.trim()) {
      setError("Для теста нужны GEO и короткое название запуска.");
      return null;
    }
    const sub5Values = parseMultilineList(draft.sub5_values);
    const payload = {
      ...draft,
      geo,
      sub5: sub5Values[0] || draft.sub5,
      sub5_values: sub5Values,
    };
    if (!payload.id) delete payload.id;
    const result = await apiPost("/api/geo/tests", payload);
    return result.test;
  }

  async function saveGeoTest(event) {
    event?.preventDefault();
    setTestSaving(true);
    setError("");
    setTestMessage("");
    try {
      const savedTest = await saveGeoTestDraft(testDraft);
      if (!savedTest) return;
      setTestDraft(emptyGeoTestDraft(savedTest.geo));
      setTestMessage("Тест создан.");
      setTestCard(savedTest);
      setTestCardDraft(geoTestDraftFromRow(savedTest));
      setTestCardMessage("Тест создан. Дальше редактируй карточку.");
      await loadGeo();
    } catch (err) {
      setError(err.message);
    } finally {
      setTestSaving(false);
    }
  }

  async function saveGeoTestCard(event) {
    event?.preventDefault();
    setTestSaving(true);
    setError("");
    setTestCardMessage("");
    try {
      const savedTest = await saveGeoTestDraft(testCardDraft);
      if (!savedTest) return;
      setTestCard(savedTest);
      setTestCardDraft(geoTestDraftFromRow(savedTest));
      setTestCardMessage("Карточка теста сохранена.");
      await loadGeo();
    } catch (err) {
      setError(err.message);
    } finally {
      setTestSaving(false);
    }
  }

  async function deleteGeoTest(row) {
    setTestDeleting(row.id);
    setError("");
    setTestMessage("");
    try {
      await apiPost("/api/geo/tests/delete", { id: row.id });
      if (String(testDraft.id) === String(row.id)) {
        setTestDraft(emptyGeoTestDraft(row.geo));
      }
      if (String(testCard?.id) === String(row.id)) {
        closeGeoTestCard();
      }
      setTestMessage("Тест удален.");
      await loadGeo();
    } catch (err) {
      setError(err.message);
    } finally {
      setTestDeleting("");
    }
  }

  async function updateTodoCard(todo, patch) {
    setTodoCardSaving(true);
    setError("");
    try {
      const result = await apiPost("/api/todos/update", { id: todo.id, ...patch });
      setTodoCard(result.todo);
      await loadGeo();
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setTodoCardSaving(false);
    }
  }

  async function archiveTodoCard() {
    if (!todoCard) return;
    await updateTodoCard(todoCard, { status: "archived" });
    closeTodoCard();
  }

  async function deleteTodoCard() {
    if (!todoCard) return;
    setTodoCardSaving(true);
    setError("");
    try {
      await apiPost("/api/todos/delete", { id: todoCard.id });
      closeTodoCard();
      await loadGeo();
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setTodoCardSaving(false);
    }
  }

  useEffect(() => {
    loadGeo();
  }, [periodKey, dateFrom, dateTo]);

  const kpis = report?.kpis || {};
  const rows = report?.rows || [];
  const history = report?.history || [];
  const activeGeos = report?.active_geos || [];
  const geoTests = report?.geo_tests || [];
  const creativeRows = report?.creatives || [];
  const offerRows = report?.offer_breakdown || [];
  const sub5Rows = report?.sub5_breakdown || [];
  const currentOfferRows = offerTypeFilter === "sub5" ? sub5Rows : offerRows;
  const offerPanelTitle = offerTypeFilter === "sub5" ? "Sub5 внутри GEO" : "Офферы внутри GEO";
  const offerNameColumnLabel = offerTypeFilter === "sub5" ? "Sub5" : "Оффер / кампания";
  const selectedGeoCard = geoCard
    ? rows.find((row) => row.geo === (geoCardDraft.geo || geoCard.geo)) ||
      activeGeos.find((row) => row.geo === (geoCardDraft.geo || geoCard.geo)) ||
      geoCard
    : null;
  const selectedTestCard = testCard
    ? geoTests.find((test) => String(test.id) === String(testCard.id || testCardDraft.id)) || testCard
    : null;
  const manualCount = rows.filter(hasManualGeo).length;
  const offerGeos = useMemo(() => Array.from(new Set(
    currentOfferRows.map((row) => row.geo).filter((geo) => geo && geo !== "UNKNOWN")
  )).sort(), [currentOfferRows]);
  const visibleOfferRows = useMemo(() => {
    let nextRows = currentOfferRows.filter((row) => row.normalized_offer || row.offer);
    if (offerGeoFilter !== "all") {
      nextRows = nextRows.filter((row) => row.geo === offerGeoFilter);
    }
    nextRows.sort((a, b) => (
      Math.max(numericValue(b.total_spend), numericValue(b.revenue)) -
      Math.max(numericValue(a.total_spend), numericValue(a.revenue)) ||
      numericValue(b.profit) - numericValue(a.profit)
    ));
    return nextRows.slice(0, 80);
  }, [currentOfferRows, offerGeoFilter]);
  const creativeGeos = useMemo(() => Array.from(new Set(
    creativeRows.map((row) => row.geo).filter((geo) => geo && geo !== "UNKNOWN")
  )).sort(), [creativeRows]);
  const visibleCreatives = useMemo(() => {
    let nextRows = creativeRows.filter((row) => row.creative);
    if (creativeGeoFilter !== "all") {
      nextRows = nextRows.filter((row) => row.geo === creativeGeoFilter);
    }
    if (creativeMode === "burnout") {
      nextRows = nextRows.filter((row) => Number(row.burnout_score || 0) > 0);
      nextRows.sort((a, b) => (
        numericValue(b.burnout_score) - numericValue(a.burnout_score) ||
        numericValue(b.clicks) - numericValue(a.clicks)
      ));
    } else if (creativeMode === "all") {
      nextRows.sort((a, b) => (
        numericValue(b.clicks) - numericValue(a.clicks) ||
        numericValue(b.revenue) - numericValue(a.revenue)
      ));
    } else {
      nextRows.sort((a, b) => (
        numericValue(b.performance_score) - numericValue(a.performance_score) ||
        numericValue(b.profit) - numericValue(a.profit) ||
        numericValue(b.revenue) - numericValue(a.revenue) ||
        numericValue(b.clicks) - numericValue(a.clicks)
      ));
    }
    return nextRows.slice(0, 18);
  }, [creativeRows, creativeGeoFilter, creativeMode]);
  const isGeoMode = mode === "geo";
  const isTestsMode = mode === "tests";
  const isCreativesMode = mode === "creatives";
  const pageTitle = isTestsMode ? "Тесты запусков" : isCreativesMode ? "Креативы" : "GEO обзор";
  const pageEyebrow = isTestsMode ? "таргет, гипотеза, результат" : isCreativesMode ? "выгорание и лучшие связки" : "авто-финансы + ручной план";

  return h("div", { className: "geo-page" }, [
    h(Panel, {
      title: pageTitle,
      eyebrow: pageEyebrow,
      right: h("button", { onClick: loadGeo, disabled: busy }, busy ? "Обновляю..." : "Обновить"),
      key: "head",
    }, [
      h("div", { className: "geo-controls", key: "controls" }, [
        ...PeriodControl({
          periodKey,
          setPeriodKey,
          dateFrom,
          setDateFrom,
          dateTo,
          setDateTo,
          keyPrefix: `${mode}-period`,
        }),
        report ? h(Pill, null, `${report.date_from} - ${report.date_to}`) : null,
        report ? h(Pill, null, `${number(rows.length)} GEO`) : null,
        report ? h(Pill, null, `${number(manualCount)} заполнено вручную`) : null,
      ]),
      error ? h("div", { className: "error compact-error", key: "error" }, error) : null,
    ]),
    h("section", { className: "grid kpi-grid geo-kpi-grid", key: "kpis" }, [
      h(KpiCard, { label: "Расход", value: money(kpis.total_spend), helper: "по GEO", loading: busy && !report, key: "spend" }),
      h(KpiCard, { label: "Доход", value: money(kpis.revenue), helper: "по GEO", loading: busy && !report, key: "revenue" }),
      h(KpiCard, { label: "Прибыль", value: money(kpis.profit), helper: "доход - расход", tone: Number(kpis.profit || 0) >= 0 ? "good" : "bad", loading: busy && !report, key: "profit" }),
      h(KpiCard, { label: "ROI", value: percent(kpis.roi), helper: "profit / spend", tone: Number(kpis.roi || 0) >= 0.2 ? "good" : "warn", loading: busy && !report, key: "roi" }),
      h(KpiCard, { label: "Депы", value: number(kpis.deposits), helper: "по расходам", loading: busy && !report, key: "deps" }),
      h(KpiCard, { label: "В работе", value: number(activeGeos.length), helper: "GEO-задачи", tone: activeGeos.length ? "warn" : "good", loading: busy && !report, key: "active" }),
    ]),
    isGeoMode ? h(Panel, { title: offerPanelTitle, eyebrow: "разбивка по расходу, доходу и депам", className: "geo-offers-panel", key: "geo-offers" }, [
      h("div", { className: "geo-offer-toolbar", key: "offer-toolbar" }, [
        h("label", null, [
          h("span", null, "GEO"),
          h("select", { value: offerGeoFilter, onChange: (event) => setOfferGeoFilter(event.target.value) }, [
            h("option", { value: "all", key: "all" }, "Все GEO"),
            ...offerGeos.map((geo) => h("option", { value: geo, key: geo }, geo)),
          ]),
        ]),
        h("div", { className: "geo-offer-mode-tabs", role: "tablist" }, [
          ["offer", "Офферы"],
          ["sub5", "Sub5"],
        ].map(([value, label]) => h("button", {
          className: cx(offerTypeFilter === value && "active"),
          key: value,
          onClick: () => {
            setOfferTypeFilter(value);
            setOfferGeoFilter("all");
          },
          type: "button",
        }, label))),
        h("div", { className: "geo-offer-summary" }, [
          h(Pill, null, `${number(offerRows.length)} офферов`),
          h(Pill, null, `${number(sub5Rows.length)} sub5`),
          h(Pill, null, `${number(visibleOfferRows.length)} в таблице`),
        ]),
      ]),
      h(SimpleTable, {
        rows: visibleOfferRows,
        columns: [
          { key: "geo", label: "GEO" },
          { key: "normalized_offer", label: offerNameColumnLabel, format: (value) => h("span", { className: "geo-offer-name", title: value || "-" }, value || "-") },
          { key: "total_spend", label: "Расход", numeric: true, format: money },
          { key: "revenue", label: "Доход", numeric: true, format: money },
          { key: "profit", label: "Прибыль", numeric: true, format: (value) => signedCell(value, money) },
          { key: "roi", label: "ROI", numeric: true, format: (value) => signedCell(value, percent) },
          { key: "deposits", label: "Депы", numeric: true, format: number },
          { key: "cpa", label: "CPA", numeric: true, format: money },
          { key: "rpd", label: "RPD", numeric: true, format: money },
          { key: "decision", label: "Решение", format: (value) => h("span", { className: cx("decision", value) }, DECISION_RU[value] || value || "-") },
          { key: "reason", label: "Почему", format: (_, row) => decisionExplain({
            reason: row.reason,
            metrics: row.metrics || {
              spend: row.total_spend,
              revenue: row.revenue,
              profit: row.profit,
              roi: row.roi,
              deposits: row.deposits,
              payout: row.rpd,
              bot_share: 0,
            },
          }) },
        ],
      }),
    ]) : null,
    (isGeoMode || isTestsMode) ? h("section", { className: "geo-create-grid", key: "create" }, [
      isGeoMode ? h(Panel, { id: "geo-manual-editor", title: "Новый GEO", eyebrow: "быстрая карточка", className: "geo-create-panel" }, [
        h("form", { className: "geo-quick-form", onSubmit: saveManualGeo, key: "manual-form" }, [
          h("label", null, [
            h("span", null, "GEO"),
            h("input", {
              value: manualDraft.geo,
              placeholder: "CO",
              onChange: (event) => patchManualDraft("geo", event.target.value.toUpperCase()),
            }),
          ]),
          h("label", null, [
            h("span", null, "Статус"),
            h("select", { value: manualDraft.status, onChange: (event) => patchManualDraft("status", event.target.value) },
              GEO_STATUS_OPTIONS.map((value) => h("option", { value, key: value }, GEO_STATUS_RU[value]))
            ),
          ]),
          h("label", null, [
            h("span", null, "Ответственный"),
            h("input", { value: manualDraft.owner, onChange: (event) => patchManualDraft("owner", event.target.value), placeholder: "buyer / ты / Codex" }),
          ]),
          h("button", { className: "primary", type: "submit", disabled: manualSaving }, manualSaving ? "Создаю..." : "Создать"),
          manualMessage ? h("span", { className: "geo-save-message" }, manualMessage) : null,
        ]),
      ]) : null,
      (isGeoMode || isTestsMode) ? h(Panel, { title: "Новый тест", eyebrow: "создать и открыть карточку", className: "geo-create-panel" }, [
        h("form", { className: "geo-quick-form geo-test-quick-form", onSubmit: saveGeoTest, key: "test-form" }, [
          h("label", null, [
            h("span", null, "GEO"),
            h("input", { value: testDraft.geo, placeholder: "CO", onChange: (event) => patchTestDraft("geo", event.target.value.toUpperCase()) }),
          ]),
          h("label", { className: "wide" }, [
            h("span", null, "Название теста"),
            h("input", { value: testDraft.title, placeholder: "Lookalike 2%, broad, interest stack", onChange: (event) => patchTestDraft("title", event.target.value) }),
          ]),
          h("label", { className: "wide" }, [
            h("span", null, "Ключ теста"),
            h("input", { value: testDraft.test_key, placeholder: "AR|kkid|1845man|fb-inst|1-3-1|abo", onChange: (event) => patchTestDraft("test_key", event.target.value) }),
          ]),
          h("label", null, [
            h("span", null, "Статус"),
            h("select", { value: testDraft.status, onChange: (event) => patchTestDraft("status", event.target.value) },
              GEO_TEST_STATUS_OPTIONS.map((value) => h("option", { value, key: value }, GEO_TEST_STATUS_RU[value]))
            ),
          ]),
          h("button", { className: "primary", type: "submit", disabled: testSaving }, testSaving ? "Создаю..." : "Создать тест"),
          testMessage ? h("span", { className: "geo-save-message" }, testMessage) : null,
        ]),
      ]) : null,
    ]) : null,
    (isTestsMode || isCreativesMode) ? h("section", { className: "geo-wide-grid", key: "tests-creatives" }, [
      isTestsMode ? h(Panel, { title: "Тесты запусков", eyebrow: "таргет, гипотеза, результат", className: "geo-tests-panel" }, [
        h(SimpleTable, {
          rows: geoTests,
          columns: [
            { key: "geo", label: "GEO", format: (value, row) => h("button", { className: "entity-inline-link", type: "button", onClick: () => openGeoCard(row) }, value || "-") },
            { key: "title", label: "Тест", format: (value, row) => h("button", { className: "entity-inline-link", type: "button", onClick: () => openGeoTestCard(row) }, value || `Test ${row.id}`) },
            { key: "test_key", label: "Ключ", format: (value) => value || "-" },
            { key: "status", label: "Статус", format: (value) => h("span", { className: "manual-badge" }, GEO_TEST_STATUS_RU[value] || value) },
            { key: "start_date", label: "Старт" },
            { key: "sub5_count", label: "Sub5", numeric: true, format: (_, row) => {
              const total = Number(row.sub5_count || (row.sub5_values || []).length || (row.sub5 ? 1 : 0));
              const matched = Number(row.matched_sub5_count || 0);
              return total ? (matched ? `${number(matched)} / ${number(total)}` : number(total)) : "-";
            } },
            { key: "total_spend", label: "Расход", numeric: true, format: (_, row) => money(row.metrics?.total_spend) },
            { key: "deposits", label: "Депы", numeric: true, format: (_, row) => number(row.metrics?.deposits) },
            { key: "roi", label: "ROI", numeric: true, format: (_, row) => percent(row.metrics?.roi) },
            { key: "todos", label: "Задачи", format: (_, row) => h(GeoTestTodosCell, { row, onOpenTodo: openTodoCard }) },
            { key: "targeting", label: "Таргет", format: (value) => value || "-" },
            { key: "creatives", label: "Креативы", format: (value) => Array.isArray(value) && value.length ? value.join(", ") : "-" },
            { key: "result", label: "Результат", format: (value) => value || "-" },
            { key: "task", label: "", format: (_, row) => h("button", { className: "ghost", disabled: savingGeo === `test-${row.id}`, onClick: () => createGeoTestTodo(row) }, savingGeo === `test-${row.id}` ? "Создаю..." : "Задача") },
            { key: "edit", label: "Правка", format: (_, row) => h("button", { className: "ghost", onClick: () => editGeoTest(row) }, "Открыть") },
            { key: "delete", label: "", format: (_, row) => h("button", { className: "ghost danger", disabled: testDeleting === row.id, onClick: () => deleteGeoTest(row) }, testDeleting === row.id ? "Удаляю..." : "Удалить") },
          ],
        }),
      ]) : null,
      isCreativesMode ? h(Panel, { title: "Креативы и выгорание", eyebrow: "скан по GEO" }, [
        h("div", { className: "creative-toolbar", key: "creative-toolbar" }, [
          h("label", null, [
            h("span", null, "GEO"),
            h("select", { value: creativeGeoFilter, onChange: (event) => setCreativeGeoFilter(event.target.value) }, [
              h("option", { value: "all", key: "all" }, "Все GEO"),
              ...creativeGeos.map((geo) => h("option", { value: geo, key: geo }, geo)),
            ]),
          ]),
          h("div", { className: "creative-mode-tabs" },
            [
              ["best", "Лучшие"],
              ["burnout", "Выгорают"],
              ["all", "Все"],
            ].map(([value, label]) => h("button", {
              className: cx(creativeMode === value && "active"),
              key: value,
              onClick: () => setCreativeMode(value),
              type: "button",
            }, label))
          ),
        ]),
        visibleCreatives.length ? h("div", { className: "creative-list", key: "creative-list" },
          visibleCreatives.map((row) => {
            const badge = creativeBadge(row, creativeMode);
            return h("div", { className: "creative-row", key: `${row.geo}-${row.creative}` }, [
            h("div", { className: "creative-row-head" }, [
              h("div", { className: "creative-title" }, [
                h("span", { className: "manual-badge" }, row.geo || "UNKNOWN"),
                h("strong", null, row.creative || "-"),
              ]),
              h("span", {
                className: cx("burnout-badge", badge.tone),
              }, `${number(badge.score)} · ${badge.label}`),
            ]),
            h("div", { className: "creative-metrics" }, [
              h("span", null, [h("b", null, money(row.revenue)), h("small", null, "Доход")]),
              h("span", null, [h("b", null, money(row.total_spend)), h("small", null, "Расход")]),
              h("span", null, [h("b", { className: Number(row.profit || 0) >= 0 ? "pos" : "neg" }, money(row.profit)), h("small", null, "Profit")]),
              h("span", null, [h("b", null, number(row.clicks)), h("small", null, "Клики")]),
              h("span", null, [h("b", null, percent(row.cr)), h("small", null, "CR")]),
              h("span", null, [h("b", null, money(row.epc)), h("small", null, "EPC")]),
            ]),
            badge.reason ? h("p", { className: "creative-reason" }, badge.reason) : null,
          ]);
          })
        ) : h(Empty, { key: "creative-empty" }, "По выбранному фильтру креативов пока нет."),
      ]) : null,
    ]) : null,
    isGeoMode ? h("section", { className: "geo-grid", key: "grid" }, [
      h(Panel, { title: "GEO в работе", eyebrow: "активные задачи" },
        activeGeos.length ? h("div", { className: "geo-work-list" },
          activeGeos.map((item) => h("div", {
            className: "geo-work-item",
            key: item.geo,
            role: "button",
            tabIndex: 0,
            onClick: () => openGeoCard(item),
            onKeyDown: (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openGeoCard(item);
              }
            },
          }, [
            h("div", { className: "geo-work-title" }, [
              h("b", null, item.geo),
              item.manual_status ? h("span", { className: "manual-badge" }, GEO_STATUS_RU[item.manual_status] || item.manual_status) : null,
            ]),
            item.manual_owner ? h("span", null, `Ответственный: ${item.manual_owner}`) : null,
            item.manual_action ? h("p", null, item.manual_action) : null,
            h("span", null, `${number(item.todo_count)} задач · ${number(item.test_count)} тестов`),
            item.todos.length ? h("ul", null, item.todos.map((todo) => h("li", { key: todo.id }, todo.title))) : null,
            item.tests?.length ? h("ul", null, item.tests.map((test) => h("li", { key: `test-${test.id}` }, `${GEO_TEST_STATUS_RU[test.status] || test.status}: ${test.title}`))) : null,
          ]))
        ) : h(Empty, null, "GEO-задач в работе пока нет.")
      ),
      h(Panel, { title: "Что сделать по GEO", eyebrow: "текущий срез" },
        h(SimpleTable, {
          rows,
          columns: [
            { key: "geo", label: "GEO" },
            { key: "recommendation_label", label: "Действие", format: (value, row) => h("span", { className: cx("geo-decision", row.recommendation) }, value) },
            { key: "total_spend", label: "Расход", numeric: true, format: money },
            { key: "revenue", label: "Доход", numeric: true, format: money },
            { key: "profit", label: "Прибыль", numeric: true, format: (value) => signedCell(value, money) },
            { key: "roi", label: "ROI", numeric: true, format: (value) => signedCell(value, percent) },
            { key: "deposits", label: "Депы", numeric: true, format: number },
            { key: "manual_status", label: "Статус", format: (value) => value ? h("span", { className: "manual-badge" }, GEO_STATUS_RU[value] || value) : "-" },
            { key: "manual_owner", label: "Кто", format: (value) => value || "-" },
            { key: "manual_action", label: "План", format: (value) => value || "-" },
            { key: "todo_count", label: "В работе", numeric: true, format: number },
            { key: "reason", label: "Почему" },
            { key: "manual_edit", label: "Карточка", format: (_, row) => h("button", { className: "ghost", onClick: () => openGeoCard(row) }, "Открыть") },
            { key: "action", label: "Задача", format: (_, row) => h("button", {
              disabled: savingGeo === row.geo,
              onClick: () => createGeoTodo(row),
            }, savingGeo === row.geo ? "Сохраняю..." : "В работу") },
          ],
        })
      ),
    ]) : null,
    isGeoMode ? h(Panel, { title: "История по дням", eyebrow: "динамика GEO", key: "history" },
      h(SimpleTable, {
        rows: history,
        columns: [
          { key: "date", label: "Дата" },
          { key: "geo", label: "GEO" },
          { key: "total_spend", label: "Расход", numeric: true, format: money },
          { key: "revenue", label: "Доход", numeric: true, format: money },
          { key: "profit", label: "Прибыль", numeric: true, format: (value) => signedCell(value, money) },
          { key: "roi", label: "ROI", numeric: true, format: (value) => signedCell(value, percent) },
          { key: "deposits", label: "Депы", numeric: true, format: number },
        ],
      })
    ) : null,
    selectedGeoCard ? h(GeoCardModal, {
      row: selectedGeoCard,
      draft: geoCardDraft,
      onPatch: patchGeoCardDraft,
      onSave: saveGeoCard,
      onDelete: deleteGeoCardManual,
      onClose: closeGeoCard,
      saving: geoCardSaving,
      deleting: geoCardDeleting,
      message: geoCardMessage,
      taskDraft: geoTaskDraft,
      onTaskPatch: patchGeoTaskDraft,
      onTaskCreate: createGeoCardTodo,
      taskSaving: geoTaskSaving,
      onOpenTest: (test) => {
        closeGeoCard();
        openGeoTestCard(test);
      },
      onOpenTodo: (todo) => {
        closeGeoCard();
        openTodoCard(todo);
      },
      key: "geo-card-modal",
    }) : null,
    selectedTestCard ? h(GeoTestCardModal, {
      row: selectedTestCard,
      draft: testCardDraft,
      onPatch: patchTestCardDraft,
      onSave: saveGeoTestCard,
      onDelete: deleteGeoTest,
      onClose: closeGeoTestCard,
      onOpenGeo: (geo) => {
        closeGeoTestCard();
        openGeoCard({ geo });
      },
      onOpenTodo: (todo) => {
        closeGeoTestCard();
        openTodoCard(todo);
      },
      onCreateTodo: createGeoTestTodo,
      saving: testSaving,
      deleting: testDeleting === selectedTestCard.id,
      message: testCardMessage,
      creatingTodo: savingGeo === `test-${selectedTestCard.id}`,
      key: "geo-test-card-modal",
    }) : null,
    todoCard ? h(TodoCardEditor, {
      todo: todoCard,
      geoTests,
      saving: todoCardSaving,
      onSave: updateTodoCard,
      onArchive: archiveTodoCard,
      onDelete: deleteTodoCard,
      onClose: closeTodoCard,
      onOpenGeo: (geo) => {
        closeTodoCard();
        openGeoCard({ geo });
      },
      onOpenTest: (test) => {
        closeTodoCard();
        openGeoTestCard(test);
      },
      key: "geo-todo-card-modal",
    }) : null,
  ]);
}

function roiDraftFromRow(row = {}) {
  return {
    offer: row.offer || "",
    deposits: row.deposits ?? 0,
    revenue: row.revenue ?? 0,
    acc_spend: row.acc_spend ?? 0,
    pwa_spend: row.pwa_spend ?? 0,
    notes: row.notes || "",
  };
}

const ROI_METRIC_FIELDS = ["deposits", "revenue", "acc_spend", "pwa_spend"];

function roiMetricNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function roiMetricChanged(value, autoValue) {
  return Math.abs(roiMetricNumber(value) - roiMetricNumber(autoValue)) > 0.0001;
}

function roiManualPayload(row, draft) {
  const payload = {
    offer: draft.offer,
    notes: draft.notes,
  };
  ROI_METRIC_FIELDS.forEach((field) => {
    const autoField = `auto_${field}`;
    if (row.is_manual || row[autoField] === undefined || roiMetricChanged(draft[field], row[autoField])) {
      payload[field] = draft[field];
    }
  });
  return payload;
}

function roiDraftCommission(row, draft) {
  const percent = Number(row.agency_commission_percent || 0);
  return percent > 0 ? Number(draft.acc_spend || 0) * percent / 100 : 0;
}

function roiDraftTotalSpend(row, draft) {
  return Number(draft.acc_spend || 0) + Number(draft.pwa_spend || 0) + roiDraftCommission(row, draft);
}

function roiDraftProfit(row, draft) {
  return Number(draft.revenue || 0) - roiDraftTotalSpend(row, draft);
}

function roiDraftRoi(row, draft) {
  const spend = roiDraftTotalSpend(row, draft);
  return spend ? roiDraftProfit(row, draft) / spend : 0;
}

function RoiEditableTable({ rows, drafts, onPatch, onSave, onReset, savingKey, deletingKey }) {
  if (!rows.length) return h(Empty, null, "Строк пока нет.");
  const metricFields = [
    ["deposits", "Депы", "1"],
    ["revenue", "Приход", "0.01"],
    ["acc_spend", "Расход ACC", "0.01"],
    ["pwa_spend", "Расход PWA", "0.01"],
  ];
  return h("div", { className: "table-wrap roi-table-wrap" },
    h("table", { className: "roi-table" }, [
      h("thead", { key: "thead" }, h("tr", null, [
        h("th", { key: "offer" }, "Оффер / GEO / ПП"),
        ...metricFields.map(([, label]) => h("th", { className: "num", key: label }, label)),
        h("th", { className: "num", key: "total" }, "Итого"),
        h("th", { className: "num", key: "profit" }, "Профит"),
        h("th", { className: "num", key: "roi" }, "ROI"),
        h("th", { key: "source" }, "Источник"),
        h("th", { key: "notes" }, "Заметка"),
        h("th", { key: "actions" }, ""),
    ])),
      h("tbody", { key: "tbody" }, rows.map((row) => {
        const draft = drafts[row.row_key] || roiDraftFromRow(row);
        const isSystem = Boolean(row.is_system);
        return h("tr", { className: cx(row.is_manual && "manual-row", row.is_edited && "edited-row", isSystem && "system-row"), key: row.row_key }, [
          h("td", { key: "offer" }, h("input", {
            className: "roi-offer-input",
            value: draft.offer,
            disabled: isSystem,
            onChange: (event) => onPatch(row, "offer", event.target.value),
          })),
          ...metricFields.map(([field,, step]) => h("td", { className: "num", key: field }, h("input", {
            className: "roi-num-input",
            type: "number",
            step,
            value: draft[field],
            disabled: isSystem,
            onChange: (event) => onPatch(row, field, event.target.value),
          }))),
          h("td", { className: "num", key: "total" }, money(roiDraftTotalSpend(row, draft))),
          h("td", { className: "num", key: "profit" }, signedCell(roiDraftProfit(row, draft), money)),
          h("td", { className: "num", key: "roi" }, signedCell(roiDraftRoi(row, draft), percent)),
          h("td", { key: "source" }, h(Pill, { tone: isSystem ? "warn" : row.is_manual ? "warn" : row.is_edited ? "good" : null }, isSystem ? "system" : row.is_manual ? "manual" : row.is_edited ? "edited" : row.source)),
          h("td", { key: "notes" }, h("input", {
            className: "roi-note-input",
            value: draft.notes,
            disabled: isSystem,
            onChange: (event) => onPatch(row, "notes", event.target.value),
          })),
          h("td", { className: "roi-row-actions", key: "actions" }, isSystem ? [
            h(Pill, { tone: "warn", key: "locked" }, "%")
          ] : [
            h("button", {
              className: "primary",
              disabled: savingKey === row.row_key,
              onClick: () => onSave(row),
              key: "save",
            }, savingKey === row.row_key ? "..." : "OK"),
            h("button", {
              className: row.is_manual ? "danger" : "ghost",
              disabled: deletingKey === row.row_key,
              onClick: () => onReset(row),
              key: "reset",
            }, row.is_manual ? "Удалить" : "Сброс"),
          ]),
        ]);
      })),
    ])
  );
}

function RoiUnmappedSub5Table({ rows, drafts, onPatch, onAssign, savingKey }) {
  if (!rows.length) return null;
  return h("div", { className: "table-wrap roi-sub5-wrap" },
    h("table", { className: "roi-sub5-table" }, [
      h("thead", { key: "thead" }, h("tr", null, [
        h("th", { key: "sub5" }, "sub5"),
        h("th", { key: "meta" }, "GEO / buyer / acc"),
        h("th", { className: "num", key: "acc" }, "Расход ACC"),
        h("th", { className: "num", key: "pwa" }, "Расход PWA"),
        h("th", { className: "num", key: "total" }, "Итого"),
        h("th", { key: "offer" }, "Назначить offer"),
        h("th", { key: "actions" }, ""),
      ])),
      h("tbody", { key: "tbody" }, rows.map((row) => {
        const draft = drafts[row.row_key] || "";
        const meta = [row.geo, row.buyer, row.account_id].filter(Boolean).join(" / ") || "-";
        return h("tr", { key: row.row_key }, [
          h("td", { key: "sub5" }, h("code", null, row.sub5 || row.offer)),
          h("td", { key: "meta" }, meta),
          h("td", { className: "num", key: "acc" }, money(row.acc_spend)),
          h("td", { className: "num", key: "pwa" }, money(row.pwa_spend)),
          h("td", { className: "num", key: "total" }, money(row.total_spend)),
          h("td", { key: "offer" }, h("input", {
            className: "roi-offer-input",
            value: draft,
            placeholder: "ZM | 22BET | 22BET AFRICA",
            onChange: (event) => onPatch(row, event.target.value),
          })),
          h("td", { className: "roi-row-actions", key: "actions" }, h("button", {
            className: "primary",
            disabled: savingKey === row.row_key || !String(draft || "").trim(),
            onClick: () => onAssign(row),
          }, savingKey === row.row_key ? "..." : "OK")),
        ]);
      })),
    ])
  );
}

function RoiPage() {
  const [periodKey, setPeriodKey] = useState(CUSTOM_PERIOD_KEY);
  const [dateFrom, setDateFrom] = useState(daysAgoYmd(6));
  const [dateTo, setDateTo] = useState(todayYmd());
  const [limit, setLimit] = useState(500);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("profit");
  const [sortOrder, setSortOrder] = useState("desc");
  const [table, setTable] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [sub5Drafts, setSub5Drafts] = useState({});
  const [newRow, setNewRow] = useState(() => roiDraftFromRow());
  const [agencyCommissionPercent, setAgencyCommissionPercent] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingKey, setSavingKey] = useState(null);
  const [savingSub5Key, setSavingSub5Key] = useState(null);
  const [deletingKey, setDeletingKey] = useState(null);
  const [error, setError] = useState("");

  function requestParams() {
    const params = {
      limit,
      q: query,
      sort_by: sortKey,
      sort_order: sortOrder.toUpperCase(),
    };
    if (agencyCommissionPercent !== "") {
      params.agency_commission_percent = agencyCommissionPercent;
    }
    Object.assign(params, periodRequestParams(periodKey, dateFrom, dateTo, "roi_custom"));
    return params;
  }

  async function loadTable(event) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await apiGet("/api/roi-table", requestParams());
      setTable(data);
      const nextDrafts = {};
      (data.rows || []).forEach((row) => { nextDrafts[row.row_key] = roiDraftFromRow(row); });
      setDrafts(nextDrafts);
      setSub5Drafts((current) => {
        const nextSub5Drafts = {};
        (data.unmapped_sub5_rows || []).forEach((row) => {
          nextSub5Drafts[row.row_key] = current[row.row_key] || "";
        });
        return nextSub5Drafts;
      });
      if (data.agency_commission_percent !== undefined) {
        setAgencyCommissionPercent(String(data.agency_commission_percent || ""));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshKeitaro() {
    setRefreshing(true);
    setError("");
    try {
      const payload = {
        reports: ["offer", "tracking_quality", "deposits"],
        ...refreshPeriodPayload(periodKey, dateFrom, dateTo, "roi_custom"),
      };
      await apiPost("/api/refresh", payload);
      await loadTable();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  function patchDraft(row, field, value) {
    setDrafts((current) => ({
      ...current,
      [row.row_key]: {
        ...roiDraftFromRow(row),
        ...(current[row.row_key] || {}),
        [field]: value,
      },
    }));
  }

  async function saveRow(row) {
    const draft = drafts[row.row_key] || roiDraftFromRow(row);
    setSavingKey(row.row_key);
    setError("");
    try {
      await apiPost("/api/roi/manual", {
        ...requestParams(),
        row_key: row.row_key,
        is_manual: row.is_manual,
        ...roiManualPayload(row, draft),
      });
      await loadTable();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingKey(null);
    }
  }

  async function resetRow(row) {
    setDeletingKey(row.row_key);
    setError("");
    try {
      await apiPost("/api/roi/manual/delete", {
        ...requestParams(),
        row_key: row.row_key,
      });
      await loadTable();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingKey(null);
    }
  }

  async function saveCommission(event) {
    event.preventDefault();
    setSavingKey("commission");
    setError("");
    try {
      const saved = await apiPost("/api/roi/settings", {
        agency_commission_percent: agencyCommissionPercent,
      });
      setAgencyCommissionPercent(String(saved.agency_commission_percent || ""));
      await loadTable();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingKey(null);
    }
  }

  function patchSub5Draft(row, value) {
    setSub5Drafts((current) => ({ ...current, [row.row_key]: value }));
  }

  async function assignSub5(row) {
    const offer = sub5Drafts[row.row_key];
    if (!String(offer || "").trim()) return;
    setSavingSub5Key(row.row_key);
    setError("");
    try {
      await apiPost("/api/roi/sub5-map", {
        sub5: row.sub5 || row.offer,
        offer,
        notes: `ROI ${table?.date_from || dateFrom} - ${table?.date_to || dateTo}`,
      });
      await loadTable();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSub5Key(null);
    }
  }

  async function saveNewRow(event) {
    event.preventDefault();
    if (!String(newRow.offer || "").trim()) {
      setError("Укажи оффер для ручной строки.");
      return;
    }
    setSavingKey("new");
    setError("");
    try {
      await apiPost("/api/roi/manual", {
        ...requestParams(),
        is_manual: true,
        ...newRow,
      });
      setNewRow(roiDraftFromRow());
      await loadTable();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingKey(null);
    }
  }

  useEffect(() => {
    loadTable();
  }, []);

  const rows = table?.rows || [];
  const unmappedSub5Rows = table?.unmapped_sub5_rows || [];
  const kpis = table?.kpis || {};
  const agencyPercent = Number(table?.agency_commission_percent || agencyCommissionPercent || 0);
  const agencyAmount = Number(table?.agency_commission_amount || 0);
  return h("div", { className: "roi-page" }, [
    h("form", { className: "controls-bar roi-controls", onSubmit: loadTable, key: "controls" }, [
      h("div", { className: "controls-group", key: "left" }, [
        ...PeriodControl({
          periodKey,
          setPeriodKey,
          dateFrom,
          setDateFrom,
          dateTo,
          setDateTo,
          keyPrefix: "roi-period",
        }),
        h("label", null, ["Поиск", h("input", { value: query, onChange: (event) => setQuery(event.target.value) })]),
        h("label", null, ["Сорт", h("select", { value: sortKey, onChange: (event) => setSortKey(event.target.value) }, [
          ["profit", "Профит"],
          ["roi", "ROI"],
          ["total_spend", "Расход"],
          ["revenue", "Приход"],
          ["deposits", "Депы"],
          ["offer", "Оффер"],
        ].map(([value, label]) => h("option", { value, key: value }, label)))]),
        h("label", null, ["Порядок", h("select", { value: sortOrder, onChange: (event) => setSortOrder(event.target.value) }, [
          h("option", { value: "desc", key: "desc" }, "↓"),
          h("option", { value: "asc", key: "asc" }, "↑"),
        ])]),
        h("label", null, ["Лимит", h("input", { type: "number", min: 50, max: 5000, value: limit, onChange: (event) => setLimit(Number(event.target.value || 500)) })]),
        h("label", null, ["Комиссия %", h("input", {
          className: "roi-commission-input",
          type: "number",
          min: 0,
          step: "0.01",
          value: agencyCommissionPercent,
          onChange: (event) => setAgencyCommissionPercent(event.target.value),
        })]),
      ]),
      h("div", { className: "controls-group", key: "right" }, [
        table ? h("span", { className: "controls-range", key: "range" }, `${table.date_from} - ${table.date_to}`) : null,
        h("button", { type: "button", disabled: savingKey === "commission", onClick: saveCommission, key: "commission" }, savingKey === "commission" ? "Сохраняю..." : "Сохранить %"),
        h("button", { type: "submit", disabled: busy, key: "load" }, busy ? "Собираю..." : "Собрать"),
        h("button", { type: "button", className: "primary", disabled: refreshing, onClick: refreshKeitaro, key: "kt" }, refreshing ? "Обновляю..." : "Обновить Keitaro"),
      ]),
    ]),
    error ? h("div", { className: "error", key: "error" }, error) : null,
    h("section", { className: "grid kpi-grid kpi-grid--primary", key: "kpis" }, [
      h(KpiCard, { label: "Профит", value: money(kpis.profit), helper: "приход - расход", tone: Number(kpis.profit || 0) >= 0 ? "good" : "bad", featured: true, loading: busy && !table, key: "profit" }),
      h(KpiCard, { label: "ROI", value: percent(kpis.roi), helper: "профит / расход", tone: Number(kpis.roi || 0) >= 0.2 ? "good" : "bad", featured: true, loading: busy && !table, key: "roi" }),
      h(KpiCard, { label: "Приход", value: money(kpis.revenue), helper: `${number(kpis.deposits)} депов`, loading: busy && !table, key: "revenue" }),
      h(KpiCard, { label: "Расход", value: money(kpis.total_spend), helper: `${money(kpis.acc_spend)} ACC · ${money(kpis.pwa_spend)} PWA${agencyAmount ? ` · ${money(agencyAmount)} агентство` : ""}`, loading: busy && !table, key: "spend" }),
    ]),
    h("section", { className: "roi-grid", key: "body" }, [
      h(Panel, {
        title: "ROI таблица",
        eyebrow: "engine",
        right: table ? h("div", { className: "status-row compact" }, [
          h(Pill, null, `${number(table.row_count)} строк`),
          h(Pill, { tone: table.edited_count ? "good" : null }, `${number(table.edited_count)} правок`),
          h(Pill, { tone: table.manual_count ? "warn" : null }, `${number(table.manual_count)} ручных`),
          agencyPercent ? h(Pill, { tone: "warn" }, `${number(agencyPercent)}% агентство`) : null,
          table.unmapped_sub5_count ? h(Pill, { tone: "warn" }, `${number(table.unmapped_sub5_count)} sub5 без offer · ${money(table.unmapped_sub5_spend)}`) : null,
        ]) : null,
      }, h(RoiEditableTable, {
        rows,
        drafts,
        onPatch: patchDraft,
        onSave: saveRow,
        onReset: resetRow,
        savingKey,
        deletingKey,
      })),
      unmappedSub5Rows.length ? h(Panel, {
        title: "Sub5 без offer",
        eyebrow: "разбор расхода",
        right: h(Pill, { tone: "warn" }, `${number(table.unmapped_sub5_count)} · ${money(table.unmapped_sub5_spend)}`),
        className: "roi-sub5-panel",
      }, h(RoiUnmappedSub5Table, {
        rows: unmappedSub5Rows,
        drafts: sub5Drafts,
        onPatch: patchSub5Draft,
        onAssign: assignSub5,
        savingKey: savingSub5Key,
      })) : null,
      h(Panel, { title: "Ручная строка", eyebrow: "добавить", className: "roi-manual-panel" },
        h("form", { className: "roi-manual-form", onSubmit: saveNewRow }, [
          h("label", { className: "wide", key: "offer" }, [
            h("span", null, "Оффер / GEO / ПП"),
            h("input", { value: newRow.offer, onChange: (event) => setNewRow({ ...newRow, offer: event.target.value }) }),
          ]),
          ...[
            ["deposits", "Депы", "1"],
            ["revenue", "Приход", "0.01"],
            ["acc_spend", "Расход ACC", "0.01"],
            ["pwa_spend", "Расход PWA", "0.01"],
          ].map(([field, label, step]) => h("label", { key: field }, [
            h("span", null, label),
            h("input", {
              type: "number",
              step,
              value: newRow[field],
              onChange: (event) => setNewRow({ ...newRow, [field]: event.target.value }),
            }),
          ])),
          h("label", { className: "wide", key: "notes" }, [
            h("span", null, "Заметка"),
            h("input", { value: newRow.notes, onChange: (event) => setNewRow({ ...newRow, notes: event.target.value }) }),
          ]),
          h("button", { className: "primary", disabled: savingKey === "new", key: "save" }, savingKey === "new" ? "Сохраняю..." : "Добавить"),
        ])
      ),
    ]),
  ]);
}

function Sub5Page() {
  const [date, setDate] = useState(todayYmd());
  const [groupBy, setGroupBy] = useState("sub5");
  const [startHour, setStartHour] = useState(11);
  const [limit, setLimit] = useState(100);
  const [sub5, setSub5] = useState("");
  const [testFilter, setTestFilter] = useState("all");
  const [geoTests, setGeoTests] = useState([]);
  const [report, setReport] = useState(null);
  const [sortKey, setSortKey] = useState("deps");
  const [sortOrder, setSortOrder] = useState("desc");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const requestSeq = useRef(0);

  async function fetchReport(overrides = {}) {
    const nextDate = overrides.date ?? date;
    const nextGroupBy = overrides.groupBy ?? groupBy;
    const nextStartHour = overrides.startHour ?? startHour;
    const nextLimit = overrides.limit ?? limit;
    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;
    setBusy(true);
    setError("");
    try {
      const data = await apiGet("/api/sub5-report", {
        date: nextDate,
        period_key: `sub5_${nextDate}`,
        group_by: nextGroupBy,
        start_hour: nextStartHour,
        limit: nextLimit,
        live: Number(nextStartHour || 0) === 0 ? 0 : 1,
      });
      if (requestSeq.current === requestId) {
        setReport(data);
      }
    } catch (err) {
      if (requestSeq.current === requestId) {
        setError(err.message);
      }
    } finally {
      if (requestSeq.current === requestId) {
        setBusy(false);
      }
    }
  }

  async function loadReport(event) {
    event?.preventDefault();
    await fetchReport();
  }

  async function loadGeoTests() {
    try {
      const data = await apiGet("/api/geo/tests", { include_finished: "true", include_todos: "false", limit: 500 });
      setGeoTests(data.tests || []);
    } catch (err) {
      setError(err.message);
    }
  }

  async function refreshKeitaro() {
    setRefreshing(true);
    setError("");
    try {
      const refreshDateTo = Number(startHour || 0) === 0 ? date : addDaysYmd(date, 1);
      await apiPost("/api/refresh", {
        period_key: `sub5_${date}`,
        date_from: date,
        date_to: refreshDateTo,
        reports: ["tracking_quality", "deposits"],
      });
      await fetchReport();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchReport();
    loadGeoTests();
  }, []);

  const groupColumn = groupBy === "account"
    ? { key: "account_id", label: "Аккаунт", sortable: true }
    : groupBy === "offer"
      ? { key: "offer", label: "Оффер", sortable: true }
      : { key: "sub5", label: "Sub5", sortable: true };
  const columns = [
    groupColumn,
    groupBy === "sub5" ? { key: "buyer", label: "Buyer", sortable: true } : null,
    groupBy === "sub5" ? { key: "geo", label: "GEO", sortable: true } : null,
    groupBy === "sub5" ? { key: "creative", label: "Креатив", sortable: true } : null,
    { key: "installs", label: "Installs", numeric: true, sortable: true, format: number },
    { key: "regs", label: "Реги", numeric: true, sortable: true, format: number },
    { key: "deps", label: "Депы", numeric: true, sortable: true, format: number },
    { key: "revenue", label: "Доход", numeric: true, sortable: true, format: money },
    { key: "total_spend", label: "Расход", numeric: true, sortable: true, format: money },
    { key: "cr", label: "CR", numeric: true, sortable: true, format: percent },
    { key: "cpi", label: "CPI", numeric: true, sortable: true, format: money },
    { key: "cpr", label: "CPR", numeric: true, sortable: true, format: money },
    { key: "cpd", label: "CPD", numeric: true, sortable: true, format: money },
    { key: "recovered_deps", label: "Recovered", numeric: true, sortable: true, format: number },
    { key: "late_deps", label: "Late", numeric: true, sortable: true, format: number },
  ].filter(Boolean);
  const sourceCounts = report?.counts || {};
  const sourceRows = report?.all_rows || report?.rows || [];
  const selectedTest = geoTests.find((test) => String(test.id) === String(testFilter));
  const selectedTestSub5Values = useMemo(() => new Set(geoTestSub5Values(selectedTest)), [selectedTest]);
  const textFilteredRows = useMemo(() => filterSub5Rows(sourceRows, sub5), [sourceRows, sub5]);
  const filteredRows = useMemo(() => {
    if (!selectedTest) return textFilteredRows;
    if (!selectedTestSub5Values.size) return [];
    return textFilteredRows.filter((row) => selectedTestSub5Values.has(String(row.sub5 || "").trim()));
  }, [textFilteredRows, selectedTest, selectedTestSub5Values]);
  const sortedRows = useMemo(() => sortSub5Rows(filteredRows, sortKey, sortOrder), [filteredRows, sortKey, sortOrder]);
  const visibleLimit = Math.max(1, Number(limit || 100));
  const visibleRows = useMemo(() => sortedRows.slice(0, visibleLimit), [sortedRows, visibleLimit]);
  const counts = useMemo(() => summarizeSub5Rows(filteredRows), [filteredRows]);
  const currentCsv = useMemo(() => makeSub5RowsCsv(sortedRows, groupBy), [sortedRows, groupBy]);

  function toggleSort(key) {
    const column = columns.find((item) => item.key === key);
    const nextOrder = sortKey === key
      ? (sortOrder === "desc" ? "asc" : "desc")
      : (column?.numeric ? "desc" : "asc");
    setSortKey(key);
    setSortOrder(nextOrder);
  }

  return h("div", { className: "sub5-page" }, [
    h(Panel, { title: "Отчёт по конверсиям", eyebrow: "Keitaro conversions log" }, [
      h("form", { className: "sub5-form", onSubmit: loadReport, key: "form" }, [
        h("label", null, [
          h("span", null, "Дата"),
          h("input", { type: "date", value: date, onChange: (event) => setDate(event.target.value) }),
        ]),
        h("label", null, [
          h("span", null, "Группировка"),
          h("select", { value: groupBy, onChange: (event) => {
            const nextGroupBy = event.target.value;
            setGroupBy(nextGroupBy);
            if (nextGroupBy !== "sub5") setTestFilter("all");
            setSortKey("deps");
            setSortOrder("desc");
            setReport(null);
            fetchReport({ groupBy: nextGroupBy });
          } },
            SUB5_GROUP_OPTIONS.map(([value, label]) => h("option", { value, key: value }, label))
          ),
        ]),
        h("label", { className: "wide" }, [
          h("span", null, "Тест"),
          h("select", { value: testFilter, onChange: (event) => {
            const nextTestFilter = event.target.value;
            setTestFilter(nextTestFilter);
            if (nextTestFilter !== "all" && groupBy !== "sub5") {
              setGroupBy("sub5");
              setSortKey("deps");
              setSortOrder("desc");
              setReport(null);
              fetchReport({ groupBy: "sub5" });
            }
          } }, [
            h("option", { value: "all", key: "all" }, "Все тесты"),
            ...geoTests.map((test) => h("option", { value: test.id, key: test.id }, geoTestOptionLabel(test))),
          ]),
        ]),
        h("label", null, [
          h("span", null, "Старт часа"),
          h("input", { type: "number", min: 0, max: 23, value: startHour, onChange: (event) => setStartHour(Number(event.target.value || 0)) }),
        ]),
        h("label", null, [
          h("span", null, "Лимит"),
          h("input", { type: "number", min: 10, max: 1000, value: limit, onChange: (event) => setLimit(Number(event.target.value || 100)) }),
        ]),
        h("label", { className: "wide" }, [
          h("span", null, "Sub5 фильтр"),
          h("input", { value: sub5, placeholder: "2505|ZM|kkid|...", onChange: (event) => setSub5(event.target.value) }),
        ]),
        h("div", { className: "sub5-actions" }, [
          h("button", { type: "submit", disabled: busy }, busy ? "Считаю..." : "Собрать отчёт"),
          h("button", { className: "primary", type: "button", disabled: refreshing, onClick: refreshKeitaro }, refreshing ? "Тяну Keitaro..." : "Подтянуть Keitaro"),
          h("button", {
            type: "button",
            disabled: !report,
            onClick: () => downloadText(`sub5-${date}-${groupBy}.csv`, currentCsv),
          }, "CSV"),
        ]),
      ]),
      error ? h("div", { className: "error compact-error", key: "error" }, error) : null,
      report ? h("div", { className: "status-row compact", key: "status" }, [
        h(Pill, { tone: "good" }, report.source === "local_db" ? "Источник: SQLite" : "Источник: Keitaro"),
        h(Pill, null, `${report.time_window.start_datetime} - ${report.time_window.end_datetime}`),
        selectedTest ? h(Pill, { tone: selectedTestSub5Values.size ? "good" : "warn" }, `${selectedTest.geo}: ${selectedTest.title} · ${number(selectedTestSub5Values.size)} sub5`) : null,
        h(Pill, null, `${number(sourceCounts.raw_loaded_rows)} raw rows`),
        h(Pill, null, `${number(sourceCounts.install_source_rows)} install rows`),
        h(Pill, null, `${number(sourceCounts.spend_source_rows)} spend rows`),
        h(Pill, { tone: counts.late_deps ? "warn" : "good" }, `${number(counts.late_deps)} late deps`),
        report.latest_refresh?.created_at ? h(Pill, null, `Refresh: ${report.latest_refresh.created_at}`) : null,
      ]) : null,
    ]),
    report ? h("section", { className: "grid kpi-grid sub5-kpi-grid", key: "kpis" }, [
      h(KpiCard, { label: "Installs", value: number(counts.installs), helper: "campaign unique clicks", key: "installs" }),
      h(KpiCard, { label: "Реги", value: number(counts.regs), helper: "lead + sale", key: "regs" }),
      h(KpiCard, { label: "Депы", value: number(counts.deps), helper: "sale + recovered", key: "deps" }),
      h(KpiCard, { label: "CR", value: percent(counts.cr), helper: "депы / реги", tone: Number(counts.cr || 0) >= 0.2 ? "good" : "warn", key: "cr" }),
      h(KpiCard, { label: "CPI", value: money(counts.cpi), helper: "расход / installs", key: "cpi" }),
      h(KpiCard, { label: "CPR", value: money(counts.cpr), helper: "расход / реги", key: "cpr" }),
      h(KpiCard, { label: "CPD", value: money(counts.cpd), helper: "расход / депы", key: "cpd" }),
      h(KpiCard, { label: "Доход", value: money(counts.revenue), helper: "revenue по депам", key: "revenue" }),
      h(KpiCard, { label: "Расход", value: money(counts.total_spend), helper: "Facebook spend / Keitaro cost", key: "spend" }),
      h(KpiCard, { label: "Группы", value: number(counts.groups), helper: SUB5_GROUP_OPTIONS.find(([value]) => value === groupBy)?.[1], key: "groups" }),
      h(KpiCard, { label: "Recovered", value: number(counts.recovered_deps), helper: "previous_status=sale", key: "recovered" }),
      h(KpiCard, { label: "Late deps", value: number(counts.late_deps), helper: "депы с регой вне окна", tone: counts.late_deps ? "warn" : "good", key: "late" }),
    ]) : null,
    h(Panel, {
      title: "Строки отчёта",
      eyebrow: groupBy,
      right: report ? h(Pill, null, `${number(visibleRows.length)} / ${number(filteredRows.length)} строк`) : null,
      key: "table",
    }, report ? h(SimpleTable, { rows: visibleRows, columns, sort: { key: sortKey, order: sortOrder }, onSort: toggleSort }) : h(Empty, null, "Отчёт ещё не собран.")),
  ]);
}

function KeitaroRefreshSettingsPanel({ settings, saving, onSave, onClose }) {
  const [enabled, setEnabled] = useState(Boolean(settings?.enabled));
  const [intervalMinutes, setIntervalMinutes] = useState(Number(settings?.interval_minutes || 60));

  useEffect(() => {
    setEnabled(Boolean(settings?.enabled));
    setIntervalMinutes(Number(settings?.interval_minutes || 60));
  }, [settings?.enabled, settings?.interval_minutes]);

  function submit(event) {
    event.preventDefault();
    onSave({
      enabled,
      interval_minutes: Number(intervalMinutes || 60),
    });
  }

  return h("div", { className: "settings-overlay", onClick: onClose }, [
    h("form", { className: "settings-drawer", onClick: (event) => event.stopPropagation(), onSubmit: submit, key: "drawer" }, [
      h("div", { className: "settings-head", key: "head" }, [
        h("div", { className: "settings-head-text", key: "text" }, [
          h("h3", { key: "t" }, "Автообновление Keitaro"),
          h("p", { key: "s" }, "Расписание подтягивает Keitaro и сохраняет данные в SQLite."),
        ]),
        h("button", { type: "button", className: "icon-btn", onClick: onClose, title: "Закрыть", key: "x" }, "✕"),
      ]),
      h("div", { className: "settings-group", key: "mode" }, [
        h("label", { className: "settings-toggle", key: "enabled" }, [
          h("span", { key: "l" }, "Включить"),
          h("input", {
            type: "checkbox",
            checked: enabled,
            onChange: (event) => setEnabled(event.target.checked),
            key: "c",
          }),
        ]),
      ]),
      h("div", { className: "settings-group", key: "interval" }, [
        h("div", { className: "settings-group-title", key: "t" }, "Интервал"),
        h("select", {
          className: "settings-select",
          value: intervalMinutes,
          onChange: (event) => setIntervalMinutes(Number(event.target.value)),
          key: "select",
        }, [
          [15, "15 минут"],
          [30, "30 минут"],
          [60, "1 час"],
          [120, "2 часа"],
          [240, "4 часа"],
        ].map(([value, label]) => h("option", { value, key: value }, label))),
      ]),
      h("div", { className: "settings-actions", key: "actions" }, [
        h("button", { type: "button", onClick: onClose, key: "cancel" }, "Отмена"),
        h("button", { type: "submit", className: "primary", disabled: saving, key: "save" }, saving ? "Сохраняю..." : "Сохранить"),
      ]),
    ]),
  ]);
}

function SettingsPanel({ settings, onToggleSection, onToggleKpi, onClose }) {
  return h("div", { className: "settings-overlay", onClick: onClose }, [
    h("div", { className: "settings-drawer", onClick: (event) => event.stopPropagation(), key: "drawer" }, [
      h("div", { className: "settings-head", key: "head" }, [
        h("div", { className: "settings-head-text", key: "text" }, [
          h("h3", { key: "t" }, "Что показывать"),
          h("p", { key: "s" }, "Скрытые блоки можно вернуть в любой момент"),
        ]),
        h("button", { className: "icon-btn", onClick: onClose, title: "Закрыть", key: "x" }, "✕"),
      ]),
      h("div", { className: "settings-group", key: "sections" }, [
        h("div", { className: "settings-group-title", key: "t" }, "Разделы"),
        ...DASHBOARD_SECTIONS.map(([key, label]) =>
          h("label", { className: "settings-toggle", key }, [
            h("span", { key: "l" }, label),
            h("input", {
              type: "checkbox",
              checked: settings.sections[key] !== false,
              onChange: () => onToggleSection(key),
              key: "c",
            }),
          ])
        ),
      ]),
      h("div", { className: "settings-group", key: "kpis" }, [
        h("div", { className: "settings-group-title", key: "t" }, "Ключевые метрики"),
        ...DASHBOARD_KPIS.map(([key, label]) =>
          h("label", { className: "settings-toggle", key }, [
            h("span", { key: "l" }, label),
            h("input", {
              type: "checkbox",
              checked: settings.kpis[key] !== false,
              onChange: () => onToggleKpi(key),
              key: "c",
            }),
          ])
        ),
      ]),
    ]),
  ]);
}

function ProfilePage({ config, onConfigChange }) {
  const [settings, setSettings] = useState(() => defaultProfileSettings());
  const [timezone, setTimezone] = useState(defaultProfileSettings().timezone);
  const [keitaroToken, setKeitaroToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadProfile() {
    setBusy(true);
    setError("");
    try {
      const data = await apiGet("/api/profile-settings");
      const next = mergeProfileSettings(data.settings);
      setSettings(next);
      setTimezone(next.timezone);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadProfile();
  }, []);

  async function saveProfile(event) {
    event?.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const payload = {
        timezone: timezone.trim() || defaultProfileSettings().timezone,
        keitaro_api_key: keitaroToken.trim(),
      };
      const data = await apiPost("/api/profile-settings", { settings: payload });
      const next = mergeProfileSettings(data.settings);
      setSettings(next);
      setTimezone(next.timezone);
      setKeitaroToken("");
      setMessage("Профиль сохранён.");
      apiGet("/api/config").then(onConfigChange).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function clearProfileToken() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const data = await apiPost("/api/profile-settings", {
        settings: {
          timezone: timezone.trim() || settings.timezone,
          clear_keitaro_token: true,
        },
      });
      const next = mergeProfileSettings(data.settings);
      setSettings(next);
      setKeitaroToken("");
      setMessage("Токен очищен.");
      apiGet("/api/config").then(onConfigChange).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const effectiveTokenPresent = settings.keitaro_token_present || settings.env_keitaro_token_present || config?.keitaro?.api_key_present;
  const timezoneOptions = TIMEZONE_OPTIONS.includes(timezone)
    ? TIMEZONE_OPTIONS
    : [timezone, ...TIMEZONE_OPTIONS];

  return h("div", { className: "profile-page" }, [
    h(Panel, {
      title: "Профиль пользователя",
      eyebrow: "timezone и Keitaro",
      right: h("button", { type: "button", onClick: loadProfile, disabled: busy }, busy ? "Обновляю..." : "Обновить"),
      key: "profile",
    }, [
      error ? h("div", { className: "error compact-error", key: "error" }, error) : null,
      h("form", { className: "profile-form", onSubmit: saveProfile, key: "form" }, [
        h("label", { key: "timezone" }, [
          h("span", null, "Часовой пояс"),
          h("input", {
            list: "profile-timezone-options",
            value: timezone,
            onChange: (event) => setTimezone(event.target.value),
            placeholder: "Asia/Tbilisi",
          }),
          h("datalist", { id: "profile-timezone-options" },
            timezoneOptions.map((value) => h("option", { value, key: value }))
          ),
        ]),
        h("label", { key: "token" }, [
          h("span", null, "Keitaro token"),
          h("input", {
            type: "password",
            value: keitaroToken,
            onChange: (event) => setKeitaroToken(event.target.value),
            placeholder: settings.keitaro_token_present ? "Токен сохранён" : "Api-Key",
            autoComplete: "off",
          }),
        ]),
        h("div", { className: "profile-actions", key: "actions" }, [
          h("button", { className: "primary", type: "submit", disabled: saving }, saving ? "Сохраняю..." : "Сохранить"),
          settings.keitaro_token_present ? h("button", { className: "ghost danger", type: "button", disabled: saving, onClick: clearProfileToken }, "Очистить токен") : null,
          message ? h("span", { className: "geo-save-message", key: "message" }, message) : null,
        ]),
      ]),
    ]),
    h("section", { className: "profile-status-grid", key: "status" }, [
      h(Panel, { title: "Keitaro", eyebrow: "доступ" }, [
        h("div", { className: "profile-status-row" }, [
          h("span", null, "Base URL"),
          h(Pill, { tone: settings.keitaro_base_url_present ? "good" : "warn" }, settings.keitaro_base_url_present ? "найден" : "не найден"),
        ]),
        h("div", { className: "profile-status-row" }, [
          h("span", null, "Token"),
          h(Pill, { tone: effectiveTokenPresent ? "good" : "warn" }, settings.keitaro_token_present ? "профиль" : settings.env_keitaro_token_present ? ".env" : "не найден"),
        ]),
      ]),
      h(Panel, { title: "Период", eyebrow: "локальное время" }, [
        h("div", { className: "profile-status-row" }, [
          h("span", null, "Timezone"),
          h(Pill, null, settings.timezone || timezone),
        ]),
      ]),
    ]),
  ]);
}

function App() {
  const [config, setConfig] = useState(null);
  const [route, setRoute] = useState(currentRoute());
  const [periodKey, setPeriodKey] = useState("last_7_days");
  const [periodDateFrom, setPeriodDateFrom] = useState("");
  const [periodDateTo, setPeriodDateTo] = useState("");
  const [targetProfit, setTargetProfit] = useState(1000);
  const [targetRoi, setTargetRoi] = useState(0.6);
  const [summary, setSummary] = useState(null);
  const [topOffers, setTopOffers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || getStoredTheme());
  const [settings, setSettings] = useState(() => defaultVisibility());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshSettings, setRefreshSettings] = useState(() => defaultKeitaroRefreshSettings());
  const [refreshSettingsOpen, setRefreshSettingsOpen] = useState(false);
  const [savingRefreshSettings, setSavingRefreshSettings] = useState(false);
  const [lastKeitaroRefresh, setLastKeitaroRefresh] = useState("");

  function updateSettings(next) {
    setSettings(next);
    apiPost("/api/settings", { settings: next }).catch(() => {});
  }

  function toggleSection(key) {
    updateSettings({ ...settings, sections: { ...settings.sections, [key]: settings.sections[key] === false } });
  }

  function toggleKpi(key) {
    updateSettings({ ...settings, kpis: { ...settings.kpis, [key]: settings.kpis[key] === false } });
  }

  async function saveRefreshSettings(nextSettings) {
    setSavingRefreshSettings(true);
    setError("");
    try {
      const data = await apiPost("/api/keitaro-refresh-settings", { settings: nextSettings });
      setRefreshSettings(mergeKeitaroRefreshSettings(data.settings));
      setRefreshSettingsOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingRefreshSettings(false);
    }
  }

  async function load() {
    setBusy(true);
    setError("");
    try {
      const summaryData = await apiGet("/api/summary", {
        ...periodRequestParams(periodKey, periodDateFrom, periodDateTo),
        target_daily_profit: targetProfit,
        target_roi: targetRoi,
      });
      setSummary(summaryData);
      setTopOffers(summaryData.top_offers || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshKeitaro(options = {}) {
    if (refreshing) return;
    setRefreshing(true);
    if (!options.silent) setError("");
    try {
      await apiPost("/api/refresh", {
        reports: ["daily", "offer", "campaign", "creative", "placement", "tracking_quality", "deposits"],
        ...refreshPeriodPayload(periodKey, periodDateFrom, periodDateTo),
      });
      setLastKeitaroRefresh(new Date().toLocaleString("ru-RU"));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    apiGet("/api/config").then(setConfig).catch(() => {});
    apiGet("/api/settings").then((data) => setSettings(mergeVisibility(data.settings))).catch(() => {});
    apiGet("/api/keitaro-refresh-settings").then((data) => {
      setRefreshSettings(mergeKeitaroRefreshSettings(data.settings));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("dashboard-theme", theme); } catch (err) { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    load();
  }, [periodKey, periodDateFrom, periodDateTo]);

  useEffect(() => {
    if (!refreshSettings.enabled || !config?.keitaro?.configured) return undefined;
    const minutes = Math.max(5, Number(refreshSettings.interval_minutes || 60));
    const timer = window.setInterval(() => {
      if (document.hidden || refreshing) return;
      refreshKeitaro({ silent: true });
    }, minutes * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [refreshSettings.enabled, refreshSettings.interval_minutes, config?.keitaro?.configured, periodKey, periodDateFrom, periodDateTo, targetProfit, targetRoi, refreshing]);

  useEffect(() => {
    function handleHashChange() {
      setRoute(currentRoute());
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const kpis = summary?.kpis || {};
  const kpiLoading = busy && !summary;
  const dateCaption = summary ? `${summary.date_from} - ${summary.date_to}` : "загрузка периода…";
  const isTodoPage = route === "todos";
  const isRoiPage = route === "roi";
  const isSub5Page = route === "sub5";
  const isGeoPage = route === "geo";
  const isTestsPage = route === "tests";
  const isCreativesPage = route === "creatives";
  const isProfilePage = route === "profile";
  const isDashboardPage = !isTodoPage && !isRoiPage && !isSub5Page && !isGeoPage && !isTestsPage && !isCreativesPage && !isProfilePage;
  const decisions = useMemo(() => {
    return [
      ...(summary?.scale_candidates || []),
      ...(summary?.kill_candidates || []),
      ...(summary?.hold_candidates || []),
    ].slice(0, 14);
  }, [summary]);
  const sub5Decisions = summary?.sub5_candidates || [];

  return h("div", { className: "app" }, [
    h("header", { className: "topbar", key: "top" },
      h("div", { className: "topbar-inner" }, [
        h("div", { className: "brand", key: "brand" }, [
          h("h1", null, "Рабочий дашборд"),
          h("span", { className: "meta" }, "Keitaro + Facebook · аналитика и задачи"),
        ]),
        h("div", { className: "topbar-right", key: "right" }, [
          h("nav", { className: "nav-tabs", key: "nav" }, [
            h("a", { className: cx(route === "dashboard" && "active"), href: "#/", key: "dashboard" }, "Дашборд"),
            h("a", { className: cx(isGeoPage && "active"), href: "#/geo", key: "geo" }, "GEO"),
            h("a", { className: cx(isTestsPage && "active"), href: "#/tests", key: "tests" }, "Тесты"),
            h("a", { className: cx(isCreativesPage && "active"), href: "#/creatives", key: "creatives" }, "Креативы"),
            h("a", { className: cx(isRoiPage && "active"), href: "#/roi", key: "roi" }, "ROI"),
            h("a", { className: cx(isSub5Page && "active"), href: "#/sub5", key: "sub5" }, "Конверсии"),
            h("a", { className: cx(isTodoPage && "active"), href: "#/todos", key: "todos" }, "Задачи"),
            h("a", { className: cx(isProfilePage && "active"), href: "#/profile", key: "profile" }, "Профиль"),
          ]),
          h("div", { className: "topbar-actions", key: "actions" }, [
            h("button", {
              className: "icon-btn",
              onClick: () => setTheme(theme === "dark" ? "light" : "dark"),
              title: theme === "dark" ? "Светлая тема" : "Тёмная тема",
              key: "theme",
            }, theme === "dark" ? "☀" : "☾"),
            isDashboardPage ? h("button", {
              className: "icon-btn",
              onClick: () => setSettingsOpen(true),
              title: "Настроить виджеты",
              key: "gear",
            }, "⚙") : null,
          ]),
        ]),
      ])
    ),
    h("main", { className: "shell", key: "main" }, [
      error ? h("div", { className: "error" }, error) : null,
      ...(isTodoPage ? [
        h(TodoPage, { periodKey, summary, key: "todo-page" }),
      ] : isGeoPage ? [
        h(GeoPage, {
          mode: "geo",
          periodKey,
          setPeriodKey,
          dateFrom: periodDateFrom,
          setDateFrom: setPeriodDateFrom,
          dateTo: periodDateTo,
          setDateTo: setPeriodDateTo,
          key: "geo-page",
        }),
      ] : isTestsPage ? [
        h(GeoPage, {
          mode: "tests",
          periodKey,
          setPeriodKey,
          dateFrom: periodDateFrom,
          setDateFrom: setPeriodDateFrom,
          dateTo: periodDateTo,
          setDateTo: setPeriodDateTo,
          key: "tests-page",
        }),
      ] : isCreativesPage ? [
        h(GeoPage, {
          mode: "creatives",
          periodKey,
          setPeriodKey,
          dateFrom: periodDateFrom,
          setDateFrom: setPeriodDateFrom,
          dateTo: periodDateTo,
          setDateTo: setPeriodDateTo,
          key: "creatives-page",
        }),
      ] : isRoiPage ? [
        h(RoiPage, { key: "roi-page" }),
      ] : isSub5Page ? [
        h(Sub5Page, { key: "sub5-page" }),
      ] : isProfilePage ? [
        h(ProfilePage, { config, onConfigChange: setConfig, key: "profile-page" }),
      ] : [
      h("div", { className: "controls-bar", key: "controls" }, [
        h("div", { className: "controls-group", key: "left" }, [
          ...PeriodControl({
            periodKey,
            setPeriodKey,
            dateFrom: periodDateFrom,
            setDateFrom: setPeriodDateFrom,
            dateTo: periodDateTo,
            setDateTo: setPeriodDateTo,
            keyPrefix: "main-period",
          }),
          h("label", { key: "tp" }, ["Цель по прибыли", h("input", {
            type: "number",
            value: targetProfit,
            onChange: (event) => setTargetProfit(Number(event.target.value || 0)),
          })]),
          h("label", { key: "tr" }, ["Целевой ROI", h("input", {
            type: "number",
            step: "0.05",
            value: targetRoi,
            onChange: (event) => setTargetRoi(Number(event.target.value || 0)),
          })]),
        ]),
        h("div", { className: "controls-group", key: "right" }, [
          h("span", { className: "controls-range", key: "range" }, dateCaption),
          h("button", { onClick: load, disabled: busy, key: "refresh" }, busy ? "Обновляю..." : "Обновить экран"),
        ]),
      ]),
      (settings.sections.plan !== false || settings.sections.import !== false)
        ? h("section", { className: "hero-grid", key: "hero" }, [
            settings.sections.plan !== false ? h(WorkPlan, {
              config,
              onRefreshKeitaro: refreshKeitaro,
              onOpenAutoRefresh: () => setRefreshSettingsOpen(true),
              refreshSettings,
              refreshing,
              lastRefresh: lastKeitaroRefresh,
              key: "plan",
            }) : null,
            settings.sections.import !== false ? h(FileImportPanel, {
              onImported: () => {
                load();
              },
              key: "upload",
            }) : null,
          ])
        : null,
      settings.sections.todos !== false ? h(TodoSummaryCard, {
        periodKey,
        dateFrom: summary?.date_from || periodDateFrom,
        dateTo: summary?.date_to || periodDateTo,
        key: "todos",
      }) : null,
      settings.sections.kpis !== false ? h("section", { className: "kpi-block", key: "kpis" }, [
        h(SectionTitle, { hint: dateCaption, key: "title" }, "Ключевые метрики"),
        h("div", { className: "grid kpi-grid kpi-grid--primary", key: "primary" }, [
          settings.kpis.profit !== false ? h(KpiCard, { label: "Прибыль", value: money(kpis.profit), helper: "доход - расход", featured: true, loading: kpiLoading, tone: Number(kpis.profit || 0) >= 0 ? "good" : "bad", key: "profit" }) : null,
          settings.kpis.roi !== false ? h(KpiCard, { label: "ROI", value: percent(kpis.roi), helper: "прибыль / расход", featured: true, loading: kpiLoading, tone: Number(kpis.roi || 0) >= 0.2 ? "good" : "bad", key: "roi" }) : null,
          settings.kpis.revenue !== false ? h(KpiCard, { label: "Доход", value: money(kpis.revenue), helper: "из расходов / Keitaro", loading: kpiLoading, key: "revenue" }) : null,
          settings.kpis.spend !== false ? h(KpiCard, { label: "Расход", value: money(kpis.total_spend), helper: kpis.spend_source_label || "FB + PWA", loading: kpiLoading, key: "spend" }) : null,
        ]),
        h("div", { className: "grid kpi-grid kpi-grid--secondary", key: "secondary" }, [
          settings.kpis.deposits !== false ? h(KpiCard, { label: "Депозиты", value: number(kpis.deposits), helper: "депы / продажи", loading: kpiLoading, key: "deps" }) : null,
          settings.kpis.cpa !== false ? h(KpiCard, { label: "CPA", value: money(kpis.cpa), helper: "расход / депы", loading: kpiLoading, key: "cpa" }) : null,
          settings.kpis.rpd !== false ? h(KpiCard, { label: "RPD", value: money(kpis.rpd), helper: "доход / депы", loading: kpiLoading, key: "rpd" }) : null,
          settings.kpis.gap !== false ? h(KpiCard, { label: "Недобор до цели", value: money(kpis.profit_gap), helper: `нужный расход ${money(kpis.required_spend_for_target_profit)}`, loading: kpiLoading, tone: Number(kpis.profit_gap || 0) <= 0 ? "good" : "warn", key: "gap" }) : null,
        ]),
      ]) : null,
      settings.sections.decisions !== false ? h("section", { className: "content-block", key: "content" }, [
      h(SectionTitle, { hint: "рекомендации по связкам", key: "title" }, "Решения и аналитика"),
      h(DecisionLegend, { key: "legend" }),
      h("div", { className: "content-grid", key: "grid" }, [
        h("div", { className: "stack" }, [
          h(Panel, { title: "Офферы по прибыли", eyebrow: "топ по прибыли", right: h(Pill, null, formatPeriodLabel(periodKey, summary?.date_from || periodDateFrom, summary?.date_to || periodDateTo)) },
            h(BarList, { rows: topOffers, labelKey: "normalized_offer", valueKey: "profit" })
          ),
          h(Panel, { title: "Операционные решения", eyebrow: "рекомендации по связкам" },
            h(DecisionTable, { rows: decisions })
          ),
          h(Panel, { title: "Sub5 к проверке", eyebrow: "расход без offer-level мэппинга" },
            h(DecisionTable, { rows: sub5Decisions })
          ),
        ]),
        h("div", { className: "stack" }, [
          h(Panel, { title: "Масштабировать", eyebrow: "кандидаты на масштабирование" },
            h(DecisionTable, { rows: summary?.scale_candidates || [] })
          ),
          h(Panel, { title: "Отключить", eyebrow: "кандидаты на отключение" },
            h(DecisionTable, { rows: summary?.kill_candidates || [] })
          ),
          h(Panel, { title: "Креативы на обновление", eyebrow: "снижение эффективности" },
            h(SimpleTable, {
              rows: summary?.creative_refresh || [],
              columns: [
                { key: "creative", label: "Креатив" },
                { key: "normalized_offer", label: "Оффер" },
                { key: "burnout_score", label: "Балл", numeric: true, format: number },
                { key: "action", label: "Действие", format: (value) => translate(CREATIVE_ACTION_RU, value) },
              ],
            })
          ),
          h(Panel, { title: "Проблемы трекинга", eyebrow: "качество трекинга" },
            h(SimpleTable, {
              rows: summary?.tracking_issues || [],
              columns: [
                { key: "issue", label: "Проблема", format: (value) => translate(ISSUE_RU, value) },
                { key: "severity", label: "Риск", format: (value) => translate(SEVERITY_RU, value) },
                { key: "offer", label: "Оффер" },
                { key: "clicks", label: "Клики", numeric: true, format: number },
              ],
            })
          ),
        ]),
      ]),
      ]) : null,
    ]),
    settingsOpen ? h(SettingsPanel, {
      settings,
      onToggleSection: toggleSection,
      onToggleKpi: toggleKpi,
      onClose: () => setSettingsOpen(false),
      key: "settings-panel",
    }) : null,
    refreshSettingsOpen ? h(KeitaroRefreshSettingsPanel, {
      settings: refreshSettings,
      saving: savingRefreshSettings,
      onSave: saveRefreshSettings,
      onClose: () => setRefreshSettingsOpen(false),
      key: "refresh-settings-panel",
    }) : null,
  ]),
  ]);
}

function currentRoute() {
  const clean = window.location.hash.replace(/^#\/?/, "");
  return clean || "dashboard";
}

if (!window.React || !window.ReactDOM) {
  document.getElementById("root").innerHTML = "<div class='shell'><div class='error'>React не загрузился. Проверь доступ к CDN unpkg.com.</div></div>";
} else {
  ReactDOM.createRoot(document.getElementById("root")).render(h(App));
}
