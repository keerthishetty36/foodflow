# FoodFlow POS

Production-oriented restaurant POS monorepo using React 19, Express, MongoDB Atlas and Prisma's MongoDB provider.

## Start

1. Copy `.env.example` to `server/.env` and set a MongoDB Atlas connection string plus strong JWT secrets.
2. Run `npm install`.
3. Run `npx prisma generate --schema server/prisma/schema.prisma`.
4. Run `npx prisma db push --schema server/prisma/schema.prisma`.
5. Run `npm run seed` then `npm run dev`.

Client: `http://localhost:5173` · API: `http://localhost:4000` · Swagger: `http://localhost:4000/docs`.

Seed credentials: `admin@foodflow.local` / `Admin@123`, and `cashier@foodflow.local` / `Cashier@123`. Change them after first use.

## Architecture

- `client`: feature-oriented React SPA with protected role-based routes, TanStack Query, Zustand POS cart, Socket.io updates, charts, and responsive Tailwind UI.
- `server`: Express API with Zod validation, centralized errors, Helmet/CORS/rate limiting/compression, JWT rotation in HTTP-only cookies, audit logging, receipt PDFs, uploads, Swagger, Socket.io, and Prisma.
- `shared`: domain constants and cross-project TypeScript types.
- `server/prisma`: MongoDB schema and idempotent seed.

All business-changing endpoints require authentication. Admin-only endpoints cover menu, tables, inventory, suppliers, reports, settings and users; cashiers retain orders, billing, customers, receipts and kitchen access.
