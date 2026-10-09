# PharmaOne — local development build

A plain-JavaScript Node.js web application for exploring core medical-shop workflows. The frontend has no framework; the local API persists to JSON. PostgreSQL tooling is being introduced separately and does not yet back the application routes.

## Requirements
- Node.js 18 or newer
- PostgreSQL 15 or newer for the isolated schema/migration tooling (the running app still uses JSON storage)
- VS Code (recommended)

## Run on Windows
1. Extract the ZIP.
2. Open the extracted `PharmaOne-MVP` folder in VS Code.
3. Open **Terminal → New Terminal**.
4. Run `node --version` to verify Node.js.
5. Run `npm install` to install the PostgreSQL driver and test dependencies.
6. Run `npm start` (or `node server.js` if PowerShell blocks `npm.ps1`).
7. Open `http://127.0.0.1:3000`.

The development server binds to loopback and is not exposed to other devices on the network. The existing application continues to persist local data in `data/db.json`; PostgreSQL schema setup does not switch or migrate the running app. Back up that file before experimenting. To reset demo data, restore the original `data/db.json` from the ZIP.

To run tests, use `npm test` (or `node --test`). API tests use a temporary JSON database and do not modify `data/db.json`; migration and pharmacy-isolation tests execute the checked-in SQL against a disposable embedded PostgreSQL instance.

## PostgreSQL development schema (isolated test database only)

PostgreSQL services and command-line tools may already be installed on the Windows machine. Copy `.env.example` to `.env` (an ignored placeholder `.env` is provided in this workspace), then configure credentials locally:

- `MIGRATION_DATABASE_URL`: a local PostgreSQL migration/admin connection.
- `DATABASE_URL`: a separate `pharmaone_app` connection. The migration creates this role as `NOLOGIN`, non-superuser, and without RLS-bypass privileges. After migration, enable its login and set its password locally using an authorized PostgreSQL administration tool; never put a password in shell history or source control.

Create the dedicated empty `pharmaone_test` database using pgAdmin or an authorized local administrator account. Never point this migration command at production or another database: it deliberately permits only loopback hosts and a database named `pharmaone_test`. Run `npm run db:migrate` to apply versioned SQL migrations. Migration checksums prevent edits to already-applied migrations; add a new numbered migration for future schema changes.

For the detected PostgreSQL 16 service, the client is `C:\Program Files\PostgreSQL\16\bin\psql.exe` and the service listens on port `5432`. Sign in locally with the administrator account, create the empty database with `CREATE DATABASE pharmaone_test;`, and configure the two URLs in `.env`. After `npm run db:migrate` creates the restricted `pharmaone_app` role, enable its login and set a password from the private `psql` prompt using `ALTER ROLE pharmaone_app LOGIN;` followed by `\password pharmaone_app`; then set `DATABASE_URL` to that role. Do not put passwords in terminal commands or share them in chat. Percent-encode reserved characters in URL passwords.

The initial schema includes pharmacy-scoped users/roles/sessions, products/batches, supplier catalogue and lead times, purchase and purchase-return records, sales/items, payments/returns, stock movements, settings, and immutable audit logs. Row-level security is enforced for pharmacy-owned records, and the application role cannot bypass it. The schema has only been executed and tenant-isolation-tested in embedded PostgreSQL so far; no migration has yet been applied to either installed Windows PostgreSQL service.

**Important:** PostgreSQL is schema/test scaffolding only at this stage. The HTTP server, screens, and existing API still use the JSON file. There is no login/session middleware, role enforcement, tenant-aware database repository, JSON-to-PostgreSQL data migration, or production database bootstrap. Do not enter real pharmacy/customer data or use this build for live operations.

## Available areas
- Dashboard
- Owner sales dashboard with date-range and store-timezone filters, KPI comparisons, best-seller ranking, hourly/daily sales and return-adjusted gross profit
- POS billing and printable invoice
- Medicine catalogue, batch/expiry fields and stock adjustment API
- Sales history
- Customers and suppliers
- Purchase orders and receiving
- Sales returns linked to an original invoice
- Reports (sales revenue, estimated COGS, gross margin, expenses and estimated net)
- Expenses, alerts, staff directory, shop settings and stock audit log

## API routes
- `GET /api/health`, `GET /api/summary`
- `GET /api/analytics/sales?period=today|7d|30d|custom&from=YYYY-MM-DD&to=YYYY-MM-DD&timeZone=UTC&sort=units|revenue|profit`
- `GET/POST /api/medicines`, `PATCH /api/medicines/:id`
- `POST /api/inventory/adjust`, `GET /api/transactions`, `GET /api/notifications`
- `GET/POST /api/sales`, `POST /api/sales/payment`
- `GET/POST/PATCH /api/customers`, `GET/POST/PATCH /api/suppliers`
- `GET/POST /api/purchases`, `POST /api/purchases/receive`
- `GET/POST /api/returns`, `GET/POST /api/expenses`
- `GET /api/reports/summary`, `GET/PUT /api/settings`, `GET/POST /api/users`

The analytics endpoint and `/api/reports/summary` are calculated from JSON records on the server. Business dates use the saved `settings.timeZone` (default `Asia/Kolkata`); reports accept an optional `timeZone` query parameter. Change the store timezone in Settings or the dashboard filter. Discounts are proportionally allocated to invoice lines. Recorded returns are deducted on the return date using the original sale's discounted unit value; returned unit costs are reversed from COGS. A missing acquisition cost makes gross profit and estimated net unavailable rather than treating cost as zero. Return records do not prove that a cash refund or customer-credit adjustment was settled.

The dashboard's stockout indicator is a simple seven-day sales run-rate signal, not an AI forecast. The app has no actual batch, quarantine, allocation, product category, refund, or supplier lead-time model, so batch-aware demand forecasts and reorder recommendations are not implemented.

## Important limitations
This is not the completed production system specified in the original PharmaOne requirements. It uses local JSON persistence, not PostgreSQL/Prisma; the web app is not Next.js; there is no Expo Android app; and staff records do not enforce authentication or authorization. It is not safe for concurrent multi-user pharmacy transactions or live regulated operations. GST compliance, batch-level stock records, purchase returns, production-grade authentication, automated browser E2E tests, backups, cloud deployment and the mobile app remain outstanding. Review `PROJECT-STATUS.md` before relying on any feature.
