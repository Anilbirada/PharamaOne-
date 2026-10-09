# PharmaOne — local development build

A no-dependency Node.js web application for exploring the core medical-shop workflow. This expanded build includes medicines, billing, stock audit, customers, suppliers, purchase orders and receiving, sales returns, expenses, alerts, reports, shop settings, and staff directory records.

## Requirements
- Node.js 18 or newer
- VS Code (recommended)

## Run on Windows
1. Extract the ZIP.
2. Open the extracted `PharmaOne-MVP` folder in VS Code.
3. Open **Terminal → New Terminal**.
4. Run `node --version` to verify Node.js.
5. Run `npm start`.
6. Open `http://localhost:3000`.

No `npm install` is needed. Local data persists in `data/db.json`. Back up that file before experimenting. To reset demo data, restore the original `data/db.json` from the ZIP.

## Available areas
- Dashboard
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
- `GET/POST /api/medicines`, `PATCH /api/medicines/:id`
- `POST /api/inventory/adjust`, `GET /api/transactions`, `GET /api/notifications`
- `GET/POST /api/sales`, `POST /api/sales/payment`
- `GET/POST/PATCH /api/customers`, `GET/POST/PATCH /api/suppliers`
- `GET/POST /api/purchases`, `POST /api/purchases/receive`
- `GET/POST /api/returns`, `GET/POST /api/expenses`
- `GET /api/reports/summary`, `GET/PUT /api/settings`, `GET/POST /api/users`

## Important limitations
This is not the completed production system specified in the original PharmaOne requirements. It uses local JSON persistence, not PostgreSQL/Prisma; the web app is not Next.js; there is no Expo Android app; and staff records do not enforce authentication or authorization. It is not safe for concurrent multi-user pharmacy transactions or live regulated operations. GST compliance, batch-level stock records, purchase returns, production-grade authentication, automated E2E tests, backups, cloud deployment and the mobile app remain outstanding. Review `PROJECT-STATUS.md` before relying on any feature.
