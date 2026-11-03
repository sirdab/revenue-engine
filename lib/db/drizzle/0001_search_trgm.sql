-- Search performance + format-insensitive phone matching.
--
-- pg_trgm gives GIN trigram indexes that accelerate substring search
-- (ILIKE '%term%'), which a btree index cannot. We add one per searched text
-- column across the CRM entities, plus a functional trigram index on the
-- normalized "national significant number" of a person's phone so that phone
-- lookups stay index-backed regardless of formatting. The functional
-- expression is kept byte-for-byte identical to phoneNsnSql() in
-- artifacts/api-server/src/lib/queries.ts.
--
-- All statements are idempotent (IF NOT EXISTS) and transaction-safe.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- Persons: name / email substring + normalized-phone (NSN) search.
CREATE INDEX IF NOT EXISTS "persons_name_trgm" ON "persons" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "persons_email_trgm" ON "persons" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "persons_phone_nsn_trgm" ON "persons" USING gin ((ltrim(regexp_replace(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g'), '^(00)?966', ''), '0')) gin_trgm_ops);--> statement-breakpoint

-- Organizations.
CREATE INDEX IF NOT EXISTS "organizations_name_trgm" ON "organizations" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_address_trgm" ON "organizations" USING gin ("address" gin_trgm_ops);--> statement-breakpoint

-- Deals (the OR-matched text fields in global search).
CREATE INDEX IF NOT EXISTS "deals_title_trgm" ON "deals" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_comments_trgm" ON "deals" USING gin ("comments" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_utm_keyword_trgm" ON "deals" USING gin ("utm_keyword" gin_trgm_ops);--> statement-breakpoint

-- Activities.
CREATE INDEX IF NOT EXISTS "activities_subject_trgm" ON "activities" USING gin ("subject" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_note_trgm" ON "activities" USING gin ("note" gin_trgm_ops);--> statement-breakpoint

-- Notes.
CREATE INDEX IF NOT EXISTS "notes_content_trgm" ON "notes" USING gin ("content" gin_trgm_ops);
