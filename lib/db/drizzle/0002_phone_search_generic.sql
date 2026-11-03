-- Phone search no longer assumes one country. The stored side of the match is
-- now just the digits with leading zeros dropped (which also removes an
-- international `00` and a trunk `0`); stripping a country code, if any, is
-- done on the search term only, from PHONE_COUNTRY_CODE. Kept byte-for-byte
-- identical to phoneDigitsSql() in api-server/src/lib/queries.ts.
DROP INDEX IF EXISTS "persons_phone_nsn_trgm";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "persons_phone_digits_trgm" ON "persons" USING gin ((ltrim(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g'), '0')) gin_trgm_ops);
