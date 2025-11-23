# Smart Collections API

Collections microservice built with Bun, Hono, Drizzle ORM, and PostgreSQL. Serves on port `3000` and enforces starter-plan limits (max 5 items per collection).

## Prerequisites
- [Bun](https://bun.sh/) installed
- Docker (for local Postgres) or access to a PostgreSQL instance

## Setup
1. Copy env vars: `cp .env.example .env` and update `DATABASE_URL`.
2. Start Postgres locally (optional): `docker-compose up -d`.
3. Install deps: `bun install`.
4. Generate migrations from the schema: `bun run generate`.
5. Run migrations: `bun run migrate`.

## Running the server
- `bun run dev` (or `bun run start`) — listens on `http://localhost:3000`.

## API
- All requests require header `X-User-ID: <string>`.
- Error responses: `{ "error": "message" }`.

Endpoints:
- `POST /collections` — body `{ name: string, description?: string }`. Handles name collisions by appending `(n)`. Returns created collection (201).
- `POST /collections/:id/items` — body `{ itemId: string, note?: string }`. Rejects duplicates and enforces 5-item DB limit (201 on success).
- `PUT /collections/move-item` — body `{ itemId: string, sourceCollectionId: number, targetCollectionId: number }`. Atomic move; fails if target full or item missing (200 with `{ success: true }`).
- `GET /collections` — lists collections with `itemCount` and `relevanceScore` (notes worth 2, others 1), sorted by score then recency.

## Tests
- Requires a reachable Postgres database (`DATABASE_URL` or `TEST_DATABASE_URL`).
- Run `bun test` to execute integration tests under `tests/`.
