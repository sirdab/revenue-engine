# Concepts

Shared domain vocabulary. Code and docs use these words with these meanings.

## Tenancy

### Workspace (tenant)
One customer's isolated CRM: its users, pipelines, deals, contacts, settings
and integrations. Stored in `tenants`; every other business table carries a
`tenant_id`. "Workspace" in the UI and API, "tenant" in the database and code.

### Sign-up
Creating a workspace: a tenant, its first admin, and a default pipeline with
five stages, in one transaction (`createWorkspace` in
`api-server/src/lib/tenants.ts`). The same path backs the bootstrap script.

### Tenant scope
Which tenant the current database work is bound to. A signed-in request is
bound to its user's tenant; an inbound webhook to the tenant its secret
belongs to. Work outside any scope sees nothing. See `CLAUDE.md` →
Multi-tenancy.

### System scope
The one scope that bypasses row-level security (`runAsSystem`). Used only
before a tenant is known (login, sign-up, password reset, resolving a webhook
secret) or to enumerate tenants in a background job.

## Sales

### Deal
An opportunity, sitting in exactly one stage of one pipeline, with a status of
open, won, lost or deleted. Archived deals are read-only until restored.

### Pipeline / stage
A pipeline is an ordered list of stages. Each stage has a win probability
(weights the forecast), an optional rotting threshold, and optional required
fields that must be filled before a deal can enter it. A pipeline can require
fields before a deal is marked won.

### Rotting
An open deal that has sat in its stage longer than the stage's rotting days.

### Custom field
A deal field defined in the field registry (`deal_field`), stored in
`deals.custom_fields` unless it maps a native column.

### Assignment rule
Picks a deal's owner when a deal is added or moves pipeline/stage. First
matching rule wins.

### Automation
"When a deal is added/updated and matches these conditions, do this": create
an activity, create a deal, call a webhook, send a Slack message, or post an
in-app notification to the rule's subscribers. All matching automations run, in
priority order.

### Claim
The first person to log an activity on a deal nobody has touched becomes its
owner.

## Activities

### Outcome
How a completed contact activity went: "successful" (they replied) or
"no_reply". Ticking planned work done writes "successful"; the "No reply"
action closes the attempt and opens a copy to reschedule.
