import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Managed lost reasons — the curated list offered when a deal is marked lost.
//
// deals.lost_reason stays a plain string: picking a managed reason stores its
// name, and reps can still enter a one-off custom reason. The admin page
// surfaces custom strings found on deals as "unmanaged" so they can be
// promoted into this list. Renaming a reason rewrites matching deal strings
// (fixing typos retroactively keeps reporting consistent); deleting one leaves
// history untouched. `active=false` archives a reason (hidden from the picker,
// kept for reporting).

export const lostReasonsTable = pgTable(
  "lost_reasons",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    orderIndex: integer("order_index").notNull().default(0),
    addTime: timestamp("add_time", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updateTime: timestamp("update_time", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("lost_reasons_name_uq").on(sql`lower(${table.name})`),
  ],
);

export const insertLostReasonSchema = createInsertSchema(
  lostReasonsTable,
).omit({ id: true, addTime: true, updateTime: true });
export type InsertLostReason = z.infer<typeof insertLostReasonSchema>;
export type LostReason = typeof lostReasonsTable.$inferSelect;
