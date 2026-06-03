# GPT traffic analytics assistant

## Goal

Add a read-only GPT assistant that can answer traffic questions from bot and Keitaro data.

Example questions:

- best accounts yesterday;
- worst accounts for the last 7 days;
- best/worst creatives by ROI, profit, CPA, CPI, regs, deps;
- sub5 groups with spend but no installs;
- sub5 groups with installs but no regs;
- sub5 groups with regs but no deps;
- compare today vs yesterday for buyer `kkid`;
- explain where the funnel breaks.

## Data Sources

The assistant should not query raw databases directly. The bot should expose bounded analytical tools/functions, and GPT should call those tools.

Primary data sources:

- bot database: spend imports, account ids, source campaign names, expense routing status, saved mappings;
- Keitaro API: clicks, campaign unique clicks, conversions, leads, sales, revenue;
- optional ad account APIs later: creative metadata, campaign status, account status.

## Install Definition

For this project:

```text
install = campaign_unique_clicks in the main buyer campaign group
```

For buyer `kkid`, installs are unique clicks in the main `kkid` campaign group.

Important:

- installs are not clicks in `kkid for copies`;
- installs are not all raw clicks;
- installs should be shown in the same reporting block as regs and deps;
- installs are used as the first tracked step after spend reaches the app/main campaign layer.

Preferred Keitaro metric:

```text
campaign_unique_clicks
```

## Funnel

The default analytics funnel is:

```text
Spend -> Installs -> Regs -> Deps -> Revenue
```

Core metrics:

- `spend`;
- `installs`;
- `regs`;
- `deps`;
- `revenue`;
- `profit = revenue - spend`;
- `roi = profit / spend`;
- `cpi = spend / installs`;
- `cpl = spend / regs`;
- `cpa = spend / deps`;
- `install_to_reg = regs / installs`;
- `reg_to_dep = deps / regs`.

## Diagnostic Rules

GPT should explain not only which entity is good or bad, but also where the funnel breaks.

Typical patterns:

- spend exists, installs are zero: delivery, tracking, app opening, or mapping issue;
- installs exist, regs are zero or weak: app onboarding, offer, geo, or traffic quality issue;
- regs exist, deps are zero: traffic quality, payment, bonus, product, or delayed deposits issue;
- deps exist, ROI is negative: traffic is too expensive or revenue is too weak;
- high ROI on tiny volume: not enough data, do not overrate it.

## Safety Rules

- GPT analytics is read-only at first.
- GPT should not stop accounts, campaigns, or creatives automatically.
- GPT should receive aggregated rows, not full unrestricted database access.
- Every answer must include period and timezone.
- Best/worst rankings must use minimum volume filters.
- Pending/unmatched spend from the bot database should be visible in analytics.
- If data is missing, GPT should say what is missing instead of guessing.

## Initial Bot Changes

The bot should include `installs` in:

- `/find` search by sub5;
- sub5 CSV reports;
- account CSV reports;
- account performance reports;
- account trend reports.

