# BullMQ (V5.X) with Monorepo

## Project consist of 3 apps
1. Queue
2. Consumer
3. Dashboard (GUI)

## How to run the application
```bash
git clone https://github.com/dilumdarshana/bull-queue.git

cd bull-queue

pnpm install
```

## Add dependencies to each workspace
```bash
# add to workspace root
pnpm add -D tsx -w 

# add to specific workspace
# eg: pnpm add -D typescript --filter queue
pnpm add -D typescript --filter <workspace name>

# remove from specific workspace
pnpm remove -D typescript --filter <workspace name>
```

## Install app workspace modules from root
```bash
#eg: pnpm install --filter dashboard
pnpm install --filter <workspace name>
```

## Check root workspace has same npm inside app workspace
```bash
pnpm dlx syncpack list-mismatches --filter=typescript
```