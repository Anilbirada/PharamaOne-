const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const { seedDemoData, verifyDatabaseIntegrity, cleanupDemoData, SEED_TAG } = require('../scripts/seed');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmaone-seeder-e2e-'));
const testDbFile = path.join(tempDir, 'db.json');
const seederTestDbFile = path.join(tempDir, 'seeder-db.json');

// Initialize with a baseline db containing 1 pre-existing medicine
const baseline = {
  medicines: [{
    id: 1,
    name: 'Pre-existing Paracetamol',
    generic: 'Paracetamol',
    brand: 'Base Brand',
    batch: 'BASE-01',
    expiry: '2028-12-31',
    price: 20,
    cost: 12,
    stock: 50,
    minStock: 10,
    barcode: 'BASE-11111'
  }],
  sales: [],
  transactions: [],
  customers: [],
  suppliers: [],
  purchases: [],
  returns: [],
  expenses: [],
  users: [],
  settings: { shopName: 'Existing Test Pharmacy', currency: 'INR', timeZone: 'UTC' },
  nextMedicineId: 2,
  nextSaleId: 1
};

fs.writeFileSync(testDbFile, JSON.stringify(baseline, null, 2), 'utf8');
fs.writeFileSync(seederTestDbFile, JSON.stringify(baseline, null, 2), 'utf8');
seedDemoData(testDbFile, 60);

// Start isolated test API server
let server;
let baseUrl;
let output = '';
let startupTimer;

const ready = new Promise((resolve, reject) => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: '0', PHARMAONE_DB_FILE: testDbFile },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.setEncoding('utf8');
  server.stderr.setEncoding('utf8');
  server.stdout.on('data', chunk => {
    output += chunk;
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) {
      clearTimeout(startupTimer);
      baseUrl = `http://localhost:${match[1]}`;
      resolve();
    }
  });
  server.stderr.on('data', chunk => { output += chunk; });
  server.once('error', reject);
  server.once('exit', code => {
    if (!baseUrl) reject(new Error(`API server exited before listening (${code}): ${output}`));
  });
  startupTimer = setTimeout(() => reject(new Error(`API server did not start in 15s: ${output}`)), 15000);
});

after(async () => {
  clearTimeout(startupTimer);
  if (server && server.exitCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve));
    server.kill();
    await stopped;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function api(path, options = {}) {
  await ready;
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json();
  return { status: res.status, ok: res.ok, data };
}

test('deterministic seeder populates 60 days of synthetic pharmacy transactions safely', () => {
  const seedResult = seedDemoData(seederTestDbFile, 60);
  assert.equal(seedResult.status, 'SEEDED_SUCCESSFULLY');
  assert.equal(seedResult.metrics.medicinesSeeded, 112);
  assert.ok(seedResult.metrics.suppliersSeeded >= 2);
  assert.ok(seedResult.metrics.salesInvoicesSeeded >= 1000);
  assert.ok(seedResult.metrics.returnsSeeded >= 10);
  assert.equal(seedResult.metrics.daysCount, 60);

  // Check pre-existing record is preserved
  const db = JSON.parse(fs.readFileSync(seederTestDbFile, 'utf8'));
  const preExisting = db.medicines.find(m => m.barcode === 'BASE-11111');
  assert.ok(preExisting, 'Pre-existing medicine must not be deleted or overwritten');
  assert.equal(preExisting.stock, 50);
});

test('seeder is strictly idempotent and does not create duplicate records on rerun', () => {
  const secondSeed = seedDemoData(seederTestDbFile, 60);
  assert.equal(secondSeed.status, 'IDEMPOTENT_SKIPPED');

  const verification = verifyDatabaseIntegrity(seederTestDbFile, 60);
  assert.equal(verification.verified, true);
  assert.equal(verification.errors.length, 0);
  assert.equal(verification.counts.seededMedicines, 112);
  assert.equal(verification.counts.medicines, 113); // 1 baseline + 112 demo
});

test('inventory reconciliation passes for all seeded products without negative stock', () => {
  const verification = verifyDatabaseIntegrity(seederTestDbFile, 60);
  assert.equal(verification.verified, true);
  assert.equal(verification.counts.reconciledProducts, 112);
  assert.ok(verification.analytics.netRevenue > 0);
  assert.ok(verification.analytics.grossProfit > 0);
  assert.equal(verification.analytics.costAvailable, true);
});

test('GET /api/summary returns populated live dashboard metrics', async () => {
  const { status, data } = await api('/api/summary');
  assert.equal(status, 200);
  assert.ok(data.medicineCount >= 110);
  assert.ok(data.stockUnits > 0);
  assert.ok(data.customerCount >= 12);
  assert.ok(data.supplierCount >= 4);
  assert.ok(data.lowStock >= 1);
});

test('GET /api/sales exposes the complete seeded invoice history', async () => {
  const { status, data } = await api('/api/sales');
  assert.equal(status, 200);
  assert.equal(data.length, 1389);
  assert.equal(data.filter(sale => sale.seedTag === SEED_TAG).length, 1389);
});

test('GET /api/analytics/sales for 60d period returns daily series, best sellers and margin', async () => {
  const { status, data } = await api('/api/analytics/sales?period=custom&from=' + encodeURIComponent(shiftDate(-59)) + '&to=' + encodeURIComponent(shiftDate(0)));
  assert.equal(status, 200);
  assert.ok(data.metrics.revenue > 0);
  assert.ok(data.metrics.transactions >= 1000);
  assert.ok(data.metrics.unitsSold > 0);
  assert.ok(data.metrics.grossProfit > 0);
  assert.ok(data.metrics.grossMarginPercent > 0);
  assert.equal(data.metrics.costAvailable, true);
  assert.equal(data.bestSellers.length, 10);
  assert.equal(data.dailySeries.length, 60);

  // Check 7-day stockout risk and expiry alerts
  assert.ok(data.metrics.stockoutRiskProducts >= 0);
  assert.ok(data.metrics.expiringProducts >= 0);
});

test('GET /api/reports/summary calculates net profit and accounts for expenses', async () => {
  const from = shiftDate(-59);
  const to = shiftDate(0);
  const { status, data } = await api(`/api/reports/summary?from=${from}&to=${to}`);
  assert.equal(status, 200);
  assert.ok(data.revenue > 0);
  assert.ok(data.cogs > 0);
  assert.ok(data.grossMargin > 0);
  assert.ok(data.expenseTotal > 0);
  assert.equal(typeof data.estimatedNet, 'number');
  assert.ok(data.topMedicines.length > 0);
});

test('GET /api/notifications returns low stock and approaching expiry alerts', async () => {
  const { status, data } = await api('/api/notifications');
  assert.equal(status, 200);
  assert.ok(Array.isArray(data));
  assert.ok(data.some(n => n.type === 'LOW_STOCK'));
  assert.ok(data.some(n => n.type === 'EXPIRY'));
});

test('cleanup command removes only demo-tagged records and preserves baseline data', () => {
  const cleanupResult = cleanupDemoData(seederTestDbFile);
  assert.equal(cleanupResult.status, 'CLEANED_SUCCESSFULLY');
  assert.equal(cleanupResult.removed.medicines, 112);
  assert.ok(cleanupResult.removed.sales >= 1000);
  assert.ok(cleanupResult.removed.returns >= 10);

  const db = JSON.parse(fs.readFileSync(seederTestDbFile, 'utf8'));
  assert.equal(db.medicines.length, 1);
  assert.equal(db.medicines[0].name, 'Pre-existing Paracetamol');
  assert.equal(db.sales.length, 0);
  assert.equal(db.returns.length, 0);
  assert.equal(db.purchases.length, 0);
  assert.deepEqual(db.settings, baseline.settings);
});

function shiftDate(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
