/**
 * Adaptador sql.js con API compatible con el subconjunto de better-sqlite3
 * que usa LocalComida (prepare/get/all/run, exec, pragma, transaction).
 */
import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Stmt {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): RunResult;
}

export interface DbLike {
  prepare(sql: string): Stmt;
  exec(sql: string): void;
  pragma(source: string): void;
  transaction<T>(fn: () => T): () => T;
}

type SqlJsModule = Awaited<ReturnType<typeof initSqlJs>>;

let SQL: SqlJsModule | null = null;

async function loadSqlJs(): Promise<SqlJsModule> {
  if (SQL) return SQL;
  // sql-asm (Android) no necesita WASM; sql-wasm en desktop sí.
  try {
    SQL = await initSqlJs({
      locateFile: (file: string) => {
        if (process.env.LC_SQLJS_WASM) return process.env.LC_SQLJS_WASM;
        try {
          if (typeof __dirname !== "undefined") {
            return path.join(__dirname, file);
          }
        } catch {
          // ignore
        }
        return path.join(process.cwd(), file);
      },
    });
  } catch (err) {
    console.warn("[sqljs] locateFile falló, reintento sin locateFile", err);
    SQL = await initSqlJs();
  }
  return SQL;
}

class SqlJsStmt implements Stmt {
  constructor(
    private readonly database: SqlJsDatabase,
    private readonly sql: string,
  ) {}

  private withStatement<T>(params: unknown[], fn: (stmt: ReturnType<SqlJsDatabase["prepare"]>) => T): T {
    const stmt = this.database.prepare(this.sql);
    try {
      if (params.length > 0) {
        stmt.bind(params as never[]);
      }
      return fn(stmt);
    } finally {
      try {
        stmt.free();
      } catch {
        // ignore
      }
    }
  }

  get(...params: unknown[]): unknown {
    return this.withStatement(params, (stmt) => {
      if (!stmt.step()) return undefined;
      return stmt.getAsObject();
    });
  }

  all(...params: unknown[]): unknown[] {
    return this.withStatement(params, (stmt) => {
      const rows: unknown[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    });
  }

  run(...params: unknown[]): RunResult {
    return this.withStatement(params, (stmt) => {
      stmt.step();
      const changes = this.database.getRowsModified();
      const idStmt = this.database.prepare("SELECT last_insert_rowid() AS id");
      try {
        idStmt.step();
        const row = idStmt.getAsObject() as { id?: number };
        return { changes, lastInsertRowid: Number(row.id ?? 0) };
      } finally {
        idStmt.free();
      }
    });
  }
}

export class SqlJsDb implements DbLike {
  private persistTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: SqlJsDatabase,
    private readonly filePath: string,
  ) {
    this.persistTimer = setInterval(() => this.persist(), 5_000);
    if (typeof this.persistTimer === "object" && this.persistTimer && "unref" in this.persistTimer) {
      (this.persistTimer as NodeJS.Timeout).unref?.();
    }
    process.on("exit", () => this.persist());
  }

  prepare(sql: string): Stmt {
    return new SqlJsStmt(this.database, sql);
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  pragma(source: string): void {
    const trimmed = source.trim().replace(/;+$/, "");
    this.database.exec(`PRAGMA ${trimmed};`);
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.exec("BEGIN");
      try {
        const result = fn();
        this.exec("COMMIT");
        this.persist();
        return result;
      } catch (err) {
        try {
          this.exec("ROLLBACK");
        } catch {
          // ignore
        }
        throw err;
      }
    };
  }

  persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const data = this.database.export();
      fs.writeFileSync(this.filePath, Buffer.from(data));
    } catch (err) {
      console.error("[sqljs] persist failed", err);
    }
  }
}

export async function openSqlJsDatabase(filePath: string): Promise<SqlJsDb> {
  const sql = await loadSqlJs();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let database: SqlJsDatabase;
  if (fs.existsSync(filePath)) {
    const buf = fs.readFileSync(filePath);
    database = new sql.Database(new Uint8Array(buf));
  } else {
    database = new sql.Database();
  }
  return new SqlJsDb(database, filePath);
}
