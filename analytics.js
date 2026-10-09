const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function assertTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    const error = new Error('Unknown IANA time zone.');
    error.status = 400;
    throw error;
  }
  return timeZone;
}

function businessDate(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function resolveRange(query, timeZone, now = new Date()) {
  const period = query.period || 'today';
  const currentDay = businessDate(now, timeZone);
  let from;
  let to;

  if (period === 'today') {
    from = currentDay;
    to = currentDay;
  } else if (period === '7d' || period === '30d') {
    const days = period === '7d' ? 7 : 30;
    from = shiftDate(currentDay, 1 - days);
    to = currentDay;
  } else if (period === 'custom') {
    from = query.from;
    to = query.to;
    if (!isValidDate(from) || !isValidDate(to) || from > to) {
      const error = new Error('Custom date range requires valid from/to dates with from not after to.');
      error.status = 400;
      throw error;
    }
  } else {
    const error = new Error('Period must be today, 7d, 30d, or custom.');
    error.status = 400;
    throw error;
  }

  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (days > 366) {
    const error = new Error('Date range cannot exceed 366 days.');
    error.status = 400;
    throw error;
  }

  return { from, to, days, previousFrom: shiftDate(from, -days), previousTo: shiftDate(to, -days) };
}

function isCancelled(sale) {
  return ['CANCELLED', 'CANCELED', 'VOID'].includes(String(sale.status || '').toUpperCase());
}

function inRange(value, from, to) {
  return typeof value === 'string' && value >= from && value <= to;
}

function allocateLineRevenue(sale, item) {
  const lineTotal = Number(item.lineTotal);
  if (!Number.isFinite(lineTotal)) return null;
  const subtotal = Number(sale.subtotal);
  const discount = Number(sale.discount || 0);
  const allocatedDiscount = subtotal > 0 ? discount * lineTotal / subtotal : 0;
  return Math.max(0, lineTotal - allocatedDiscount);
}

function percentageChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return round((current - previous) / Math.abs(previous) * 100);
}

function buildSalesAnalytics(db, options) {
  const { from, to, days, previousFrom, previousTo, timeZone, sort = 'units' } = options;
  const asOf = businessDate(new Date(), timeZone);
  const allSales = db.sales.filter(sale => !isCancelled(sale));
  const salesById = new Map(allSales.map(sale => [sale.id, sale]));
  const currentSales = allSales.filter(sale => inRange(businessDate(sale.date, timeZone), from, to));
  const previousSales = allSales.filter(sale => inRange(businessDate(sale.date, timeZone), previousFrom, previousTo));
  const currentReturns = db.returns.filter(record => inRange(businessDate(record.date, timeZone), from, to));
  const previousReturns = db.returns.filter(record => inRange(businessDate(record.date, timeZone), previousFrom, previousTo));

  function accumulate(sales, returns, rangeFrom, rangeTo, collectSeries = false) {
    const products = new Map();
    const daily = new Map();
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: 0 }));
    let revenue = 0;
    let cogs = 0;
    let costAvailable = true;
    let unitsSold = 0;
    const saleDates = new Set();

    function addProduct(item, medicine, units, netRevenue, itemCost) {
      const key = item.medicineId;
      let product = products.get(key);
      if (!product) {
        product = {
          medicineId: key,
          name: item.name || medicine?.name || 'Unknown product',
          barcode: medicine?.barcode || '',
          unitsSold: 0,
          revenue: 0,
          cogs: 0,
          costAvailable: true
        };
        products.set(key, product);
      }
      product.unitsSold += units;
      product.revenue += netRevenue;
      if (itemCost === null) product.costAvailable = false;
      else product.cogs += itemCost;
    }

    for (const sale of sales) {
      const date = businessDate(sale.date, timeZone);
      saleDates.add(sale.id);
      const subtotal = Number(sale.subtotal ?? sale.items.reduce((sum, item) => sum + (Number(item.lineTotal) || 0), 0));
      const discount = Number(sale.discount || 0);
      for (const item of sale.items || []) {
        const medicine = db.medicines.find(record => record.id === item.medicineId);
        const quantity = Number(item.quantity) || 0;
        const itemRevenue = allocateLineRevenue({ ...sale, subtotal, discount }, item);
        const itemCost = item.unitCost !== null && item.unitCost !== undefined && Number.isFinite(Number(item.unitCost))
          ? Number(item.unitCost) * quantity
          : null;
        const netItemRevenue = itemRevenue ?? 0;
        revenue += netItemRevenue;
        unitsSold += quantity;
        if (itemCost === null) costAvailable = false;
        else cogs += itemCost;
        addProduct(item, medicine, quantity, netItemRevenue, itemCost);
        if (collectSeries) {
          const bucket = daily.get(date) || { date, revenue: 0, cogs: 0, costAvailable: true };
          bucket.revenue += netItemRevenue;
          if (itemCost === null) bucket.costAvailable = false;
          else bucket.cogs += itemCost;
          daily.set(date, bucket);
          const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(sale.date)));
          hourly[hour].revenue += netItemRevenue;
        }
      }
    }

    for (const record of returns) {
      const sale = salesById.get(record.saleId);
      if (!sale || isCancelled(sale)) continue;
      for (const returned of record.items || []) {
        const sold = sale.items?.find(item => item.medicineId === returned.medicineId);
        if (!sold) continue;
        const quantity = Number(returned.quantity) || 0;
        const originalRevenue = allocateLineRevenue(sale, sold);
        const soldQuantity = Number(sold.quantity) || 0;
        const refund = originalRevenue !== null && soldQuantity > 0
          ? originalRevenue / soldQuantity * quantity
          : Number(returned.amount) || 0;
        const itemCost = sold.unitCost !== null && sold.unitCost !== undefined && Number.isFinite(Number(sold.unitCost))
          ? Number(sold.unitCost) * quantity
          : null;
        revenue -= refund;
        unitsSold -= quantity;
        if (itemCost === null) costAvailable = false;
        else cogs -= itemCost;
        const medicine = db.medicines.find(item => item.id === returned.medicineId);
        addProduct(sold, medicine, -quantity, -refund, itemCost === null ? null : -itemCost);
        if (collectSeries) {
          const date = businessDate(record.date, timeZone);
          const bucket = daily.get(date) || { date, revenue: 0, cogs: 0, costAvailable: true };
          bucket.revenue -= refund;
          if (itemCost === null) bucket.costAvailable = false;
          else bucket.cogs -= itemCost;
          daily.set(date, bucket);
          const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(record.date)));
          hourly[hour].revenue -= refund;
        }
      }
    }

    const grossProfit = costAvailable ? round(revenue - cogs) : null;
    const resultProducts = [...products.values()].map(product => {
      const medicine = db.medicines.find(record => record.id === product.medicineId);
      const expired = Boolean(medicine?.expiry && medicine.expiry < asOf);
      const sellableStock = expired ? 0 : Number(medicine?.stock) || 0;
      const productRevenue = round(product.revenue);
      const productCostAvailable = product.costAvailable;
      const productProfit = productCostAvailable ? round(product.revenue - product.cogs) : null;
      return {
        medicineId: product.medicineId,
        name: product.name,
        barcode: product.barcode,
        unitsSold: product.unitsSold,
        revenue: productRevenue,
        grossProfit: productProfit,
        grossMarginPercent: productRevenue > 0 && productProfit !== null ? round(productProfit / productRevenue * 100) : null,
        currentSellableStock: sellableStock,
        stockStatus: sellableStock === 0 ? 'OUT_OF_STOCK' : sellableStock <= (Number(medicine?.minStock) || 0) ? 'LOW_STOCK' : 'IN_STOCK',
        costAvailable: productCostAvailable
      };
    }).filter(product => product.unitsSold !== 0 || product.revenue !== 0);

    const daysMap = collectSeries ? new Map() : null;
    if (collectSeries) {
      for (let index = 0; index < days; index++) {
        const date = shiftDate(rangeFrom, index);
        daysMap.set(date, daily.get(date) || { date, revenue: 0, cogs: 0, costAvailable: true });
      }
    }
    const dailySeries = collectSeries ? [...daysMap.values()].map(bucket => ({
      date: bucket.date,
      revenue: round(bucket.revenue),
      grossProfit: bucket.costAvailable ? round(bucket.revenue - bucket.cogs) : null
    })) : undefined;

    return {
      revenue: round(revenue),
      transactions: saleDates.size,
      unitsSold,
      cogs: costAvailable ? round(cogs) : null,
      grossProfit,
      grossMarginPercent: revenue > 0 && grossProfit !== null ? round(grossProfit / revenue * 100) : null,
      products: resultProducts,
      dailySeries,
      hourly: collectSeries && rangeFrom === rangeTo ? hourly.map(bucket => ({ hour: bucket.hour, revenue: round(bucket.revenue) })) : undefined
    };
  }

  const current = accumulate(currentSales, currentReturns, from, to, true);
  const previous = accumulate(previousSales, previousReturns, previousFrom, previousTo);
  const lowStock = db.medicines.filter(medicine => Number(medicine.stock) <= Number(medicine.minStock)).length;
  const expiring = db.medicines.filter(medicine =>
    medicine.expiry && medicine.expiry >= asOf && medicine.expiry <= shiftDate(asOf, 90)
  ).length;
  const productMap = new Map(current.products.map(product => [product.medicineId, product]));

  for (const previousProduct of previous.products) {
    const product = productMap.get(previousProduct.medicineId);
    if (product) product.changePercent = percentageChange(product.unitsSold, previousProduct.unitsSold);
  }

  const sorters = {
    units: (a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue,
    revenue: (a, b) => b.revenue - a.revenue || b.unitsSold - a.unitsSold,
    profit: (a, b) => (b.grossProfit ?? -Infinity) - (a.grossProfit ?? -Infinity) || b.revenue - a.revenue
  };
  if (!sorters[sort]) {
    const error = new Error('Sort must be units, revenue, or profit.');
    error.status = 400;
    throw error;
  }

  const comparison = {
    revenuePercent: percentageChange(current.revenue, previous.revenue),
    transactionsPercent: percentageChange(current.transactions, previous.transactions),
    unitsPercent: percentageChange(current.unitsSold, previous.unitsSold),
    grossProfitPercent: percentageChange(current.grossProfit, previous.grossProfit)
  };

  return {
    from,
    to,
    previousFrom,
    previousTo,
    timeZone,
    sort,
    metrics: {
      revenue: current.revenue,
      transactions: current.transactions,
      unitsSold: current.unitsSold,
      cogs: current.cogs,
      grossProfit: current.grossProfit,
      grossMarginPercent: current.grossMarginPercent,
      lowStockProducts: lowStock,
      stockoutRiskProducts: current.products.filter(product =>
        product.unitsSold > 0 && product.currentSellableStock <= product.unitsSold / days * 7
      ).length,
      expiringProducts: expiring,
      costAvailable: current.grossProfit !== null
    },
    comparison,
    bestSellers: current.products.sort(sorters[sort]).slice(0, 10),
    dailySeries: current.dailySeries,
    hourly: current.hourly,
    notes: [
      'Returns are deducted on their recorded return date, using the original sale line discount allocation.',
      'Gross profit subtracts recorded unit costs and reverses cost for returned units; missing costs make gross profit unavailable.',
      'Stockout risk is a seven-day demand run-rate indicator, not a guarantee or purchase recommendation.',
      'Current inventory is product-level JSON stock; batch, quarantine, and reserved stock are not modelled.'
    ]
  };
}

function buildSalesReport(db, { from, to, timeZone = db.settings.timeZone || DEFAULT_TIME_ZONE }) {
  assertTimeZone(timeZone);
  const range = resolveRange({ period: 'custom', from, to }, timeZone);
  const analytics = buildSalesAnalytics(db, { ...range, timeZone, sort: 'units' });
  const sales = db.sales.filter(sale =>
    !isCancelled(sale) && inRange(businessDate(sale.date, timeZone), range.from, range.to)
  );
  const purchases = db.purchases.filter(purchase =>
    inRange(businessDate(purchase.date, timeZone), range.from, range.to)
  );
  const expenses = db.expenses.filter(expense =>
    inRange(expense.date, range.from, range.to)
  );
  const purchaseSpend = round(purchases.reduce((sum, purchase) => sum + (Number(purchase.total) || 0), 0));
  const expenseTotal = round(expenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0));
  const grossProfit = analytics.metrics.grossProfit;

  return {
    from: range.from,
    to: range.to,
    timeZone,
    salesCount: analytics.metrics.transactions,
    revenue: analytics.metrics.revenue,
    cogs: analytics.metrics.cogs,
    grossMargin: grossProfit,
    grossMarginPercent: analytics.metrics.grossMarginPercent,
    purchaseSpend,
    expenseTotal,
    estimatedNet: grossProfit === null ? null : round(grossProfit - expenseTotal),
    sales,
    purchases,
    expenses,
    topMedicines: analytics.bestSellers.map(product => ({
      name: product.name,
      quantity: product.unitsSold,
      revenue: product.revenue,
      grossProfit: product.grossProfit,
      costAvailable: product.costAvailable
    }))
  };
}

module.exports = { assertTimeZone, buildSalesAnalytics, buildSalesReport, DEFAULT_TIME_ZONE, resolveRange };
