const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
require('dotenv').config({ quiet: true });

const migrationsDirectory = path.join(__dirname, '..', 'db', 'migrations');
const migrationNamePattern = /^\d{3}_[a-z0-9_-]+\.sql$/;

function assertSafeMigrationTarget(connectionString) {
  if (!connectionString) {
    throw new Error('MIGRATION_DATABASE_URL is not configured in the ignored local .env file.');
  }

  let connection;
  try {
    connection = new URL(connectionString);
  } catch {
    throw new Error('MIGRATION_DATABASE_URL must be a valid PostgreSQL URL.');
  }

  let database;
  try {
    database = decodeURIComponent(connection.pathname.slice(1));
  } catch {
    throw new Error('MIGRATION_DATABASE_URL must be a valid PostgreSQL URL.');
  }

  const host = connection.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || database !== 'pharmaone_test') {
    throw new Error('Migrations are restricted to a local database named pharmaone_test.');
  }

  return connectionString;
}

function migrationConnectionString() {
  return assertSafeMigrationTarget(process.env.MIGRATION_DATABASE_URL);
}

async function migrate() {
  const client = new Client({ connectionString: migrationConnectionString() });
  await client.connect();

  try {
    const identity = await client.query(
      'SELECT current_database() AS database, inet_server_addr()::text AS address'
    );
    if (identity.rows[0].database !== 'pharmaone_test' ||
        !['127.0.0.1', '::1'].includes(identity.rows[0].address)) {
      throw new Error('Connected server is not the local pharmaone_test database.');
    }

    await client.query("SELECT pg_advisory_lock(hashtext('pharmaone:schema-migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const names = fs.readdirSync(migrationsDirectory)
      .filter(name => migrationNamePattern.test(name))
      .sort();
    const applied = await client.query('SELECT name, checksum FROM public.schema_migrations');
    const appliedByName = new Map(applied.rows.map(row => [row.name, row.checksum]));

    for (const name of names) {
      const sql = fs.readFileSync(path.join(migrationsDirectory, name), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const existingChecksum = appliedByName.get(name);
      if (existingChecksum) {
        if (existingChecksum !== checksum) {
          throw new Error(`Applied migration ${name} was modified; add a new migration instead.`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)',
          [name, checksum]
        );
        await client.query('COMMIT');
        console.log(`Applied ${name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log(`Database migrations verified (${names.length} file(s)).`);
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('pharmaone:schema-migrations'))")
      .catch(() => {});
    await client.end();
  }
}

if (require.main === module) {
  migrate().catch(error => {
    const detail = error.code ? ` (${error.code})` : '';
    console.error(`Database migration failed${detail}: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { assertSafeMigrationTarget };
