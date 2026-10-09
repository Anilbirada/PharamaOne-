const pharmaDashboardState = {
  period: 'today',
  sort: 'units',
  timeZone: null
};
let dashboardRequestId = 0;

function dashboardChangeLabel(value) {
  if (value === null || value === undefined) return 'No previous-period baseline';
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'unchanged';
  return `${direction} ${Math.abs(value)}% vs previous period`;
}

function dashboardRangeControls(timeZone) {
  const zones = ['UTC', 'Asia/Kolkata', 'America/New_York', 'America/Los_Angeles', 'Europe/London'];
  if (!zones.includes(timeZone)) zones.push(timeZone);
  return `<div class="analytics-controls">
    <label class="field"><span>Period</span><select id="analytics-period">
      <option value="today" ${pharmaDashboardState.period === 'today' ? 'selected' : ''}>Today</option>
      <option value="7d" ${pharmaDashboardState.period === '7d' ? 'selected' : ''}>Last 7 days</option>
      <option value="30d" ${pharmaDashboardState.period === '30d' ? 'selected' : ''}>Last 30 days</option>
      <option value="custom" ${pharmaDashboardState.period === 'custom' ? 'selected' : ''}>Custom range</option>
    </select></label>
    <label class="field"><span>Store timezone</span><select id="analytics-timezone">
      ${zones.map(zone => `<option value="${esc(zone)}" ${zone === timeZone ? 'selected' : ''}>${esc(zone)}</option>`).join('')}
    </select></label>
    ${pharmaDashboardState.period === 'custom' ? `<label class="field"><span>From</span><input id="analytics-from" type="date" value="${esc(pharmaDashboardState.from || '')}"></label>
    <label class="field"><span>To</span><input id="analytics-to" type="date" value="${esc(pharmaDashboardState.to || '')}"></label>
    <button class="btn secondary analytics-apply" id="analytics-apply">Apply</button>` : ''}
  </div>`;
}

async function loadOwnerAnalytics() {
  const settings = await api('/api/settings');
  const timeZone = pharmaDashboardState.timeZone || settings.timeZone || 'Asia/Kolkata';
  const params = new URLSearchParams({ period: pharmaDashboardState.period, timeZone, sort: pharmaDashboardState.sort });
  if (pharmaDashboardState.period === 'custom') {
    params.set('from', pharmaDashboardState.from || '');
    params.set('to', pharmaDashboardState.to || '');
  }
  const data = await api(`/api/analytics/sales?${params.toString()}`);
  return { data, settings, timeZone };
}

function analyticsKpi(label, value, comparison, note = '') {
  return `<article class="analytics-kpi">
    <div class="analytics-kpi-label">${label}</div>
    <strong>${value}</strong>
    <div class="analytics-kpi-note">${esc(note || dashboardChangeLabel(comparison))}</div>
  </article>`;
}

function bestSellerRows(products, period) {
  if (!products.length) {
    const message = period === 'today'
      ? 'No sales recorded today. Completed bills will appear here.'
      : 'No sales recorded in this date range. Completed bills will appear here.';
    return `<tr><td colspan="6"><div class="empty">${message}</div></td></tr>`;
  }
  return products.map((product, index) => `<tr>
    <td><span class="analytics-rank">${index + 1}</span><strong>${esc(product.name)}</strong><small class="analytics-sub">${esc(product.barcode || 'No SKU/barcode')}</small></td>
    <td>${product.unitsSold}</td>
    <td>${money(product.revenue)}</td>
    <td>${product.grossProfit === null ? '<span class="muted">Unavailable (missing cost)</span>' : money(product.grossProfit)}</td>
    <td><span class="badge ${product.stockStatus === 'IN_STOCK' ? 'ok' : product.stockStatus === 'LOW_STOCK' ? 'low' : 'out'}">${product.stockStatus === 'IN_STOCK' ? 'In stock' : product.stockStatus === 'LOW_STOCK' ? 'Low stock' : 'Out of stock'}</span><small class="analytics-sub">${product.currentSellableStock} sellable units</small></td>
    <td>${product.changePercent === undefined || product.changePercent === null ? '<span class="muted">No baseline</span>' : `${product.changePercent > 0 ? '+' : ''}${product.changePercent}%`}</td>
  </tr>`).join('');
}

function seriesMarkup(series, label, valueKey) {
  if (!series?.length) return `<div class="empty">No ${label.toLowerCase()} data for this period.</div>`;
  const max = Math.max(1, ...series.map(point => Math.abs(Number(point[valueKey]) || 0)));
  return `<div class="analytics-series" role="img" aria-label="${esc(label)}">
    ${series.map(point => {
      const value = Number(point[valueKey]) || 0;
      const width = Math.max(value === 0 ? 0 : 2, Math.min(100, Math.abs(value) / max * 100));
      const title = point.hour === undefined ? point.date : `${String(point.hour).padStart(2, '0')}:00`;
      return `<div class="analytics-series-row"><time>${esc(title)}</time><span class="analytics-track"><span class="analytics-fill ${value < 0 ? 'negative' : ''}" style="width:${width}%"></span></span><strong>${money(value)}</strong></div>`;
    }).join('')}
  </div>`;
}

function dailySeriesMarkup(series) {
  if (!series?.length) return '<div class="empty">No daily data for this period.</div>';
  const max = Math.max(1, ...series.flatMap(point => [Math.abs(Number(point.revenue) || 0), Math.abs(Number(point.grossProfit) || 0)]));
  return `<div class="analytics-series" role="img" aria-label="Daily net revenue and gross profit">
    ${series.map(point => {
      const revenue = Number(point.revenue) || 0;
      const profit = point.grossProfit;
      const revenueWidth = Math.max(revenue === 0 ? 0 : 2, Math.min(100, Math.abs(revenue) / max * 100));
      const profitWidth = profit === null ? 0 : Math.max(profit === 0 ? 0 : 2, Math.min(100, Math.abs(profit) / max * 100));
      return `<div class="analytics-series-row analytics-daily-row"><time>${esc(point.date)}</time><span class="analytics-bars"><span class="analytics-track"><span class="analytics-fill ${revenue < 0 ? 'negative' : ''}" style="width:${revenueWidth}%"></span></span><span class="analytics-track"><span class="analytics-fill profit ${profit < 0 ? 'negative' : ''}" style="width:${profitWidth}%"></span></span></span><strong>${money(revenue)}<small>${profit === null ? 'Profit unavailable' : money(profit)}</small></strong></div>`;
    }).join('')}
  </div>`;
}

window.dashboard = async function renderOwnerDashboard() {
  const requestId = ++dashboardRequestId;
  app.innerHTML = '<div class="analytics-loading" role="status" aria-live="polite">Loading sales intelligence…</div>';
  try {
    const { data, settings, timeZone } = await loadOwnerAnalytics();
    if (requestId !== dashboardRequestId || view !== 'dashboard') return;
    const metrics = data.metrics;
    const profitValue = metrics.grossProfit === null ? 'Unavailable' : money(metrics.grossProfit);
    const marginValue = metrics.grossMarginPercent === null ? 'Unavailable' : `${metrics.grossMarginPercent}%`;
    const rows = bestSellerRows(data.bestSellers, pharmaDashboardState.period);
    app.innerHTML = `
      <section class="analytics-head">
        <div><span class="eyebrow">OWNER INTELLIGENCE</span><h2>Performance overview</h2><p>Sales are reported from stored invoices; gross profit uses recorded acquisition costs and return adjustments.</p></div>
        <button class="btn secondary analytics-refresh" id="analytics-refresh">Refresh data</button>
      </section>
      <section class="card analytics-filter-card" aria-label="Dashboard filters">
        <div class="analytics-filter-head"><div><strong>Reporting window</strong><small>${esc(data.from)} to ${esc(data.to)} · previous: ${esc(data.previousFrom)} to ${esc(data.previousTo)}</small></div></div>
        ${dashboardRangeControls(timeZone)}
      </section>
      <section class="analytics-kpis" aria-label="Sales key performance indicators">
        ${analyticsKpi('Net sales revenue', money(metrics.revenue), data.comparison.revenuePercent, 'Revenue less recorded returns')}
        ${analyticsKpi('Transactions', metrics.transactions, data.comparison.transactionsPercent, 'Non-cancelled invoices')}
        ${analyticsKpi('Net units sold', metrics.unitsSold, data.comparison.unitsPercent, 'Units sold less recorded returns')}
        ${analyticsKpi('Estimated gross profit', profitValue, data.comparison.grossProfitPercent, metrics.costAvailable ? 'Net revenue less recorded cost of goods' : 'Unavailable: one or more costs are missing')}
        ${analyticsKpi('Gross margin', marginValue, null, 'Gross profit ÷ net sales revenue')}
        ${analyticsKpi('Below reorder level', metrics.lowStockProducts, null, 'Current product stock at/below minimum')}
        ${analyticsKpi('Seven-day stockout risk', metrics.stockoutRiskProducts, null, 'Run-rate signal based on observed sales')}
        ${analyticsKpi('Approaching expiry', metrics.expiringProducts, null, 'Expiring within 90 days')}
      </section>
      <section class="grid two-col analytics-content-grid">
        <article class="card">
          <div class="section-head analytics-section-title"><div><h2>${pharmaDashboardState.period === 'today' ? "Today's best sellers" : 'Best-selling products'}</h2><p>Discounts are allocated by line revenue; returns reduce sales on their recorded return date.</p></div>
            <label class="field analytics-sort"><span>Rank by</span><select id="analytics-sort">
              <option value="units" ${data.sort === 'units' ? 'selected' : ''}>Units sold</option>
              <option value="revenue" ${data.sort === 'revenue' ? 'selected' : ''}>Net revenue</option>
              <option value="profit" ${data.sort === 'profit' ? 'selected' : ''}>Gross profit</option>
            </select></label>
          </div>
          <div class="table-wrap analytics-table-wrap" role="region" aria-label="Best-selling products" tabindex="0"><table class="analytics-table"><thead><tr><th>Product / SKU</th><th>Net units</th><th>Net sales</th><th>Gross profit</th><th>Sellable stock</th><th>Vs prior</th></tr></thead><tbody>${rows}</tbody></table></div>
        </article>
        <article class="card">
          <div class="section-head analytics-section-title"><div><h2>${data.hourly ? 'Hourly net sales' : 'Daily revenue and gross profit'}</h2><p>Based on posted invoices and recorded returns. No values are fabricated.</p></div></div>
          ${data.hourly ? seriesMarkup(data.hourly, 'Hourly net sales', 'revenue') : `<div class="analytics-legend"><span>Revenue</span><span>Gross profit</span></div>${dailySeriesMarkup(data.dailySeries)}`}
          ${data.hourly ? '' : '<p class="muted">Gross profit is unavailable on a day when any cost record is missing.</p>'}
        </article>
      </section>
      <details class="card analytics-method"><summary>Metric definitions and data notes</summary>
        <ul>${data.notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul>
        <p>Store timezone: <strong>${esc(timeZone)}</strong>. Configure it below; the saved setting is used for future dashboard requests.</p>
      </details>
    `;
    $('#analytics-period').onchange = async event => {
      pharmaDashboardState.period = event.target.value;
      if (pharmaDashboardState.period === 'custom') {
        const current = new Date().toISOString().slice(0, 10);
        pharmaDashboardState.from = data.from || current;
        pharmaDashboardState.to = data.to || current;
      }
      await renderOwnerDashboard();
    };
    $('#analytics-timezone').onchange = async event => {
      try {
        const updated = await api('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({ ...settings, timeZone: event.target.value })
        });
        pharmaDashboardState.timeZone = updated.timeZone;
        await renderOwnerDashboard();
      } catch (error) {
        toast(error.message);
        await renderOwnerDashboard();
      }
    };

    $('#analytics-sort').onchange = async event => {
      pharmaDashboardState.sort = event.target.value;
      await renderOwnerDashboard();
    };
    $('#analytics-refresh').onclick = renderOwnerDashboard;
    if ($('#analytics-apply')) {
      $('#analytics-from').onchange = event => { pharmaDashboardState.from = event.target.value; };
      $('#analytics-to').onchange = event => { pharmaDashboardState.to = event.target.value; };
      $('#analytics-apply').onclick = renderOwnerDashboard;
    }
  } catch (error) {
    if (requestId !== dashboardRequestId || view !== 'dashboard') return;
    app.innerHTML = `<div class="empty-state"><strong>Dashboard analytics could not be loaded.</strong><p>${esc(error.message)}</p><button class="btn secondary" onclick="dashboard()">Try again</button></div>`;
  }
};
