# GPT expense routing for Keitaro campaigns

## Context

In the bot we need to route ad spend to the correct Keitaro campaign even when the spend source and the final traffic/result campaign are not the same campaign group.

Example for buyer `kkid`:

- `kkid для копий` - campaigns that receive Facebook clicks to the app/copy layer.
- `kkid` - main campaigns that receive users after install, registration, or deposit.

In most cases campaign names in these two groups differ only by a small suffix or marker used for copies. Therefore the bot can use GPT to match the copy campaign to the main campaign and send spend to the main `kkid` campaign.

## Decision

Spend must always be stored in the bot database first. Keitaro is treated as a reporting destination, not the only source of truth.

The bot should route spend in this order:

1. Use an existing saved mapping if one exists.
2. Use deterministic matching rules if the source campaign id/name clearly maps to a target campaign.
3. Use GPT only for fuzzy matching between candidate campaigns.
4. Auto-send spend only when confidence is high.
5. Send uncertain cases to manual confirmation.
6. Keep unresolved cases as pending/unmatched spend in the bot database.

GPT should not directly write spend to Keitaro. It should return a structured routing suggestion that the bot validates.

## Routing Flow

For each incoming spend item:

1. Save the raw spend row to the bot database.
2. Identify buyer, traffic source, account, campaign name, campaign id, date, amount, currency, and timezone.
3. Search for an existing mapping:
   - source ad campaign id/name -> copy campaign;
   - copy campaign -> main Keitaro campaign;
   - source ad campaign id/name -> main Keitaro campaign.
4. If mapping exists, send spend to the mapped main campaign.
5. If mapping does not exist, build candidates:
   - first from `kkid для копий`;
   - then from the main `kkid` group;
   - only within the same buyer/context.
6. Normalize names before matching:
   - lowercase;
   - remove copy suffixes/markers;
   - remove duplicated separators;
   - normalize geo/app/platform/source tokens;
   - ignore minor punctuation differences.
7. Ask GPT to choose the best target campaign from the prepared candidate list.
8. Validate GPT response:
   - target campaign must exist;
   - target campaign must be in the expected main group;
   - buyer/context must match;
   - confidence must pass the configured threshold.
9. If accepted, send spend to Keitaro and save the mapping.
10. If not accepted, keep the spend row as `needs_confirmation` or `unmatched`.

## Confidence Rules

Suggested thresholds:

- `confidence >= 0.85` - auto-send to Keitaro and save mapping.
- `0.60 <= confidence < 0.85` - ask for manual confirmation.
- `confidence < 0.60` - keep as unmatched.

These thresholds can be adjusted after collecting real matching history.

GPT response should be strict JSON:

```json
{
  "status": "matched",
  "source_group": "kkid для копий",
  "matched_copy_campaign_id": 111,
  "matched_copy_campaign_name": "kkid_PL_android_123_copy",
  "target_group": "kkid",
  "target_campaign_id": 222,
  "target_campaign_name": "kkid_PL_android_123",
  "confidence": 0.94,
  "reason": "Names match after removing the copy suffix and buyer/geo/platform tokens are the same."
}
```

## No Clicks Case

If the main `kkid` campaign has no clicks for the spend period, this is not automatically an error.

Expected behavior:

1. If a reliable mapping exists, send spend to the mapped main campaign even when clicks are zero.
2. If Keitaro accepts campaign/date spend without clicks, the report should show spend with zero clicks/leads/revenue.
3. If Keitaro cannot accept the spend because there is no matching statistics row, keep the spend in the bot database with a failed/pending status.
4. If no reliable mapping exists and there are no clicks or other signals, do not guess. Mark the spend as `unmatched`.

The spend must not disappear just because Keitaro has no clicks.

## Suggested Bot Statuses

- `raw` - spend imported and saved, routing not started.
- `matched` - target campaign selected but not yet sent.
- `sent` - spend successfully sent to Keitaro.
- `needs_confirmation` - candidate found, but confidence is not high enough.
- `unmatched` - no reliable target campaign found.
- `send_failed` - target was selected, but Keitaro rejected or failed the write.

## Suggested Stored Fields

For each spend row:

- raw source payload;
- source account id/name;
- source campaign id/name;
- buyer;
- amount;
- currency;
- spend date and timezone;
- matched copy campaign id/name;
- target Keitaro campaign id/name;
- GPT confidence;
- GPT reason;
- status;
- Keitaro write response/error;
- created/updated timestamps.

For saved mappings:

- buyer;
- source account id;
- source campaign id/name;
- copy campaign id/name;
- target campaign id/name;
- matching method: `manual`, `rule`, `gpt`;
- confidence;
- confirmation user, if manual;
- created/updated timestamps.

## Safety Rules

- GPT can suggest a route, but the bot validates it before any write.
- GPT should receive a bounded candidate list, not the full unrestricted campaign database.
- Auto-routing is allowed only inside the expected buyer and campaign groups.
- Ambiguous matches should ask for confirmation.
- Confirmed manual matches should be saved and reused.
- All auto-routed spend should be auditable with reason and confidence.

## Implemented GPT Fallback

When regular `sub_id_5` lookup cannot find a campaign in the target group, the bot can use GPT as a fallback.

Runtime settings:

- `OPENAI_API_KEY` or `/set openai_key sk-...`;
- `OPENAI_MODEL` or `/set openai_model gpt-4o-mini`;
- `GPT_COST_ROUTING_ENABLED` or `/set gpt_cost_routing on`;
- `GPT_COST_ROUTING_MIN_CONFIDENCE` or `/set gpt_cost_confidence 0.85`;
- `GPT_COST_ROUTING_CANDIDATE_LIMIT` or `/set gpt_cost_candidate_limit 40`.

The fallback flow:

1. The bot first tries the existing deterministic Keitaro lookup by `sub_id_5`.
2. If the target group has no matching campaign, the bot loads campaign candidates from Keitaro `/admin_api/v1/campaigns`.
3. Candidates are filtered to the expected target group, for example `kkid`.
4. GPT receives only the spend row, source campaigns found by clicks, and the bounded target candidate list.
5. GPT returns structured JSON with `target_campaign_id`, `confidence`, and `reason`.
6. The bot accepts the route only if the campaign id exists in the candidate list and confidence is at least the configured threshold.
7. Low-confidence matches stay in `ambiguousRows`; no-match rows stay in `unresolvedRows`.

## Example

Incoming Facebook spend:

```text
buyer: kkid
source_campaign: kkid_PL_android_123_copy
amount: 120 USD
date: 2026-05-28
```

Candidate in `kkid для копий`:

```text
kkid_PL_android_123_copy
```

Target in `kkid`:

```text
kkid_PL_android_123
```

Result:

```text
Spend is routed to the main kkid campaign.
The mapping is saved.
Future spend from the same source campaign is routed automatically.
```
