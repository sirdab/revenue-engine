import {
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Server-side cache of link-preview (Open Graph) metadata for URLs found in
// posted comments. Unfurling runs at post/edit time behind the SSRF layer in
// api-server/src/lib/link-preview.ts, never at render time.
//
// `url` is unique: every write is `ON CONFLICT (url) DO UPDATE` so two Fly
// instances unfurling the same URL concurrently never error — last-writer-wins
// is correct for a cache. URLs are capped (~2000 chars) by the caller before
// they reach this table (btree index safety + unfurl policy).
//
// `status` distinguishes a successful fetch ("ok") from a negative-cached
// failure ("failed") so a private-IP / dead / non-HTML URL isn't re-fetched on
// every render; `fetched_at` drives TTL (ok ~7d, failed ~1d) in the app layer.
export const linkPreviewsTable = pgTable("link_previews", {
  id: serial("id").primaryKey(),
  url: text("url").notNull().unique(),
  status: text("status").notNull(),
  title: text("title"),
  description: text("description"),
  imageUrl: text("image_url"),
  siteName: text("site_name"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertLinkPreviewSchema = createInsertSchema(
  linkPreviewsTable,
).omit({
  id: true,
  fetchedAt: true,
});
export type InsertLinkPreview = z.infer<typeof insertLinkPreviewSchema>;
export type LinkPreview = typeof linkPreviewsTable.$inferSelect;
