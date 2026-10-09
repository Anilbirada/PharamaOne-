# PharmaOne implementation status (local development build)

## Implemented in this local Node.js build
- [x] Runnable local web server and JSON-backed persistence
- [x] Medicine catalogue search and creation, duplicate barcode validation, medicine updates
- [x] POS checkout, invoice numbers, stock deduction, expired-batch sale blocking
- [x] Stock movement / audit log for opening stock, sales, adjustments, receiving and returns
- [x] Customer and supplier directory APIs and screens
- [x] Purchase order creation and partial/full receiving with over-receipt prevention
- [x] Sales returns linked to original invoices with returned-quantity limits
- [x] Credit balance tracking and payment-record endpoint
- [x] Expense tracking, shop settings, inventory alerts, staff records
- [x] Sales / COGS / gross-margin / estimated-net report endpoint and screen
- [x] Browser invoice print view
- [x] API smoke-tested for health, customer, supplier, sales, purchase receiving, returns, reports, expenses and alerts

## Still required before calling PharmaOne complete
- [ ] Production NestJS API, Next.js web application, and Expo Android app
- [ ] PostgreSQL + Prisma schema/migrations and shared cloud database
- [ ] End-to-end authentication, refresh tokens, protected routes, and server-enforced roles
- [ ] Batch-level inventory as separate records (this build stores one batch on each medicine record)
- [ ] GST/tax calculation and professionally compliant invoice validation
- [ ] Purchase returns, richer customer-credit controls, and complete payment reconciliation
- [ ] PDF generation, verified WhatsApp/SMS integrations, barcode camera scanning
- [ ] Automated regression/integration/E2E tests, concurrency testing, backup/restore, security review
- [ ] Cloud deployment, mobile builds, and acceptance testing against the original requirements

## Important limitations
This is a functional local development build, not a production-ready pharmacy system. It uses a local JSON file rather than PostgreSQL. It is not multi-user safe for concurrent transactions, and staff records do not currently enforce sign-in or role permissions. Do not use it for live sales, regulated record keeping, or real customer/patient data until the remaining work is implemented and reviewed.
