# AGENTS.md

## Project Structure

Monorepo with Turborepo at `bullMQ/`. The `bull/` directory is the old approach (Bull, deprecated). Only work in `bullMQ/`.

### Apps (bullMQ/apps/)
- `queue/` - Main queue service
- `consumer/` - Message consumer
- `dashboard/` - GUI dashboard

### Packages (bullMQ/packages/)
- `config/` - Shared configuration
- `shared-types/` - Shared TypeScript types

## Commands (run from bullMQ/)

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install dependencies |
| `pnpm build` | Build all packages/apps (via turbo) |
| `pnpm dev` | Run all in development mode |
| `pnpm lint` | Lint all packages/apps |
| `pnpm format` | Format code with Prettier |
| `pnpm start` | Start production |

## Key Conventions

- **Package manager**: pnpm@9.0.0
- **Node**: >=18
- **TypeScript**: 6.0.3
- **Build**: tsup via Turbo
- **BullMQ**: v5.x
- **Express**: v5 (dashboard app)
- **Turbo**: v2
- The `bull/` directory is legacy and should not be modified

## Adding Dependencies
```sh
pnpm add <pkg> -w              # root workspace
pnpm add <pkg> --filter <app>  # specific app/package
```

## Dependabot

Dependabot is configured at `.github/dependabot.yml` — weekly npm updates for `bullMQ/` directory.
