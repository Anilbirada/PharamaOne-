const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmaone-api-'));
const dbFile = path.join(tempDir, 'db.json');
const fixture = {
  medicines: [{
    id: 1,
    name: 'Test Medicine',
    generic: 'Test',
    brand: 'Test Labs',
    batch: 'TEST-1',
    expiry: '2030-12-31',
    price: 10,
    cost: 6,
    stock: 10,
    minStock: 2,
    barcode: 'TEST-1'
  }],
  sales: [],
  transactions: [],
  customers: [{ id: 3, name: 'Existing Customer' }]
};

fs.writeFileSync(dbFile, `\uFEFF${JSON.stringify(fixture)}`, 'utf8');

let server;
let baseUrl;
let output = '';
let startupTimer;
const ready = new Promise((resolve, reject) => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: '0', PHARMAONE_DB_FILE: dbFile },
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
  startupTimer = setTimeout(() => reject(new Error(`API server did not start: ${output}`)), 5000);
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

async function request(route, options) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const payload = await response.json();
  return { status: response.status, payload };
}

async function stockOf(id) {
  const medicines = await request('/api/medicines');
  return medicines.payload.find(medicine => medicine.id === id).stock;
}

function post(data) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

test('API starts with BOM-prefixed data and preserves existing IDs', async () => {
  await ready;
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.payload.ok, true);
  assert.equal(health.payload.storage, 'json-file');

  const medicines = await request('/api/medicines');
  assert.equal(medicines.status, 200);
  assert.equal(medicines.payload.length, 1);

  const customer = await request('/api/customers', post({ name: 'New Customer' }));
  assert.equal(customer.status, 201);
  assert.equal(customer.payload.id, 4);
});

test('dashboard and reports default to the India business timezone', async () => {
  await ready;
  const settings = await request('/api/settings');
  assert.equal(settings.status, 200);
  assert.equal(settings.payload.timeZone, 'Asia/Kolkata');

  const analytics = await request('/api/analytics/sales?period=today');
  assert.equal(analytics.status, 200);
  assert.equal(analytics.payload.timeZone, 'Asia/Kolkata');

  const report = await request('/api/reports/summary');
  assert.equal(report.status, 200);
  assert.equal(report.payload.timeZone, 'Asia/Kolkata');
  const indiaToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  assert.equal(report.payload.to, indiaToday);
});

test('malformed JSON is rejected as a client error', async () => {
  await ready;
  const invalid = await request('/api/medicines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{'
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.error, 'Invalid JSON request body.');
});

test('sales aggregate repeated medicine lines before checking or deducting stock', async () => {
  await ready;
  const rejected = await request('/api/sales', post({
    items: [{ medicineId: 1, quantity: 6 }, { medicineId: 1, quantity: 5 }]
  }));
  assert.equal(rejected.status, 409);
  assert.equal((await request('/api/medicines')).payload.find(medicine => medicine.id === 1).stock, 10);

  const accepted = await request('/api/sales', post({
    items: [{ medicineId: 1, quantity: 2 }, { medicineId: 1, quantity: 1 }]
  }));
  assert.equal(accepted.status, 201);
  assert.equal(accepted.payload.items.length, 1);
  assert.equal(accepted.payload.items[0].quantity, 3);
  assert.equal(await stockOf(1), 7);
});

test('returns aggregate repeated lines and enforce the remaining sold quantity', async () => {
  await ready;
  const sale = (await request('/api/sales')).payload[0];
  const rejected = await request('/api/returns', post({
    saleId: sale.id,
    items: [{ medicineId: 1, quantity: 2 }, { medicineId: 1, quantity: 2 }]
  }));
  assert.equal(rejected.status, 400);
  assert.equal(await stockOf(1), 7);

  const accepted = await request('/api/returns', post({
    saleId: sale.id,
    items: [{ medicineId: 1, quantity: 2 }, { medicineId: 1, quantity: 1 }]
  }));
  assert.equal(accepted.status, 201);
  assert.equal(accepted.payload.items.length, 1);
  assert.equal(accepted.payload.items[0].quantity, 3);
  assert.equal(await stockOf(1), 10);

  const extra = await request('/api/returns', post({
    saleId: sale.id,
    items: [{ medicineId: 1, quantity: 1 }]
  }));
  assert.equal(extra.status, 400);
  assert.equal((await request('/api/returns')).payload.length, 1);
});

test('medicine creation rejects invalid monetary, quantity and expiry inputs', async () => {
  await ready;
  const invalid = await request('/api/medicines', post({
    name: 'Invalid Medicine',
    price: 5,
    cost: 'not-a-number',
    stock: 1,
    minStock: 0,
    expiry: '2030-02-30'
  }));
  assert.equal(invalid.status, 400);
  assert.equal((await request('/api/medicines')).payload.length, 1);

  const expired = await request('/api/medicines', post({
    name: 'Expired Test Medicine',
    price: 5,
    cost: 2,
    stock: 2,
    minStock: 0,
    expiry: '2020-01-01',
    barcode: 'EXPIRED-1'
  }));
  assert.equal(expired.status, 201);
  const expiredSale = await request('/api/sales', post({
    items: [{ medicineId: expired.payload.id, quantity: 1 }]
  }));
  assert.equal(expiredSale.status, 409);

  const duplicateBarcode = await request(`/api/medicines/${expired.payload.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barcode: 'TEST-1' })
  });
  assert.equal(duplicateBarcode.status, 409);
  assert.equal((await request(`/api/medicines/${expired.payload.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiry: '2030-02-30' })
  })).status, 400);
});

test('purchase receiving changes stock only for accepted quantities', async () => {
  await ready;
  const supplier = await request('/api/suppliers', post({ name: 'Test Supplier' }));
  assert.equal(supplier.status, 201);

  const purchase = await request('/api/purchases', post({
    supplierId: supplier.payload.id,
    supplier: supplier.payload.name,
    items: [{ medicineId: 1, quantity: 4, cost: 4 }]
  }));
  assert.equal(purchase.status, 201);
  assert.equal(purchase.payload.status, 'ORDERED');
  assert.equal(await stockOf(1), 10);

  const partial = await request('/api/purchases/receive', post({
    purchaseId: purchase.payload.id,
    items: [{ medicineId: 1, quantity: 2 }]
  }));
  assert.equal(partial.status, 200);
  assert.equal(partial.payload.status, 'PARTIALLY_RECEIVED');
  assert.equal((await request('/api/medicines')).payload.find(medicine => medicine.id === 1).stock, 12);

  const received = await request('/api/purchases/receive', post({
    purchaseId: purchase.payload.id,
    items: [{ medicineId: 1, quantity: 2 }]
  }));
  assert.equal(received.payload.status, 'RECEIVED');
  assert.equal((await request('/api/medicines')).payload.find(medicine => medicine.id === 1).stock, 14);

  const overReceipt = await request('/api/purchases/receive', post({
    purchaseId: purchase.payload.id,
    items: [{ medicineId: 1, quantity: 1 }]
  }));
  assert.equal(overReceipt.status, 400);
  assert.equal((await request('/api/medicines')).payload.find(medicine => medicine.id === 1).stock, 14);
});

test('credit payments, expenses, settings and reports persist through the API', async () => {
  await ready;
  const creditSale = await request('/api/sales', post({
    items: [{ medicineId: 1, quantity: 2 }],
    paymentMode: 'CREDIT',
    customerId: 4
  }));
  assert.equal(creditSale.status, 201);
  assert.equal(creditSale.payload.balance, 20);

  const overPayment = await request('/api/sales/payment', post({
    saleId: creditSale.payload.id,
    amount: 21
  }));
  assert.equal(overPayment.status, 400);

  const payment = await request('/api/sales/payment', post({
    saleId: creditSale.payload.id,
    amount: 10,
    mode: 'UPI'
  }));
  assert.equal(payment.status, 200);
  assert.equal(payment.payload.balance, 10);

  const expense = await request('/api/expenses', post({
    title: 'Test expense',
    amount: 15,
    date: new Date().toISOString().slice(0, 10)
  }));
  assert.equal(expense.status, 201);
  const invalidExpenseDate = await request('/api/expenses', post({
    title: 'Invalid date expense',
    amount: 15,
    date: '2030-02-30'
  }));
  assert.equal(invalidExpenseDate.status, 400);

  const settings = await request('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shopName: 'Integration Test Pharmacy' })
  });
  assert.equal(settings.status, 200);
  assert.equal((await request('/api/settings')).payload.shopName, 'Integration Test Pharmacy');
  const invalidTimeZone = await request('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeZone: 'Not/A_Timezone' })
  });
  assert.equal(invalidTimeZone.status, 400);
  const storedTimeZone = await request('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeZone: 'Asia/Kolkata' })
  });
  assert.equal(storedTimeZone.payload.timeZone, 'Asia/Kolkata');

  const summary = await request('/api/summary');
  assert.equal(summary.status, 200);
  assert.equal(summary.payload.outstanding, 10);
  const report = await request('/api/reports/summary');
  assert.equal(report.status, 200);
  assert.equal(report.payload.expenseTotal, 15);
  assert.equal(report.payload.salesCount, 2);
  assert.equal(report.payload.revenue, 20);
  assert.equal(report.payload.cogs, 8);
  assert.equal(report.payload.grossMargin, 12);
  assert.equal(report.payload.grossMarginPercent, 60);
  assert.equal(report.payload.estimatedNet, -3);
  assert.equal(report.payload.topMedicines[0].quantity, 2);
  const invalidRange = await request('/api/reports/summary?from=2030-01-02&to=2030-01-01');
  assert.equal(invalidRange.status, 400);
  const invalidReportTimeZone = await request('/api/reports/summary?timeZone=Not/A_Timezone');
  assert.equal(invalidReportTimeZone.status, 400);
});

test('sales analytics endpoint returns timezone-scoped, return-adjusted dashboard metrics', async () => {
  await ready;
  const analytics = await request('/api/analytics/sales?period=today&timeZone=UTC&sort=profit');
  assert.equal(analytics.status, 200);
  assert.equal(analytics.payload.timeZone, 'UTC');
  assert.equal(analytics.payload.metrics.revenue, 20);
  assert.equal(analytics.payload.metrics.transactions, 2);
  assert.equal(analytics.payload.metrics.unitsSold, 2);
  assert.equal(analytics.payload.metrics.cogs, 8);
  assert.equal(analytics.payload.metrics.grossProfit, 12);
  assert.equal(analytics.payload.metrics.grossMarginPercent, 60);
  assert.equal(analytics.payload.bestSellers[0].name, 'Test Medicine');
  assert.equal(analytics.payload.bestSellers[0].unitsSold, 2);
  assert.equal(analytics.payload.hourly.length, 24);
  assert.equal((await request('/api/analytics/sales?period=invalid')).status, 400);
  assert.equal((await request('/api/analytics/sales?period=today&timeZone=Not/A_Timezone')).status, 400);
  assert.equal((await request('/api/analytics/sales?period=custom&from=2026-02-30&to=2026-03-01')).status, 400);
});
