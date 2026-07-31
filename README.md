# Redis-Based Queue System for Node.js

Redis-backed job queue system for Node.js built on [BullMQ](https://bullmq.io), with stable (v5) and next (v6) variants.

## Projects

### [bullMQ](/bullMQ) (Stable — BullMQ v5)

Production-ready BullMQ v5 queue system using **Turborepo**, **Express**, **pnpm**, and **Docker**.

Three apps working together:

| App | Directory | Purpose |
|-----|-----------|---------|
| **Queue** (producer) | `apps/queue/` | Adds jobs to Redis |
| **Consumer** (worker) | `apps/consumer/` | Processes jobs from the queue |
| **Dashboard** | `apps/dashboard/` | Web UI via Bull Board |

See [`bullMQ/README.md`](/bullMQ/README.md) for full setup, commands, and architecture details.

### [bullMQ6](/bullMQ6) (Next — BullMQ v6)

Same three-app structure as `bullMQ/`, upgraded to **BullMQ v6** with `ioredis` as an explicit dependency.

See [`bullMQ6/README.md`](/bullMQ6/README.md) for setup and commands.

> Both projects share the same Redis (`bullmq-redis` container on port `6379`). Run **one at a time**.

### bull/ (Deprecated)

Legacy Bull v3 implementation. Not maintained.

---

## Tech Stack

- **BullMQ** v5 (`bullMQ/`) / v6 (`bullMQ6/`) — Queue/worker library
- **Redis** 7 — Backing store
- **Turborepo** — Monorepo orchestration
- **pnpm** — Package manager
- **Express** v5 — Dashboard HTTP server
- **Bull Board** — Queue monitoring UI
- **Docker** — Redis containerization
