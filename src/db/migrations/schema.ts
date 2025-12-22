import pool from '../connection';

/**
 * Таблица для отслеживания версий схемы
 */
export async function ensureSchemaMigrationsTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } finally {
    client.release();
  }
}

/**
 * Проверка, применена ли миграция
 */
export async function isMigrationApplied(version: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [version]
    );
    return result.rows.length > 0;
  } finally {
    client.release();
  }
}

/**
 * Отметить миграцию как примененную
 */
export async function markMigrationApplied(version: number, name: string) {
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
      [version, name]
    );
  } finally {
    client.release();
  }
}

/**
 * Получить список всех примененных миграций
 */
export async function getAppliedMigrations(): Promise<Array<{ version: number; name: string; applied_at: Date }>> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT version, name, applied_at FROM schema_migrations ORDER BY version'
    );
    return result.rows.map(row => ({
      version: row.version,
      name: row.name,
      applied_at: row.applied_at
    }));
  } finally {
    client.release();
  }
}


