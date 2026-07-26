# Redis-Based Queue System for Node.js

A monorepo powered by [BullMQ](https://bullmq.io) v5 and Redis for reliable, persistent job queues.

## Projects

### [bullMQ](/bullMQ) (Active)

Production-ready BullMQ queue system using **Turborepo**, **Express**, **pnpm**, and **Docker**.

Three apps working together:

| App | Directory | Purpose |
|-----|-----------|---------|
| **Queue** (producer) | `apps/queue/` | Adds jobs to Redis |
| **Consumer** (worker) | `apps/consumer/` | Processes jobs from the queue |
| **Dashboard** | `apps/dashboard/` | Web UI via Bull Board |

See [`bullMQ/README.md`](/bullMQ/README.md) for full setup, commands, and architecture details.

### bull/ (Deprecated)

Legacy Bull v3 implementation. Not maintained.

---

## Tech Stack

- **BullMQ** v5 — Queue/worker library
- **Redis** 7 — Backing store
- **Turborepo** — Monorepo orchestration
- **pnpm** — Package manager
- **Express** v5 — Dashboard HTTP server
- **Bull Board** — Queue monitoring UI
- **Docker** — Redis containerization
