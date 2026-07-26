# BullMQ Monorepo

A production-ready job queue system using **BullMQ v5** with Redis, structured as a Turborepo monorepo.

## What's Inside

Three apps that work together:

| App | Directory | Purpose |
|-----|-----------|---------|
| **Queue** | `apps/queue/` | Producer — adds jobs to Redis |
| **Consumer** | `apps/consumer/` | Worker — processes jobs from the queue |
| **Dashboard** | `apps/dashboard/` | Web UI — monitor queues via Bull Board |

Plus shared packages:

| Package | Directory | Purpose |
|---------|-----------|---------|
| **@bull/config** | `packages/config/` | Shared env/Redis config |
| **@bull/shared-types** | `packages/shared-types/` | Shared TypeScript types |

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **pnpm** >= 9
- **Docker** (for Redis — no need to install Redis manually)

### Setup

```bash
# Clone and enter the project
git clone https://github.com/dilumdarshana/bull-queue.git
cd bullMQ

# Start Redis via Docker
pnpm docker:redis

# Install dependencies
pnpm install

# Copy environment files
cp apps/queue/.env_example apps/queue/.env
cp apps/consumer/.env_example apps/consumer/.env
cp apps/dashboard/.env_example apps/dashboard/.env
```

Edit `.env` files if your Redis requires different credentials.

### Run All Apps

```bash
pnpm dev
```

This starts all three apps concurrently via Turborepo.

### Run Individually

```bash
pnpm --filter queue dev        # Producer only
pnpm --filter consumer dev     # Consumer only
pnpm --filter dashboard dev    # Dashboard only
```

---

## How It Works

```
  ┌─────────────┐     ┌───────────┐     ┌──────────────┐
  │   Queue     │────>│   Redis   │────>│   Consumer   │
  │  (producer) │     │ (BullMQ)  │     │  (worker)    │
  └─────────────┘     └───────────┘     └──────────────┘
                              │
                              v
                      ┌──────────────┐
                      │  Dashboard   │
                      │ (Bull Board) │
                      └──────────────┘
```

1. **Queue** adds jobs to a BullMQ queue stored in Redis
2. **Consumer** picks up and processes each job
3. **Dashboard** provides a web UI to inspect queues and jobs at `http://localhost:3000/admin/queues`

---

## Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `REDIS_HOST` | All | Redis host (default: `127.0.0.1`) |
| `REDIS_PORT` | All | Redis port (default: `6379`) |
| `REDIS_PASSWORD` | All | Redis password |
| `QUEUE_NAME` | Queue, Consumer | Queue name for producers/workers |
| `QUEUE_LIST` | Dashboard | JSON array of queue names to monitor |
| `APP_PORT` | Dashboard | Dashboard HTTP port (default: `3000`) |

---

## Commands

Run these from `bullMQ/`:

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install all dependencies |
| `pnpm build` | Build all packages and apps |
| `pnpm dev` | Run everything in development mode |
| `pnpm start` | Start production builds |
| `pnpm lint` | Lint all packages and apps |
| `pnpm format` | Format code with Prettier |
| `pnpm docker:redis` | Start Redis container |
| `pnpm docker:redis:stop` | Stop and remove Redis container |

---

## Add Dependencies

```bash
pnpm add <pkg> -w                         # Root workspace (shared)
pnpm add <pkg> --filter queue             # Specific app/package
pnpm add -D typescript --filter queue     # Dev dependency
```

---

## Learn BullMQ

See [`CONCEPTS.md`](./CONCEPTS.md) for a comprehensive guide to BullMQ — queues, workers, jobs, flows, scheduling, deduplication, rate limiting, and more.
