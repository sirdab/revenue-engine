# Sirdab Revenue Engine — Data Schema (for data mapping & import)

This document describes the full data schema so you (or an LLM) can map source data onto it. The backend is Postgres (via Drizzle ORM).

**Three conventions to know up front:**

- **Everything belongs to a workspace (tenant).** Every table below except `tenants`, `password_reset_tokens`, `link_previews` and `rate_limit_counters` has a `tenant_id` (→ tenants.id, ON DELETE CASCADE) and a row-level-security policy. Through the app you never set it: it defaults to the signed-in user's workspace, and rows of other workspaces are invisible. A direct database load must set `tenant_id` on every row and keep every reference inside one tenant (foreign keys do not check that).

- **DB columns are `snake_case`; the API/app uses `camelCase`.** Each field below lists the camelCase name (what you send to the API/import) with the DB column in parentheses.
- **System-managed fields** (ids, timestamps) are marked — do **not** supply them; the system fills them in.

---

## Load order (because of foreign keys)

Insert parents before children:

```
tenants → users → pipelines → stages → organizations → persons → deals → activities / notes
```

A deal **requires** a valid `pipelineId` + `stageId`, and (ideally) `ownerId` / `personId` / `organizationId` pointing at rows that already exist.

---

## Enums (allowed values — exact strings)

- **deal.status**: `open` | `won` | `lost` | `deleted` (default `open`)
- **activity.type**: `call` | `meeting` | `email` | `task` | `deadline` (default `task`)
- **change_source** (audit log only): `ui` | `import` | `api` | `automation`

---

## 1. organizations (companies)

| field (camelCase) | DB column | type | required | default | notes |
|---|---|---|---|---|---|
| id | id | integer | system | auto | PK, auto-generated |
| name | name | text | yes | `""` | company name |
| address | address | text | no | null | |
| ownerId | owner_id | integer | no | null | → users.id |
| labels | labels | text[] | no | null | label names; curated by the `labels` registry |
| addTime / updateTime | add_time / update_time | timestamptz | system | now() | auto |

```json
{ "name": "Acme Logistics", "address": "Austin, TX", "ownerId": 7 }
```

## 2. persons (contacts)

| field | DB column | type | required | default | notes |
|---|---|---|---|---|---|
| id | id | integer | system | auto | PK |
| name | name | text | yes | — | |
| phone | phone | text | no | null | |
| email | email | text | no | null | not unique |
| jobTitle | job_title | text | no | null | free text, e.g. "Operations Manager" |
| organizationId | organization_id | integer | no | null | → organizations.id |
| ownerId | owner_id | integer | no | null | → users.id |
| labels | labels | text[] | no | null | label names; curated by the `labels` registry |
| addTime / updateTime | add_time / update_time | timestamptz | system | now() | auto |

```json
{ "name": "Sara Ahmed", "email": "sara@acme.com", "phone": "+1 555 0100", "organizationId": 12, "ownerId": 7 }
```

## 3. deals (opportunities) — the main entity

| field | DB column | type | required | default | notes |
|---|---|---|---|---|---|
| id | id | integer | system | auto | PK |
| title | title | text | **yes** | — | |
| value | value | float | no | 0 | amount |
| currency | currency | text | no | `USD` | |
| status | status | enum | no | `open` | see enums |
| ownerId | owner_id | integer | no | null | → users.id |
| creatorUserId | creator_user_id | integer | no | null | → users.id (usually system) |
| personId | person_id | integer | no | null | → persons.id |
| organizationId | organization_id | integer | no | null | → organizations.id |
| pipelineId | pipeline_id | integer | **yes** | — | → pipelines.id |
| stageId | stage_id | integer | **yes** | — | → stages.id |
| visibleTo | visible_to | text | no | null | |
| lostReason | lost_reason | text | no | null | |
| comments | comments | text | no | null | |
| expectedCloseDate | expected_close_date | date `YYYY-MM-DD` | no | null | string date |
| utmSource | utm_source | text | no | null | ad attribution |
| utmMedium | utm_medium | text | no | null | ad attribution |
| utmCampaign | utm_campaign | text | no | null | ad attribution |
| utmKeyword | utm_keyword | text | no | null | ad attribution |
| adName | ad_name | text | no | null | ad attribution |
| gclid | gclid | text | no | null | Google click id |
| fbclid | fbclid | text | no | null | Facebook click id |
| wbraid | wbraid | text | no | null | iOS Google Ads click id (web-to-web; gclid replacement under ATT) |
| gbraid | gbraid | text | no | null | iOS Google Ads click id (app-to-web) |
| addTime | add_time | timestamptz | system | now() | auto |
| updateTime | update_time | timestamptz | system | now() | auto |
| stageChangeTime | stage_change_time | timestamptz | system | null | set on stage change |
| wonTime | won_time | timestamptz | system | null | set when won |
| lostTime | lost_time | timestamptz | system | null | set when lost |
| closeTime | close_time | timestamptz | system | null | set when closed |

```json
{
  "title": "Acme – annual plan",
  "value": 120000, "currency": "USD", "status": "open",
  "pipelineId": 3, "stageId": 14,
  "ownerId": 7, "personId": 45, "organizationId": 12,
  "expectedCloseDate": "2026-08-31"
}
```

## 4. activities (calls / meetings / tasks)

| field | DB column | type | required | default | notes |
|---|---|---|---|---|---|
| id | id | integer | system | auto | PK |
| subject | subject | text | **yes** | — | |
| type | type | enum | no | `task` | see enums |
| note | note | text | no | null | |
| done | done | boolean | no | false | |
| busy | busy | boolean | no | false | |
| dueDate | due_date | date `YYYY-MM-DD` | no | null | |
| dueTime | due_time | text | no | null | e.g. `"14:30"` (stored as text) |
| duration | duration | text | no | null | e.g. `"01:00"` (text) |
| markedAsDoneTime | marked_as_done_time | timestamptz | system | null | |
| dealId | deal_id | integer | no | null | → deals.id |
| personId | person_id | integer | no | null | → persons.id |
| **orgId** | org_id | integer | no | null | → organizations.id ⚠️ named `orgId` here, not `organizationId` |
| ownerId | owner_id | integer | no | null | → users.id |
| creatorUserId | creator_user_id | integer | no | null | → users.id |
| draft | draft | boolean | no | false | unpublished draft, visible only to its creator; excluded from all read paths unless `includeDrafts=true` |
| addTime / updateTime | add_time / update_time | timestamptz | system | now() | auto; `addTime` is reset to the post time when a draft is posted |

```json
{ "subject": "Discovery call", "type": "call", "dueDate": "2026-07-01", "dueTime": "10:00", "dealId": 1001, "personId": 45, "orgId": 12, "ownerId": 7 }
```

## 5. notes

| field | DB column | type | required | default | notes |
|---|---|---|---|---|---|
| id | id | integer | system | auto | PK |
| content | content | text | **yes** | — | |
| dealId | deal_id | integer | no | null | → deals.id |
| personId | person_id | integer | no | null | → persons.id |
| **orgId** | org_id | integer | no | null | → organizations.id ⚠️ |
| **userId** | user_id | integer | no | null | → users.id ⚠️ author is `userId` here |
| pinnedToDealFlag | pinned_to_deal_flag | boolean | no | false | |
| pinnedToPersonFlag | pinned_to_person_flag | boolean | no | false | |
| pinnedToOrganizationFlag | pinned_to_organization_flag | boolean | no | false | |
| activeFlag | active_flag | boolean | no | true | |
| draft | draft | boolean | no | false | unpublished draft, visible only to its creator; excluded from all read paths unless `includeDrafts=true` |
| addTime / updateTime | add_time / update_time | timestamptz | system | now() | auto; `addTime` is reset to the post time when a draft is posted |

## 6. pipelines (reference / config)

| field | DB column | type | required | notes |
|---|---|---|---|---|
| id | id | integer | system | PK, auto |
| name | name | text | yes | |
| wonRequiredFields | won_required_fields | text[] | no | deal-field keys that must be filled before a deal in this pipeline can be marked won (default `{}`) |

## 7. stages (reference / config — deals point here)

| field | DB column | type | required | default | notes |
|---|---|---|---|---|---|
| id | id | integer | system | auto | PK |
| name | name | text | yes | — | |
| pipelineId | pipeline_id | integer | **yes** | — | → pipelines.id |
| orderIndex | order_index | integer | no | 0 | left-to-right order |
| probability | probability | integer | no | 100 | 0–100, weights forecast |
| rottingDays | rotting_days | integer | no | null | idle days before "rotting"; null = never |
| requiredFields | required_fields | text[] | no | `{}` | deal-field keys required to enter this stage; **cumulative** — earlier stages' keys are inherited by later stages |

## 8. users (owners / reps)

| field | DB column | type | required | default | notes |
|---|---|---|---|---|---|
| id | id | integer | system | auto | PK |
| name | name | text | yes | — | |
| email | email | text | yes | — | **unique across all workspaces** (it identifies the workspace at sign-in) |
| passwordHash | password_hash | text | yes | — | hashed — create users via the app, not raw import |
| phone | phone | text | no | null | |
| roleId | role_id | integer | no | null | |
| isAdmin | is_admin | boolean | no | false | |
| activeFlag | active_flag | boolean | no | true | |
| defaultCurrency | default_currency | text | no | `USD` | |
| timezoneName | timezone_name | text | no | `UTC` | |
| created | created | timestamptz | system | now() | auto |
| lastLogin | last_login | timestamptz | system | null | |
| passwordChangedAt | password_changed_at | timestamptz | system | now() | auto |

---

## ⚠️ Field-naming gotchas (important when mapping)

1. The organization link is **`organizationId`** on persons and deals, but **`orgId`** on activities and notes.
2. On **notes**, the author field is **`userId`** (not `ownerId`).
3. `dueTime` and `duration` on activities are **text**, not time types (e.g. `"14:30"`, `"01:00"`).
4. Dates (`expectedCloseDate`, `dueDate`) are **`YYYY-MM-DD` strings**; timestamps are mostly system-managed — leave them out.
5. `tenant_id` is set from the session through the app; in a raw load it must be set explicitly and consistently.

## Not for import (system tables)

- `change_events` — immutable audit log, auto-written on every deal change.
- `deal_views` — saved filters.
- `password_reset_tokens` — auth internals.
- `labels` — admin-curated label registry (entity + name + color); label VALUES live as text[] on deals/persons/organizations, this table only styles/canonicalizes them.
- `lost_reasons` — managed lost-reason list offered when marking a deal lost; `deals.lost_reason` stays a plain string.
- `tenants` — the workspaces: `name`, unique `slug`. Deleting one cascades to every row it owns.
- `app_settings` — per-workspace key/value settings (primary key `(tenant_id, key)`): the inbound-webhook secret, the Slack connection, automation message chips.
- `automations` — admin-configured deal automations ("when X happens → do Y"): `trigger_event` (`deal_added` | `deal_updated`, text + CHECK), `conditions` (jsonb deals-filter `FilterGroup`, empty = match all), `action_type` (`create_activity` | `create_deal` | `call_webhook` | `send_slack_message` | `post_notification`, text + CHECK), `action_config` (jsonb, discriminated by `action_type`; pipeline/stage/user refs have no FKs — validated at save, re-checked at run time), `priority` (per-event order, lower first), `active`. All matching automations run, in priority order.
- `notifications` — in-app notifications (one row per recipient), currently created when a user is @-mentioned in a note or activity note (`data-mention="<userId>"` chips in the HTML content). Recipient is `user_id`, the note author is `actor_id`; `entity_type`/`entity_id` (`deal` | `person` | `organization`) drive the click-through link; `read_at` NULL = unread.
- `crm_files` — file attachment metadata for deals, plus comment attachments (`deal_id` **+** `note_id` → notes.id): name, category, size, uploader. The deal Documents card filters out rows with `note_id` set (those belong to a comment, not the deal). The binary itself lives in S3-compatible object storage, keyed by this row's `id` — nothing to import here.
- `note_reactions` — emoji reactions on posted comments: one row per (`note_id` → notes.id **ON DELETE CASCADE**, `user_id`, `emoji`), unique on that triple so add is idempotent. `emoji` holds a single unicode character from a server-curated set (never arbitrary client text). Not imported.
- `link_previews` — server-side cache of Open Graph metadata for URLs found in posted comments: `url` (unique), `status` (`ok` | `failed` for negative caching), `title`/`description`/`image_url`/`site_name`, `fetched_at` (drives TTL). Populated by the SSRF-hardened unfurler at post/edit time; never at render time. Not imported.

Archiving (on `deals.archived`): archived records are read-only and hidden from working views (pipelines, lists, board, search), visible via the Archived lens/tab, still counted by reporting endpoints, and restorable at any time — restoring changes nothing else.

You do not populate these.

---

## Importing

The app has a built-in CSV importer (**Admin → Import**) for **persons** and **deals** specifically, which auto-tags rows with `source = "import"`. For the other entities, use the API or a direct database load following the load order above.
