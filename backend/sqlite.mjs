import { DatabaseSync } from 'node:sqlite';
export function sqliteDatabase(path) {
  const database = new DatabaseSync(path);
  database.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  function statement(sql, values = []) {
    return {
      bind(...args) { return statement(sql, args); },
      async first() { return database.prepare(sql).get(...values) ?? null; },
      async all() { return { results: database.prepare(sql).all(...values) }; },
      async run() { return { meta: { changes: database.prepare(sql).run(...values).changes } }; },
    };
  }
  return {
    prepare: statement,
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try { const result = []; for (const s of statements) result.push(await s.run()); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    exec: sql => database.exec(sql), close: () => database.close(),
  };
}
