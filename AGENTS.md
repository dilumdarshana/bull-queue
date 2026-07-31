# AGENTS.md

## Project Structure

Twin Turborepo monorepos: `bullMQ/` (BullMQ v5, stable) and `bullMQ6/` (BullMQ v6, next). The `bull/` directory is the old approach (Bull, deprecated). Only work in `bullMQ/` or `bullMQ6/`.

### Apps (bullMQ/apps/ and bullMQ6/apps/)
- `queue/` - Main queue service
- `consumer/` - Message consumer
- `dashboard/` - GUI dashboard

### Packages (bullMQ/packages/ and bullMQ6/packages/)
- `config/` - Shared configuration
- `shared-types/` - Shared TypeScript types

Both projects share the same Redis (`bullmq-redis` on port `6379`) — run only one at a time.

## Commands (run from bullMQ/ or bullMQ6/)

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install dependencies |
| `pnpm build` | Build all packages/apps (via turbo) |
| `pnpm dev` | Run all in development mode |
| `pnpm lint` | Lint all packages/apps |
| `pnpm format` | Format code with Prettier |
| `pnpm start` | Start production |

## Key Conventions

- **Package manager**: pnpm@11.11.0 (pinned in each monorepo's `packageManager` field)
- **pnpm 11 supply-chain defaults**: `minimumReleaseAge: 0` and `allowBuilds` (esbuild, msgpackr-extract) are set in each `pnpm-workspace.yaml` so fresh BullMQ releases install immediately and build scripts run
- **Node**: >=18
- **TypeScript**: 6.0.3
- **Build**: tsup via Turbo
- **BullMQ**: v5.x in `bullMQ/`, v6.x in `bullMQ6/` (v6 needs `ioredis` installed explicitly)
- **Express**: v5 (dashboard app)
- **Turbo**: v2
- The `bull/` directory is legacy and should not be modified

## Adding Dependencies
```sh
pnpm add <pkg> -w              # root workspace
pnpm add <pkg> --filter <app>  # specific app/package
```

## Dependabot

Dependabot is configured at `.github/dependabot.yml` — weekly npm updates for `bullMQ/` and `bullMQ6/` directories.
