import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { pool } from "./pool";

export type Db = NodePgDatabase<typeof schema>;

// ---------------------------------------------------------------------------
// Tenant binding
//
// Row-level security (see schema/tenants.ts) filters every tenant-scoped
// table by the connection's `app.tenant_id` setting. This module is the only
// place that sets it.
//
// Every query, in or out of a tenant context, checks a client out of the
// shared pool through a ScopedPool, and the ScopedPool stamps the client with
// the settings of the scope that checked it out before running anything. So a
// client can never carry one tenant's setting into another tenant's query,
// and work that outlives its request (a fire-and-forget notification) still
// runs as the tenant that started it, because the scope travels with the
// AsyncLocalStorage context rather than with a held connection.
//
// Outside any scope, queries run with no tenant and no bypass: RLS then shows
// nothing and rejects every insert, which is the safe failure.
// ---------------------------------------------------------------------------

interface Scope {
  /** null in the neutral scope and in the system scope. */
  tenantId: number | null;
  /** Bypasses RLS. Only runAsSystem() sets it. */
  system: boolean;
}

const NEUTRAL: Scope = { tenantId: null, system: false };
const SYSTEM: Scope = { tenantId: null, system: true };

const scopeKey = (s: Scope) => (s.system ? "system" : `t:${s.tenantId ?? ""}`);

// The scope a pooled client was last stamped with, so a client reused by the
// same scope skips the extra round trip.
const stamped = new WeakMap<pg.PoolClient, string>();

class ScopedPool extends pg.Pool {
  constructor(
    private readonly base: pg.Pool,
    private readonly scope: Scope,
  ) {
    // Never opens connections of its own; every checkout goes to `base`.
    super({ max: 1 });
  }

  override async connect(): Promise<pg.PoolClient> {
    const client = await this.base.connect();
    const key = scopeKey(this.scope);
    if (stamped.get(client) !== key) {
      try {
        await client.query(
          "select set_config('app.tenant_id', $1, false), set_config('app.bypass_rls', $2, false)",
          [
            this.scope.tenantId == null ? "" : String(this.scope.tenantId),
            this.scope.system ? "on" : "",
          ],
        );
      } catch (err) {
        client.release(err as Error);
        throw err;
      }
      stamped.set(client, key);
    }
    return client;
  }

  // @ts-expect-error -- only the promise form is used (by drizzle).
  override async query(...args: unknown[]): Promise<unknown> {
    const client = await this.connect();
    try {
      return await (client.query as (...a: unknown[]) => Promise<unknown>)(
        ...args,
      );
    } finally {
      client.release();
    }
  }
}

const dbs = new Map<string, Db>();
function dbFor(scope: Scope): Db {
  const key = scopeKey(scope);
  let d = dbs.get(key);
  if (!d) {
    d = drizzle(new ScopedPool(pool, scope) as unknown as pg.Pool, { schema });
    dbs.set(key, d);
  }
  return d;
}

const storage = new AsyncLocalStorage<Scope>();

/**
 * The application's database handle. Resolves, per call, to the database of
 * the current scope: the request's tenant, the system scope, or the neutral
 * scope (sees nothing) when neither is set.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const target = dbFor(storage.getStore() ?? NEUTRAL);
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

/** Run `fn` with every query bound to `tenantId`. */
export function runWithTenant<T>(tenantId: number, fn: () => T): T {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`Invalid tenant id: ${tenantId}`);
  }
  return storage.run({ tenantId, system: false }, fn);
}

/**
 * Run `fn` with row-level security bypassed. Only for code that precedes a
 * tenant (login, sign-up, password reset) or deliberately spans tenants (a
 * scanner listing the tenants it should visit). Never wrap request handling
 * for a signed-in user in this.
 */
export function runAsSystem<T>(fn: () => T): T {
  return storage.run(SYSTEM, fn);
}

/** The current tenant, or null outside a tenant scope. */
export function currentTenantId(): number | null {
  return storage.getStore()?.tenantId ?? null;
}

/** The current tenant; throws outside a tenant scope. */
export function requireTenantId(): number {
  const id = currentTenantId();
  if (id == null) throw new Error("No tenant bound to this operation");
  return id;
}
