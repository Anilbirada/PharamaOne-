const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { assertSafeMigrationTarget } = require('../scripts/migrate');

const migrationPath = path.join(__dirname, '..', 'db', 'migrations', '001_initial_schema.sql');

test('migration runner only permits the local pharmaone_test database', () => {
  for (const connectionString of [
    undefined,
    'not a URL',
    'postgresql://user:secret@example.com/pharmaone_test',
    'postgresql://user:secret@127.0.0.1/postgres',
    'postgresql://user:secret@localhost/pharmaone_test%2Fproduction'
  ]) {
    assert.throws(() => assertSafeMigrationTarget(connectionString));
  }

  const local = 'postgresql://user:secret@127.0.0.1:5432/pharmaone_test';
  assert.equal(assertSafeMigrationTarget(local), local);
  assert.equal(
    assertSafeMigrationTarget('postgresql://user:secret@[::1]:5432/pharmaone_test'),
    'postgresql://user:secret@[::1]:5432/pharmaone_test'
  );
});

test('initial schema defines pharmacy-owned data and row-level isolation policies', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const tenantTables = [
    'users', 'sessions', 'customers', 'suppliers', 'products',
    'medicine_batches', 'purchases', 'purchase_items', 'sales',
    'sale_items', 'payments', 'returns', 'return_items',
    'stock_movements', 'expenses', 'pharmacy_settings', 'audit_logs'
  ];

  for (const table of tenantTables) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table} \\(`));
  }
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /current_setting\(''app\.pharmacy_id'', true\)/);
  assert.match(sql, /CREATE POLICY pharmacy_isolation/);
  assert.match(sql, /numeric\(14,2\)/);
  assert.match(sql, /UNIQUE \(pharmacy_id, idempotency_key\)/);
});

test('initial schema applies and row-level security separates pharmacy records', async () => {
  const database = new PGlite();
  try {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await database.exec(sql);
    await database.exec(`
      INSERT INTO pharmacies (id, name, slug) VALUES
        ('00000000-0000-0000-0000-000000000001', 'Pharmacy A', 'pharmacy-a'),
        ('00000000-0000-0000-0000-000000000002', 'Pharmacy B', 'pharmacy-b');
      INSERT INTO products (pharmacy_id, name, selling_price) VALUES
        ('00000000-0000-0000-0000-000000000001', 'A Product', 10),
        ('00000000-0000-0000-0000-000000000002', 'B Product', 20);
      SET ROLE pharmaone_app;
    `);

    const noTenant = await database.query('SELECT name FROM products');
    assert.deepEqual(noTenant.rows, []);
    await database.query(
      "SELECT set_config('app.pharmacy_id', $1, false)",
      ['00000000-0000-0000-0000-000000000001']
    );
    const pharmacyA = await database.query('SELECT name FROM products ORDER BY name');
    assert.deepEqual(pharmacyA.rows.map(row => row.name), ['A Product']);
    await assert.rejects(
      database.query(
        'INSERT INTO products (pharmacy_id, name, selling_price) VALUES ($1, $2, $3)',
        ['00000000-0000-0000-0000-000000000002', 'Cross-tenant write', 1]
      ),
      /row-level security/i
    );
    await database.query(
      "SELECT set_config('app.pharmacy_id', $1, false)",
      ['00000000-0000-0000-0000-000000000002']
    );
    const pharmacyB = await database.query('SELECT name FROM products ORDER BY name');
    assert.deepEqual(pharmacyB.rows.map(row => row.name), ['B Product']);
    const immutableAuditTrigger = await database.query(`
      SELECT count(*)::int AS count
      FROM pg_trigger
      WHERE tgname = 'audit_logs_immutable' AND NOT tgisinternal
    `);
    assert.equal(immutableAuditTrigger.rows[0].count, 1);
    const appRole = await database.query(`
      SELECT rolcanlogin, rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = 'pharmaone_app'
    `);
    assert.deepEqual(appRole.rows[0], {
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false
    });
    await database.query(
      "SELECT set_config('app.pharmacy_id', $1, false)",
      ['00000000-0000-0000-0000-000000000001']
    );
    await database.query(
      `INSERT INTO audit_logs (pharmacy_id, action, entity_type)
       VALUES ($1, 'test', 'product')`,
      ['00000000-0000-0000-0000-000000000001']
    );
    await assert.rejects(
      database.query(`UPDATE audit_logs SET action = 'tampered' WHERE action = 'test'`),
      /immutable/i
    );
  } finally {
    await database.close();
  }
});
