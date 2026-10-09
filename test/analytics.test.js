const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assertTimeZone, buildSalesAnalytics, resolveRange } = require('../analytics');

function fixture() {
  return {
    medicines: [
      { id: 1, name: 'Alpha', barcode: 'A-1', stock: 12, minStock: 2, expiry: '2030-01-01' },
      { id: 2, name: 'Beta', barcode: 'B-2', stock: 1, minStock: 3, expiry: '2030-01-01' },
      { id: 3, name: 'Gamma', barcode: 'G-3', stock: 20, minStock: 4, expiry: '2030-01-01' }
    ],
    sales: [
      {
        id: 1,
        date: '2026-10-09T10:00:00.000Z',
        subtotal: 100,
        discount: 10,
        total: 90,
        items: [
          { medicineId: 1, name: 'Alpha', quantity: 2, unitCost: 10, lineTotal: 60 },
          { medicineId: 2, name: 'Beta', quantity: 1, unitCost: 10, lineTotal: 40 }
        ]
      },
      {
        id: 2,
        date: '2026-10-08T10:00:00.000Z',
        subtotal: 40,
        discount: 0,
        total: 40,
        items: [{ medicineId: 1, name: 'Alpha', quantity: 2, unitCost: 10, lineTotal: 40 }]
      },
      {
        id: 4,
        date: '2026-10-09T14:00:00.000Z',
        subtotal: 25,
        discount: 0,
        total: 25,
        items: [{ medicineId: 3, name: 'Gamma', quantity: 5, unitCost: 2, lineTotal: 25 }]
      },
      {
        id: 3,
        date: '2026-10-09T11:00:00.000Z',
        status: 'CANCELLED',
        subtotal: 999,
        total: 999,
        items: [{ medicineId: 1, name: 'Alpha', quantity: 99, unitCost: 1, lineTotal: 999 }]
      }
    ],
    returns: [{
      id: 1,
      saleId: 1,
      date: '2026-10-09T12:00:00.000Z',
      items: [{ medicineId: 1, quantity: 1, amount: 30 }]
    }]
  };
}

test('analytics date windows use the configured business timezone and previous equivalent range', () => {
  const timeZone = assertTimeZone('Asia/Kolkata');
  const range = resolveRange({ period: 'today' }, timeZone, new Date('2026-10-08T20:00:00.000Z'));
  assert.equal(range.from, '2026-10-09');
  assert.equal(range.previousFrom, '2026-10-08');
  assert.equal(range.previousTo, '2026-10-08');
});

test('custom date windows reject invalid, reversed, and excessively long ranges', () => {
  assert.throws(() => resolveRange({ period: 'custom', from: '2026-02-30', to: '2026-03-01' }, 'UTC'), { status: 400 });
  assert.throws(() => resolveRange({ period: 'custom', from: '2026-03-02', to: '2026-03-01' }, 'UTC'), { status: 400 });
  assert.throws(() => resolveRange({ period: 'custom', from: '2024-01-01', to: '2026-01-01' }, 'UTC'), { status: 400 });
  assert.throws(() => assertTimeZone('Not/A_Timezone'), { status: 400 });
});

test('sales analytics rank net units or net revenue, allocate discounts, and account for returns', () => {
  const db = fixture();
  const options = {
    from: '2026-10-09',
    to: '2026-10-09',
    days: 1,
    previousFrom: '2026-10-08',
    previousTo: '2026-10-08',
    timeZone: 'UTC',
    sort: 'revenue'
  };
  const analytics = buildSalesAnalytics(db, options);
  assert.equal(analytics.metrics.revenue, 88);
  assert.equal(analytics.metrics.transactions, 2);
  assert.equal(analytics.metrics.unitsSold, 7);
  assert.equal(analytics.metrics.cogs, 30);
  assert.equal(analytics.metrics.grossProfit, 58);
  assert.equal(analytics.metrics.grossMarginPercent, 65.91);
  assert.equal(analytics.metrics.lowStockProducts, 1);
  assert.equal(analytics.bestSellers[0].name, 'Beta');
  const alpha = analytics.bestSellers.find(product => product.name === 'Alpha');
  assert.equal(alpha.revenue, 27);
  assert.equal(alpha.grossProfit, 17);
  assert.equal(alpha.changePercent, -50);
  const unitsRanking = buildSalesAnalytics(db, { ...options, sort: 'units' });
  assert.equal(unitsRanking.bestSellers[0].name, 'Gamma');
  const profitRanking = buildSalesAnalytics(db, { ...options, sort: 'profit' });
  assert.equal(profitRanking.bestSellers[0].name, 'Beta');
  assert.equal(analytics.dailySeries.length, 1);
  assert.equal(analytics.hourly.length, 24);
});

test('analytics reports gross profit as unavailable when a sold item has no acquisition cost', () => {
  const db = fixture();
  db.sales = [{
    id: 4,
    date: '2026-10-09T13:00:00.000Z',
    subtotal: 5,
    total: 5,
    items: [{ medicineId: 3, name: 'No cost record', quantity: 1, unitCost: null, lineTotal: 5 }]
  }];
  db.returns = [];
  const analytics = buildSalesAnalytics(db, {
    from: '2026-10-09',
    to: '2026-10-09',
    days: 1,
    previousFrom: '2026-10-08',
    previousTo: '2026-10-08',
    timeZone: 'UTC',
    sort: 'profit'
  });
  assert.equal(analytics.metrics.revenue, 5);
  assert.equal(analytics.metrics.cogs, null);
  assert.equal(analytics.metrics.grossProfit, null);
  assert.equal(analytics.metrics.grossMarginPercent, null);
  assert.equal(analytics.metrics.costAvailable, false);
  assert.equal(analytics.bestSellers[0].grossProfit, null);
});
