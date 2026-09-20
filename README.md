# Velozity Project Dashboard

A real-time internal agency dashboard built for the Velozity technical assessment. It uses React + TypeScript on the client and Express + TypeScript, Prisma, PostgreSQL, Socket.IO, and node-cron on the server.

## Quick start

1. Copy `.env.example` to `apps/api/.env` and set strong JWT secrets. In Windows PowerShell: `Copy-Item .env.example apps/api/.env`.
2. Start PostgreSQL: `docker compose up -d`.
3. Install packages: `npm.cmd install` (Windows PowerShell; use `npm install` elsewhere).
4. Create schema and seed it: `npm run db:generate`, `npm run db:migrate -- --name init`, then `npm run db:seed`.
5. Start both apps: `npm run dev`. The UI is at `http://localhost:5173`; API at `http://localhost:4000`.

Seed accounts use `Password123!`: `admin@velozity.test`, `pm1@velozity.test`, `pm2@velozity.test`, and `ravi@velozity.test` / `maya@velozity.test` / `ishaan@velozity.test` / `zoya@velozity.test`.

## Architecture and security

Express was chosen for its focused middleware model. Prisma owns all persistence (rather than SQL in controllers) and PostgreSQL enforces relationships. Access JWTs last 15 minutes and are held only in application memory; rotating refresh JWTs are hashed in the database and sent exclusively in an `HttpOnly`, `SameSite=Lax` cookie. Every API route authenticates and scope-checks against the database: PMs must own a project; developers only receive tasks where `assigneeId` is theirs.

Socket.IO provides authenticated WebSocket transport, automatic reconnect support, and server-side rooms. Users join their own notification room; PMs may join only projects they own; activity fan-out also targets administrators and a task’s assignee. The REST activity endpoint always reads the newest 20 permitted records from PostgreSQL, so reconnecting users get durable catch-up rather than an in-memory cache. Presence uses active socket identity de-duplication.

`node-cron` runs every ten minutes and writes `isOverdue` in PostgreSQL. This is appropriate for a small single-service agency deployment; a multi-instance production deployment should move it to a single BullMQ worker with Redis.

## Data model and indexes

`User → Project (creator)`, `Client → Project`, `Project → Task`, `User → Task (assignee)`, and `Task → Activity` are foreign-key relations. Notifications belong to a recipient and may reference a task. Refresh tokens belong to users and are stored as SHA-256 hashes. Composite indexes cover project/status, assignee/status, overdue scans by due date, priority/due-date sorting, task activity chronology, and notification recipient/read-time queries. These match the dashboard, permission, feed, and scheduler access paths.

## API highlights

- `POST /api/auth/login`, `/refresh`, `/logout`
- `GET /api/tasks?status=&priority=&dueFrom=&dueTo=&projectId=` — URL-shareable filters
- `PATCH /api/tasks/:taskId/status` — writes durable activity and sends real-time updates
- `POST /api/clients`, `POST/PATCH /api/projects`, `POST /api/projects/:projectId/tasks`, `PATCH /api/tasks/:taskId` — manager workflows
- `GET/POST /api/users` — administrator team management
- `GET /api/activities` — last 20 role-filtered events
- `GET /api/dashboard`, `/notifications`, `/notifications/unread-count`

Errors have a consistent `{ error: { code, message, details? } }` shape. Zod validates all mutation payloads and list query parameters server-side.

## Deployment

`vercel.json` deploys the React client from this monorepo. Set `VITE_API_URL` in Vercel to the public API address followed by `/api` (for example `https://api.example.com/api`). Deploy the Express API and cron process to a WebSocket-capable host such as Render, Railway, or Fly.io—not Vercel serverless, because Socket.IO requires persistent connections. On that API host set `NODE_ENV=production`, `CLIENT_ORIGIN` to the Vercel URL, `DATABASE_URL`, and both JWT secrets. Production cookies automatically use `Secure; SameSite=None` so the Vercel frontend can use refresh-token rotation across origins.

## Known limitations

Presence is process-local. A horizontally scaled deployment should use the Socket.IO Redis adapter and move the scheduler to a dedicated BullMQ worker. The project includes production deployment configuration but cannot create a public Vercel/GitHub account or live link without the submitter’s credentials.

## Assessment explanation (190 words)

The hardest part was making “real-time” obey the same authorization rules as the normal API. It is easy to broadcast every task event to every connected browser; it is much harder to prevent a developer from receiving another developer’s work just because they guessed a project room. The solution authenticates the Socket.IO handshake with the short-lived access token and treats every room join as an authorization decision. An administrator receives the global stream, a project manager can join only a project whose `creatorId` matches their identity, and a developer is sent events only when they are the assigned developer. REST endpoints repeat these scope checks against PostgreSQL, so a forged UI route or modified request cannot broaden access.

Activity is durable: a status change updates the task and inserts an Activity row with actor, old status, new status, message, and timestamp. The socket emits that stored record after persistence. On reconnect, the client calls the activity endpoint, which fetches the latest 20 events within the caller’s database scope; it never relies on process memory. Notifications use the same pattern, with a per-user socket room to update the unread badge immediately.

Given more time, I would extract the scheduler and Socket.IO adapter into Redis-backed worker infrastructure for safe horizontal scaling and add an end-to-end test suite covering every forbidden role-path combination.
