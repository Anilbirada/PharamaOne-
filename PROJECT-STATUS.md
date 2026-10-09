# PharmaOne implementation status (local development build)

## Implemented in this local Node.js build
- [x] Runnable local web server and JSON-backed persistence
- [x] BOM-tolerant database startup and isolated API integration tests
- [x] Server-calculated sales analytics endpoint with business-timezone ranges, prior-period comparisons, discounted/returned revenue, recorded-cost gross profit, and ranked products
- [x] Owner dashboard KPI cards, best-seller sort controls, hourly/daily sales charts, and store-timezone selector
- [x] Replaced the sidebar plus-sign mark with the provided PharmaOne logo asset
- [x] Medicine catalogue search and creation, duplicate barcode validation, medicine updates
- [x] POS checkout, invoice numbers, aggregated stock deduction, expired-batch sale blocking
- [x] Stock movement / audit log for opening stock, sales, adjustments, receiving and returns
- [x] Customer and supplier directory APIs and screens
- [x] Purchase order creation and partial/full receiving with over-receipt prevention
- [x] Sales returns linked to original invoices with returned-quantity limits
- [x] Credit balance tracking and payment-record endpoint
- [x] Expense tracking, shop settings, inventory alerts, staff records
- [x] Sales / COGS / gross-margin / estimated-net report endpoint and screen
- [x] Legacy report now uses store-timezone date windows, excludes cancelled sales, deducts recorded returns on their return dates, and reports missing acquisition cost as unavailable
- [x] PostgreSQL schema/migration scaffolding for pharmacy-scoped pharmacy operations, enforced row-level security, audited schema changes, and a migration target guard that permits only loopback `pharmaone_test`
- [x] Embedded PostgreSQL migration execution and cross-pharmacy row-level isolation test
- [x] Browser invoice print view
- [x] API/unit tested for timezone boundaries, metric calculations, rankings, discounts, returns, missing costs, BOM-prefixed JSON, medicine validation, duplicate sale/return lines, expired stock, purchase receiving, credit payments, expenses, settings and reports (12 API/analytics tests plus 3 migration/schema tests pass)

## Still required before calling PharmaOne complete
- [ ] Production NestJS API, Next.js web application, and Expo Android app
- [ ] PostgreSQL-backed application persistence and verified local `pharmaone_test` migration; schema tooling exists but credentials are not configured and the live server remains JSON-backed
- [ ] End-to-end authentication, refresh tokens, protected routes, and server-enforced roles
- [ ] Batch-level inventory as separate records (this build stores one batch on each medicine record)
- [ ] GST/tax calculation and professionally compliant invoice validation
- [ ] Purchase returns, richer customer-credit controls, and complete payment reconciliation
- [ ] PDF generation, verified WhatsApp/SMS integrations, barcode camera scanning
- [ ] PostgreSQL-backed integration tests, browser E2E tests, concurrency testing, backup/restore, security review
- [ ] Cloud deployment, mobile builds, and acceptance testing against the original requirements

## Requirement audit

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| Local server, JSON persistence, health endpoint | PASS | BOM-safe startup and API integration test pass; this is development-only storage. |
| Medicine catalogue, search, barcode validation, basic editing | PASS | API-backed screens and validation tests; category management and separate batch records are absent. |
| POS, invoice creation, stock deduction, printable invoice | PARTIAL | API checkout and stock checks are tested; tax rules, production payment integration, idempotency, and multi-user stock locking are absent. |
| Customers, suppliers, purchase orders, receiving | PARTIAL | Basic directory/order/partial-receiving JSON workflows exist; supplier lead times and pack policies are only represented in the PostgreSQL schema, not yet wired to the running app. Purchase returns and duplicate-request protection are absent. |
| Sales returns and refunds | PARTIAL | Return limits and stock restoration are tested; no cash refund, credit adjustment, or return-to-batch/restock policy is recorded. |
| Dashboard, sales analytics, and reports | PARTIAL | Timezone, comparisons, discounts, recorded returns, and missing-cost behavior have API tests; no forecast/reorder engine or browser E2E suite exists. |
| Product demand forecasting / smart reorder center | MISSING | Sales history exists, but history completeness, lead times, confirmed inbound allocations, safety-stock policy, and pack constraints are not modelled. |
| Product-wise profit and margin analysis | PARTIAL | Basic return-adjusted aggregate report exists; no dedicated category/product profitability workflow or consistent batch costing model exists. |
| Batch, expiry, FEFO, quarantine, movement audit | PARTIAL | One batch/expiry is stored per medicine and expired stock is blocked from sale; batch-level balances, quarantine, FEFO, and expiry loss are not modelled. |
| Authentication, sessions, staff permissions, tenant isolation | MISSING | Staff are directory records only; there are no credentials, sessions, authorization checks, or tenant model. |
| PostgreSQL schema and migration tooling | PARTIAL | Versioned schema, local-test-database target guard, and embedded PostgreSQL RLS tests exist. PostgreSQL 16 and 18 services/tools are installed and running locally on ports 5432 and 5433; credentials are not configured, so neither local server has been accessed and no migration is applied there. The running app remains JSON-backed. |
| PostgreSQL runtime repository, JSON data migration, transaction/concurrency protection | MISSING | Existing HTTP routes still read/write the JSON file; no PostgreSQL repository, import tool, or transactional business workflow is wired. |
| Deployment, CI/CD, monitoring, backup/restore | BLOCKED | No target host, deployment pipeline, monitoring service, or backup location is configured. |
| Automated validation | PARTIAL | `npm.cmd run check` and 15 Node tests pass, including executing the schema and checking row-level tenant isolation in embedded PostgreSQL; no real-service database migration, browser E2E, concurrency, backup-restore, or production-build tests exist. |

## Important limitations
This is a functional local development build, not a production-ready pharmacy system. The running app uses a local JSON file rather than PostgreSQL. It is not multi-user safe for concurrent transactions, and staff records do not currently enforce sign-in or role permissions. Do not use it for live sales, regulated record keeping, or real customer/patient data until the remaining work is implemented and reviewed.

## Audit findings requiring policy or infrastructure
- Sales returns restore inventory and record a return value, but do not create a refund/payment adjustment. Both sales analytics and `/api/reports/summary` now reduce net revenue and COGS for recorded returns on the return date. Discount allocation follows proportional line revenue. Define which returns can be restocked and how cash refunds/customer credit are recorded.
- The stockout count on the new dashboard is a transparent seven-day run-rate indicator, not demand forecasting. The PostgreSQL schema includes supplier/product lead times and pack/minimum quantities, but no forecasting or reorder calculations/page are implemented. Safety stock, committed stock, and quarantine are not implemented in the running data model.
- The current seed database has no sales records, so the live dashboard correctly shows empty sales and profit values until actual invoices/returns are entered. Automated tests use temporary synthetic records.
- Staff accounts are records only; there is no login/session or server-side role enforcement. Define the permission matrix and deploy an authentication system before exposing the API beyond a trusted local development environment.
- Local PostgreSQL services are present, but no database credentials are configured. An ignored `.env` contains placeholders only. The migration runner refuses non-loopback targets and any database other than `pharmaone_test`; no connection or migration against the Windows services has been made.
- PostgreSQL schema testing currently uses embedded PostgreSQL and does not demonstrate connectivity, grants, account setup, or migration success on the installed Windows services.
- No PostgreSQL-backed HTTP API, JSON data migration, login/session enforcement, role authorization, or production deployment and backup/restore procedure is present.
