const SALES_HISTORY_PAGE_SIZE = 100;
let salesHistoryPage = 1;

window.salesPage = function renderSalesHistory() {
  const pageCount = Math.max(1, Math.ceil(sales.length / SALES_HISTORY_PAGE_SIZE));
  salesHistoryPage = Math.min(salesHistoryPage, pageCount);
  const start = (salesHistoryPage - 1) * SALES_HISTORY_PAGE_SIZE;
  const pageSales = sales.slice(start, start + SALES_HISTORY_PAGE_SIZE);
  const end = Math.min(start + pageSales.length, sales.length);

  app.innerHTML = `<div class="card">
    <div class="section-head">
      <div><h2>Sales &amp; invoices</h2><div class="muted" style="margin-top:5px">Showing invoices ${sales.length ? start + 1 : 0}–${end} of ${sales.length}</div></div>
      <button class="btn green" onclick="setView('pos')">＋ New bill</button>
    </div>
    ${pageSales.length ? `<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Payment</th><th>Items</th><th>Total</th><th></th></tr></thead><tbody>
      ${pageSales.map(sale => `<tr><td><b>${esc(sale.invoiceNo)}</b></td><td>${new Date(sale.date).toLocaleString()}</td><td>${esc(sale.customer)}</td><td><span class="badge ok">${esc(sale.paymentMode)}</span></td><td>${sale.items.reduce((total, item) => total + item.quantity, 0)}</td><td><b>${money(sale.total)}</b></td><td><button class="btn secondary small" onclick="viewInvoice(${sale.id})">View</button></td></tr>`).join('')}
    </tbody></table></div>
    <nav class="sales-history-pagination" aria-label="Sales invoice pages">
      <button class="btn secondary small" onclick="changeSalesHistoryPage(-1)" ${salesHistoryPage === 1 ? 'disabled' : ''}>Previous</button>
      <span class="muted">Page ${salesHistoryPage} of ${pageCount}</span>
      <button class="btn secondary small" onclick="changeSalesHistoryPage(1)" ${salesHistoryPage === pageCount ? 'disabled' : ''}>Next</button>
    </nav><div id="sale-detail"></div>` : '<div class="empty"><div class="empty-icon">↗</div>No sales recorded yet. Create your first bill from POS Billing.</div>'}
  </div>`;
};

window.changeSalesHistoryPage = function changeSalesHistoryPage(direction) {
  const pageCount = Math.max(1, Math.ceil(sales.length / SALES_HISTORY_PAGE_SIZE));
  salesHistoryPage = Math.max(1, Math.min(pageCount, salesHistoryPage + direction));
  window.salesPage();
};
