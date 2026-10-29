import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Role } from '@/lib/rbac';

/**
 * Database access layer.
 *
 * The platform runs on an embedded PostgreSQL instance (PGlite). A single
 * connection is shared by the whole Node process, therefore:
 *   - every unit of work acquires a process-wide mutex (PGlite cannot run
 *     interleaved transactions on one connection);
 *   - request-scoped work executes inside a transaction that switches to the
 *     non-superuser role `ficap_app` and publishes the caller's visibility
 *     scope as session variables. Row level security policies then enforce
 *     institution isolation even if an application-layer check is missed.
 */

export type AccessScope = {
  userId: string | null;
  role: Role | null;
  institutionIds: string[];
  /** true only when RBAC has already granted a cross-institution permission */
  crossInstitution: boolean;
  requestId?: string;
  ip?: string;
  mode?: 'demo' | 'live';
};

export type Row = Record<string, any>;

export interface Tx {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Row>(sql: string, params?: unknown[]): Promise<T | null>;
  exec(sql: string): Promise<void>;
  readonly kind: 'scoped' | 'system';
}

type GlobalWithDb = typeof globalThis & {
  __ficapDb?: PGlite;
  __ficapDbPromise?: Promise<PGlite>;
  __ficapLock?: Promise<void>;
  __ficapTx?: AsyncLocalStorage<Tx>;
};

const g = globalThis as GlobalWithDb;

function dataDir(): string {
  return path.resolve(process.env.FICAP_DATA_DIR || '.data/pglite');
}

export async function getDb(): Promise<PGlite> {
  if (g.__ficapDb) return g.__ficapDb;
  if (!g.__ficapDbPromise) {
    g.__ficapDbPromise = (async () => {
      const dir = dataDir();
      fs.mkdirSync(dir, { recursive: true });
      const db = await PGlite.create(dir);
      g.__ficapDb = db;
      return db;
    })();
  }
  return g.__ficapDbPromise;
}

export function txContext(): Tx | undefined {
  if (!g.__ficapTx) g.__ficapTx = new AsyncLocalStorage<Tx>();
  return g.__ficapTx.getStore();
}

/** Process-wide mutex so transactions never interleave on the single connection. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = g.__ficapLock ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  g.__ficapLock = previous.then(() => gate);
  return previous.then(async () => {
    try {
      return await fn();
    } finally {
      release();
    }
  });
}

function makeTx(db: PGlite, kind: Tx['kind']): Tx {
  return {
    kind,
    async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await db.query<T>(sql, params as any[]);
      return (result.rows ?? []) as T[];
    },
    async queryOne<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
      const rows = await this.query<T>(sql, params);
      return rows[0] ?? null;
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
  };
}

function sameScope(a: AccessScope | undefined, b: AccessScope): boolean {
  if (!a) return false;
  return (
    a.userId === b.userId &&
    a.role === b.role &&
    a.crossInstitution === b.crossInstitution &&
    a.institutionIds.slice().sort().join(',') === b.institutionIds.slice().sort().join(',')
  );
}

/**
 * Run `fn` inside a transaction restricted to `scope`.
 * Re-entrant for the same scope so composed services do not deadlock.
 */
export async function withScope<T>(scope: AccessScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const active = txContext();
  if (active) {
    if (active.kind === 'system') return fn(active);
    const activeScope = (active as any).__scope as AccessScope | undefined;
    if (sameScope(activeScope, scope)) return fn(active);
    throw new Error('withScope: cannot nest a transaction with a different access scope');
  }

  const db = await getDb();
  return withLock(async () => {
    await db.exec('BEGIN');
    const tx = makeTx(db, 'scoped');
    (tx as any).__scope = scope;
    try {
      await db.exec('SET LOCAL ROLE ficap_app');
      await db.query(`SELECT set_config('app.user_id', $1, true)`, [scope.userId ?? '']);
      await db.query(`SELECT set_config('app.role', $1, true)`, [scope.role ?? '']);
      await db.query(`SELECT set_config('app.institution_ids', $1, true)`, [scope.institutionIds.join(',')]);
      await db.query(`SELECT set_config('app.cross_institution', $1, true)`, [scope.crossInstitution ? '1' : '0']);
      const result = await g.__ficapTx!.run(tx, () => fn(tx));
      await db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        await db.exec('ROLLBACK');
      } catch {
        /* connection already reset */
      }
      throw error;
    }
  });
}

/**
 * Trusted internal transaction (migrations, authentication, the assessment
 * worker, audit append). Runs privileged and bypasses RLS, therefore every
 * caller must have performed its own authorisation decision.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const active = txContext();
  if (active) return fn(active);

  const db = await getDb();
  return withLock(async () => {
    await db.exec('BEGIN');
    const tx = makeTx(db, 'system');
    try {
      const result = await g.__ficapTx!.run(tx, () => fn(tx));
      await db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        await db.exec('ROLLBACK');
      } catch {
        /* noop */
      }
      throw error;
    }
  });
}

/** Convenience: scoped read returning rows. */
export async function scopedQuery<T = Row>(scope: AccessScope, sql: string, params: unknown[] = []): Promise<T[]> {
  return withScope(scope, (tx) => tx.query<T>(sql, params));
}

export async function systemQuery<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  return withSystem((tx) => tx.query<T>(sql, params));
}

/** Close the embedded database (used by tests and graceful shutdown). */
export async function closeDb(): Promise<void> {
  if (g.__ficapDb) {
    await g.__ficapDb.close();
    g.__ficapDb = undefined;
    g.__ficapDbPromise = undefined;
  }
}

export function dbInfo() {
  return { dataDir: dataDir(), connected: Boolean(g.__ficapDb) };
}
