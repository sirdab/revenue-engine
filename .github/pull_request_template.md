**What this changes and why**

**How it was tested**

**Checklist**
- [ ] `pnpm run typecheck` and `pnpm run test` pass
- [ ] API change: edited `lib/api-spec/openapi.yaml` and ran `pnpm codegen` (no hand edits under `generated/`)
- [ ] Schema change: ran `pnpm --filter @workspace/db run generate` and committed the migration
- [ ] New table: followed `lib/db/MIGRATIONS.md` (tenant_id + RLS policy)
- [ ] New UI strings go through i18n, in both `en.json` and `ar.json`
