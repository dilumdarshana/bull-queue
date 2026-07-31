# BullMQ Concepts

BullMQ is a Redis-based distributed job queue library for Node.js. It is the successor to the `bull` package, offering better performance, atomic operations, parent-child flows, and Redis Cluster support.

---

## Table of Contents

- [Architecture & Job Lifecycle](#architecture--job-lifecycle)
- [Upgrading from v5 to v6](#upgrading-from-v5-to-v6)
- [Queue](#queue)
- [Worker](#worker)
- [Job](#job)
- [QueueEvents](#queueevents)
- [FlowProducer](#flowproducer)
- [Job Scheduler (Repeatable Jobs)](#job-scheduler-repeatable-jobs)
- [Connections](#connections)
- [Redis Cluster](#redis-cluster)
- [Going to Production](#going-to-production)
- [Telemetry](#telemetry)
- [Job Types](#job-types)
  - [FIFO (First-In, First-Out)](#fifo-first-in-first-out)
  - [LIFO (Last-In, First-Out)](#lifo-last-in-first-out)
  - [Delayed Jobs](#delayed-jobs)
  - [Prioritized Jobs](#prioritized-jobs)
- [Deduplication](#deduplication)
- [Rate Limiting](#rate-limiting)
- [Retries & Backoff](#retries--backoff)
- [Sandboxed Processors](#sandboxed-processors)
- [Events](#events)
- [Metrics](#metrics)
- [Auto-Removal of Jobs](#auto-removal-of-jobs)
- [Job IDs](#job-ids)
- [Returning Job Data](#returning-job-data)
- [Removing Jobs](#removing-jobs)
- [Getters](#getters)
- [Redis Cluster](#redis-cluster)
- [Going to Production](#going-to-production)
- [Telemetry](#telemetry)
- [BullMQ vs Bull](#bullmq-vs-bull)

---

## Upgrading from v5 to v6

BullMQ v6 removes the legacy repeatable-job APIs introduced before Job Schedulers. Before upgrading, move your application (and your Redis data) to the Job Scheduler model **while still on v5**.

### Recommended upgrade path

1. Upgrade to the latest BullMQ v5 release first.
2. Replace all uses of legacy repeatable-job APIs in your application code.
3. Recreate existing repeatable-job configurations as Job Schedulers.
4. Remove the legacy repeatable-job configurations from Redis.
5. Deploy BullMQ v6 only after every producer and worker is using Job Schedulers.

### Breaking changes summary

#### Job Schedulers replace repeatable jobs

Removed in v6:

- `Queue.add(..., { repeat })`
- `Queue.addBulk(..., { repeat })`
- `Queue.getRepeatableJobs()`
- `Queue.removeRepeatable()`
- `Queue.removeRepeatableByKey()`
- `Repeat`

Use the Job Scheduler APIs instead:

- `queue.upsertJobScheduler(...)`
- `queue.getJobSchedulers()`
- `queue.removeJobScheduler(...)`

#### Scheduler timezone migration (`utc` → `tz: 'UTC'`)

The legacy repeat option `repeat.utc` is removed. To run cron schedules in UTC, use:

```typescript
await queue.upsertJobScheduler('my-scheduler', { pattern: '0 15 3 * * *', tz: 'UTC' });
```

#### Deduplication replaces debounce

The legacy `debounce` option is removed in favor of deduplication, which provides more flexible behavior through deduplication ids and TTL/replace/extend modes.

#### Telemetry interface and attribute changes

- `createGauge` in the telemetry interface is no longer optional.
- Deprecated telemetry attribute enum members were removed and `JobState` was introduced.
- Worker spans no longer set the removed `JobFinishedTimestamp` attribute.
- Job metrics terminology was updated from `status` to `state`.
- `clean` telemetry now reports only the cleaned-job **count** (not full job id arrays).

#### `Queue.resume()` is asynchronous

`resume` must now be awaited:

```typescript
await queue.resume();
```

#### Flow job ids without `jobId` are now UUIDs

When creating flow jobs through `FlowProducer`, if a node does not provide `opts.jobId`, BullMQ now assigns a UUID instead of relying on Redis-style incremental ids.

#### Custom backend API updates

If you maintain a custom `IQueueBackend` implementation, v6 renames a few methods:

- `reprocessJob` → `retryFinishedJob`
- `retryJobs` → `retryFinishedJobs`
- `cleanJobsInSet` → `cleanJobsByState`
- `isJobInList` and `isJobInZSet` → `isJobInState`

#### Minimum supported Node.js version

BullMQ v6 requires **Node.js 14.17.0 or newer**.

### Dependency changes

`ioredis` (and optionally `redis`, `pg`, `bullmq-otel`) moved from direct dependencies to **optional peer dependencies** in v6. You must install the Redis client explicitly. In this repo:

- `ioredis@^5.11.1` is added to the root `package.json` of `bullMQ6/`.
- `@bull-board/api` / `@bull-board/express` (v8.4.0) still declare `bullmq@^5.79.2` as a peer, so `bullMQ6/` adds a `pnpm.peerDependencyRules.allowedVersions` entry (`bullmq: ">=6"`) to satisfy it. Remove it once Bull Board ships v6 support.

### Migrating legacy repeatable jobs

Legacy repeatable jobs stored by BullMQ v5 are **not supported** in v6 — v6 raises an error if it encounters legacy repeatable-job metadata. While still on v5:

1. Read the existing definitions with `queue.getRepeatableJobs()`.
2. For each repeatable job, create an equivalent Job Scheduler with `queue.upsertJobScheduler(...)`.
3. Verify the new scheduler is present with `queue.getJobSchedulers()`.
4. Remove the old repeatable-job definition with `queue.removeRepeatable(...)` or `queue.removeRepeatableByKey(...)`.
5. After all legacy entries are gone, deploy BullMQ v6 workers and producers.

Repeat settings map directly to scheduler options: `pattern`/`every`/`limit`/`startDate`/`endDate`/`tz` carry over, and `repeat.utc: true` becomes `{ tz: 'UTC' }`. Move the job name, data, and job options into the scheduler template argument:

```typescript
await queue.upsertJobScheduler(
  'paint-daily',
  { pattern: '0 15 3 * * *' },
  {
    name: 'paint',
    data: { color: 'blue' },
    opts: { attempts: 5, backoff: 3000 },
  },
);
```

> **Note for this repo**: `bullMQ6/` uses no repeatable jobs (the Queue producer adds ordinary `orderJob` jobs), so no application code changes were required for the v5 → v6 upgrade. Both `bullMQ/` (v5) and `bullMQ6/` (v6) share the same Redis (`bullmq-redis` on port `6379`) — run only one at a time.

---

## Architecture & Job Lifecycle

BullMQ is built entirely on Redis using atomic Lua scripts and data structures (lists, sorted sets, hashes, streams). Each queue creates several Redis keys to maintain job state.

### Job States

```
                ┌──────────────┐
                │    Added     │
                └──────┬───────┘
                       │
              ┌────────┴────────┐
              │                 │
       ┌──────▼──────┐   ┌─────▼──────┐
       │   Delayed   │   │ Prioritized│
       │  (sorted)   │   │  (sorted)  │
       └──────┬──────┘   └─────┬──────┘
              │                 │
              └────────┬────────┘
                       ▼
                ┌──────────────┐
                │    Wait      │
                │   (list)     │
                └──────┬───────┘
                       │
                       ▼
                ┌──────────────┐
                │   Active     │
                │    (set)     │
                └──────┬───────┘
                       │
              ┌────────┴────────┐
              │                 │
       ┌──────▼──────┐   ┌─────▼──────┐
       │  Completed  │   │   Failed   │
       │  (sorted)   │   │  (sorted)  │
       └─────────────┘   └────────────┘
```

**Flow Producer additional state:**
- **waiting-children** — parent job waiting for all its children to complete before moving to `wait`/`active`.

### Key Concepts

- **Polling-free**: Workers use Redis blocking list commands (`BLPOP`-style) to wait for jobs without consuming CPU.
- **Atomic operations**: Lua scripts ensure that multi-key operations are atomic.

### Delivery Semantics: At-Least-Once

BullMQ guarantees **at-least-once** delivery — a job will always be processed at least once, but may occasionally be processed more than once in failure scenarios.

#### Why double processing can happen

**1. Worker crash (stalled job)**
A worker picks up a job, starts processing, then crashes. BullMQ detects this after `stalledInterval` (default 30s) and re-queues the job for another worker. If the original worker had partially completed the work, the job runs again.

```
Worker A grabs job → starts processing → crashes → 30s stall timeout
    → BullMQ re-queues → Worker B processes the same job again
```

**2. Lock expiry (event loop blocked)**
Each active job holds a Redis lock (default 30s duration). The worker auto-extends the lock while processing. If the event loop is too busy (CPU-heavy work, high concurrency), the lock may not be extended in time, making the job available to another worker.

#### Mitigation: Idempotency

Design job processors to be **idempotent** — running the same job twice should produce the same result.

```typescript
const worker = new Worker('orders', async (job) => {
  // Check if this order was already processed
  const existing = await db.orders.findUnique(job.data.orderId);
  if (existing?.processed) {
    return { skipped: true }; // Already done, nothing to do
  }

  await chargeCustomer(job.data.orderId);
  await sendConfirmation(job.data.orderId);
});
```

Other strategies:
- Use **transactions** (e.g. wrap processing in a DB transaction with upsert)
- Use **deduplication** for preventing duplicate job adds
- Use **`removeOnComplete`** to keep job history for audit
- For long-running jobs, increase `lockDuration` or use **sandboxed processors**

---

## Queue

The `Queue` class is the entry point for adding and managing jobs.

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('queue-name', {
  connection: {
    host: 'localhost',
    port: 6379,
  },
});
```

### Key Methods

| Method               | Description                                             |
| -------------------- | ------------------------------------------------------- |
| `queue.add(name, data, opts?)` | Add a job to the queue                       |
| `queue.addBulk(jobs[])`        | Add multiple jobs atomically                  |
| `queue.pause()`               | Pause the queue (workers stop picking jobs)   |
| `queue.resume()`              | Resume a paused queue                         |
| `queue.getJob(jobId)`        | Get a job by ID                               |
| `queue.getJobs(types)`       | Get jobs by state types                       |
| `queue.getJobCounts()`        | Get counts per state                          |
| `queue.getActive()`           | Get active (in-progress) jobs                 |
| `queue.getWaiting()`          | Get waiting jobs                              |
| `queue.getDelayed()`          | Get delayed jobs                              |
| `queue.getFailed()`           | Get failed jobs                               |
| `queue.getCompleted()`        | Get completed jobs                            |
| `queue.obliterate()`          | Completely remove the queue and all its data  |
| `queue.trim()`                | Trim completed/failed job lists               |

### Options

```typescript
new Queue('name', {
  connection: { /* redis connection */ },
  prefix: 'bull',              // key prefix (default: 'bull')
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,     // keep last 100 completed
    removeOnFail: 50,          // keep last 50 failed
  },
});
```

---

## Worker

The `Worker` class processes jobs from a queue.

```typescript
import { Worker } from 'bullmq';

const worker = new Worker(
  'queue-name',
  async (job) => {
    // Process the job
    console.log(job.data);
    return { processed: true };
  },
  {
    connection: { host: 'localhost', port: 6379 },
    concurrency: 5,            // process up to 5 jobs in parallel
    autorun: true,             // start processing immediately
    limiter: { max: 10, duration: 1000 },  // rate limit
  },
);
```

### Key Concepts

- **Processor function**: An async function that receives the job. Return value becomes job's `returnvalue`.
- **Token**: Each active job gets a unique token, stored in Redis for lock management.
- **AbortSignal**: The third argument to the processor is an `AbortSignal` for cancellation detection.
- **Concurrency**: Number of jobs this worker can process simultaneously. Default `1`.
- **Stalled job detection**: If a worker crashes, jobs in `active` state longer than `stalledInterval` (default 30s) are automatically moved back to `wait` and re-processed.

### Key Methods

| Method                    | Description                               |
| ------------------------- | ----------------------------------------- |
| `worker.pause()`          | Pause processing (finishes current jobs)  |
| `worker.resume()`         | Resume processing                         |
| `worker.close()`          | Shut down the worker gracefully           |
| `worker.rateLimit(ms)`    | Manually rate limit the queue for `ms`    |

### Events (local to this worker)

```typescript
worker.on('completed', (job, returnvalue) => {});
worker.on('failed', (job, error) => {});
worker.on('progress', (job, progress) => {});
worker.on('drained', () => {});              // no more jobs left
worker.on('error', (err) => {});             // connection errors
worker.on('paused', () => {});
worker.on('resumed', () => {});
worker.on('active', (job) => {});            // job started processing
worker.on('closing', (msg) => {});           // worker is shutting down
```

---

## Job

The `Job` class represents a single job in the queue.

```typescript
interface Job {
  id: string;
  name: string;
  data: any;
  returnvalue: any;
  progress: number | object;
  attemptsMade: number;
  failedReason?: string;
  stacktrace?: string[];
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  opts: JobsOptions;
}
```

### Key Methods

| Method                                 | Description                                   |
| -------------------------------------- | --------------------------------------------- |
| `job.updateProgress(value)`            | Report progress (number or object)            |
| `job.log(logRow)`                      | Add a log row to the job                      |
| `job.discard()`                        | Discard the job (mark as completed without retry) |
| `job.remove()`                         | Remove the job from the queue                 |
| `job.retry()`                          | Retry a failed job                            |
| `job.moveToCompleted(returnvalue)`     | Manually complete the job                     |
| `job.moveToFailed(err)`                | Manually fail the job                         |
| `job.getState()`                       | Get current state                             |
| `job.getChildrenValues()`              | Get results from child jobs (flows)           |
| `job.isActive()` / `isCompleted()` / etc. | State check helpers                       |

### Job Options (when adding)

```typescript
queue.add('job-name', data, {
  priority: 10,                    // 0 = highest
  delay: 5000,                     // wait at least 5s before processing
  attempts: 3,                     // retry up to 3 times
  backoff: { type: 'exponential', delay: 2000 },
  lifo: false,                     // false = FIFO (default), true = LIFO
  removeOnComplete: true,          // remove when done
  removeOnFail: 100,               // keep last 100 failed
  stackTraceLimit: 10,             // limit error stack trace lines
  deduplication: { id: 'my-id' }, // deduplicate by id
  jobId: 'custom-id',              // custom job ID
  timeout: 30000,                  // max processing time (ms)
});
```

---

## QueueEvents

The `QueueEvents` class listens to global events using Redis streams. Unlike worker-local events, these capture activity from **all** workers.

```typescript
import { QueueEvents } from 'bullmq';

const events = new QueueEvents('queue-name', {
  connection: { host: 'localhost', port: 6379 },
});

events.on('completed', ({ jobId, returnvalue }) => {});
events.on('failed', ({ jobId, failedReason }) => {});
events.on('progress', ({ jobId, data }) => {});
events.on('delayed', ({ jobId }) => {});
events.on('waiting', ({ jobId }) => {});
events.on('active', ({ jobId }) => {});
events.on('deduplicated', ({ jobId, deduplicationId, deduplicatedJobId }) => {});
events.on('removed', ({ jobId }) => {});
```

- Events use **Redis Streams** (not pub/sub), ensuring delivery even after temporary disconnections.
- Stream is auto-trimmed (~10,000 events by default). Configure with `streams.events.maxLen`.

---

## FlowProducer

The `FlowProducer` creates parent-child job trees (DAGs). A parent job waits for all its children to complete before being processed.

```typescript
import { FlowProducer } from 'bullmq';

const flow = new FlowProducer({ connection });

const tree = await flow.add({
  name: 'parent-job',
  queueName: 'parent-queue',
  data: { orderId: 123 },
  children: [
    {
      name: 'child-1',
      data: { task: 'inventory' },
      queueName: 'child-queue',
      children: [
        {
          name: 'grandchild',
          data: { task: 'validate' },
          queueName: 'child-queue',
        },
      ],
    },
    {
      name: 'child-2',
      data: { task: 'payment' },
      queueName: 'child-queue',
    },
  ],
});
```

### Key Behaviors

- **Children can be on different queues** than the parent.
- **Arbitrary depth**: trees as deep as needed.
- **Parent state**: `waiting-children` until all children complete.
- **Children values**: parent job can access children's return values via `job.getChildrenValues()`.
- **Atomic**: the entire tree is added atomically.
- **Removal cascades**: removing a parent removes all children; removing a child removes its dependency link.

### Adding in Bulk

```typescript
const results = await flow.addBulk([
  { name: 'job1', queueName: 'q1', data: {}, children: [] },
  { name: 'job2', queueName: 'q2', data: {}, children: [] },
]);
```

---

## Job Scheduler (Repeatable Jobs)

Job Schedulers replace "repeatable jobs" from earlier versions (available from v5.16.0+). A scheduler acts as a factory that produces jobs on a schedule.

```typescript
// Every 1 second
await queue.upsertJobScheduler('my-scheduler', {
  every: 1000,
});

// Cron: daily at 3:15 AM
await queue.upsertJobScheduler('daily-report', {
  pattern: '0 15 3 * * *',
});

// With job template
await queue.upsertJobScheduler(
  'my-scheduler',
  { pattern: '0 0 * * *' },
  {
    name: 'daily-job',
    data: { report: 'sales' },
    opts: { attempts: 3, backoff: { type: 'fixed', delay: 5000 } },
  },
);
```

### Key Behaviors

- **Upsert semantics**: `upsertJobScheduler` creates or updates (idempotent, safe for deployments).
- **Next job in delayed state**: there is always exactly one delayed job representing the next occurrence.
- **New job created when last one starts**: the scheduler only produces a new job when the previous one begins processing (not when it completes).
- **Custom repeat strategies**: define your own logic via `repeatStrategy` option.
- **Management**: `queue.getJobSchedulers()`, `queue.removeJobScheduler(id)`.

---

## Connections

BullMQ requires **Redis** (>= 5.0 recommended). It uses `ioredis` by default.

### Basic Connection

```typescript
const connection = {
  host: 'localhost',
  port: 6379,
  password: 'optional',
  db: 0,
};
```

### Reusing Connections

Each class (`Queue`, `Worker`, `QueueEvents`, etc.) consumes at least one Redis connection. Classes needing blocking commands (`Worker`, `QueueEvents`) create internal duplicates automatically.

```typescript
import IORedis from 'ioredis';

const connection = new IORedis({ maxRetriesPerRequest: null });

const queue = new Queue('my-queue', { connection });
const worker = new Worker('my-queue', processor, { connection });
```

### Using node-redis

```typescript
import { createNodeRedisClient } from 'bullmq';
import { createClient } from 'redis';

const rawClient = createClient({ url: 'redis://localhost:6379' });
const connection = createNodeRedisClient(rawClient);
```

### Important

- Redis setting **`maxmemory-policy=noeviction`** is required to avoid automatic key removal.
- Do not use ioredis's `keyPrefix` option — use BullMQ's built-in `prefix` option instead.

---

## Redis Cluster

BullMQ supports Redis Cluster, but there are important considerations.

### Setup

```typescript
import IORedis from 'ioredis';

const connection = new IORedis.Cluster(
  [
    { host: 'redis-node-1', port: 6379 },
    { host: 'redis-node-2', port: 6379 },
    { host: 'redis-node-3', port: 6379 },
  ],
  {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  },
);

const queue = new Queue('my-queue', { connection });
const worker = new Worker('my-queue', processor, { connection });
```

### Key Considerations

- **Hash tags**: BullMQ uses Redis hash tags (`{queuename}`) to ensure all keys for a queue live on the same cluster node. This is critical for multi-key Lua script atomicity.
- **`maxRetriesPerRequest: null`** is required for workers to keep retrying on cluster failover.
- **Not all commands are cluster-compatible**: Some advanced features may have limitations in cluster mode.
- **Performance**: Cluster mode adds latency due to node-to-node communication overhead.

### When to Use Redis Cluster

- You need more memory than a single Redis instance can provide
- You need higher write throughput than a single instance can handle
- You need high availability with automatic failover

For most applications, a single Redis instance with replication (sentinel) is sufficient.

---

## Going to Production

### Redis Configuration

```bash
# Required for BullMQ
maxmemory-policy=noeviction

# Recommended for production
save 900 1       # RDB persistence
save 300 10
save 60 10000
appendonly yes   # AOF persistence (stronger durability)
```

### Environment Variables

Use a dedicated Redis instance or service for BullMQ. Separate your queue data from application cache data by using different Redis databases or instances.

### Worker Configuration Best Practices

```typescript
const worker = new Worker('queue', processor, {
  concurrency: 10,              // Tune based on workload
  lockDuration: 30000,          // Default 30s — increase for long jobs
  stalledInterval: 30000,       // How often to check stalled jobs
  maxStalledCount: 2,           // Max times a job can be stalled before failing

  settings: {
    backoffStrategy: (attempts) => Math.min(attempts * 1000, 30000),
  },
});

// Always attach error handlers
worker.on('error', (err) => {
  console.error('Worker Redis error:', err);
});
```

### Monitoring

- Use **Bull Board** (dashboard) to inspect queues visually
- Enable **metrics** on workers for historical performance data
- Set up alerts on queue depth (too many waiting jobs = problem)
- Monitor **failed jobs** and set up Dead Letter processing

### Graceful Shutdown

Always handle process termination to avoid stalled jobs:

```typescript
async function shutdown() {
  await worker.close();   // Wait for active jobs to finish (respects lockDuration)
  await queue.close();    // Close queue connections
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

### Memory Management

- Use `removeOnComplete` / `removeOnFail` to prevent unbounded growth
- Monitor Redis memory usage
- Set up `clean()` jobs to periodically purge old data
- Use job schedulers with care — ensure they don't produce jobs faster than workers can consume

---

## Telemetry

BullMQ supports **OpenTelemetry** integration for distributed tracing and metrics.

### Enable Telemetry

```typescript
import { Telemetry } from 'bullmq';
import { DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

// Set up OpenTelemetry
const provider = new NodeTracerProvider();
provider.addSpanProcessor(
  new SimpleSpanProcessor(new OTLPTraceExporter()),
);
provider.register();

// Enable BullMQ telemetry
Telemetry.init({
  tracer: provider.getTracer('bullmq'),
  instrumentations: {
    queue: true,
    worker: true,
  },
});
```

### What Gets Traced

- **Queue operations**: `add`, `addBulk`, `getJob`, etc.
- **Worker operations**: processing jobs, move to completed/failed
- **Flow operations**: adding flows, parent-child resolution

Each trace includes span attributes like queue name, job ID, and job state transitions.

### Metrics

Telemetry also exposes metrics counters for:
- Jobs completed / failed per queue
- Processing duration
- Queue depth (waiting jobs)

See the [BullMQ Telemetry docs](https://docs.bullmq.io/guide/telemetry) for detailed setup instructions with Jaeger, Prometheus, and other backends.

---

## Job Types

### FIFO (First-In, First-Out)

Default behavior. Jobs are processed in the order they were added.

```typescript
await queue.add('task', data);
```

### LIFO (Last-In, First-Out)

The most recently added job is processed first — like a stack. Useful when newer jobs are more relevant than older ones (e.g. updating cache with latest data, processing the most recent user action).

```typescript
await queue.add('task', data, { lifo: true });
```

LIFO and FIFO jobs live in the same Redis list. LIFO jobs are added to the **head** of the list via `LPUSH`, while FIFO jobs use `RPUSH`. Workers always pick from the head, so LIFO jobs are picked before older FIFO jobs.

**Mixing FIFO and LIFO in the same queue:**
```typescript
await queue.add('fifo-task', data);                    // RPUSH → processed after all LIFO
await queue.add('lifo-task', data, { lifo: true });    // LPUSH → processed first
await queue.add('another-fifo', data);                 // RPUSH → processed last
```

### Delayed Jobs

Jobs that wait at least a specified time before being processed.

```typescript
await queue.add('task', data, { delay: 10000 }); // 10 seconds
```

### Prioritized Jobs

BullMQ uses two separate internal structures for determining job processing order:

#### FIFO Wait List (`priority: 0` or omitted)

Jobs without a priority go into a **FIFO list** (separate from the prioritized set). These jobs are processed **first**, before any prioritized jobs. This is the default behavior — a job with no priority gets the highest effective precedence.

```typescript
await queue.add('default', data);                    // priority: 0 → FIFO (processed FIRST)
```

#### Prioritized Set (`priority: 1` to `2,097,151`)

Jobs with a priority value go into a **sorted set** where lower numbers = higher priority. This set is only processed once the FIFO wait list is empty.

| Priority | Lane | Processing Order |
|----------|------|-----------------|
| `0` (default) | FIFO wait list | **First** — drained before priority set |
| `1` | Prioritized set | Second — highest urgency in prioritized set |
| `100` | Prioritized set | Third |
| `2,097,151` (`2^21 - 1`) | Prioritized set | Last — lowest priority |

```typescript
await queue.add('urgent',   data, { priority: 1 });     // processed after FIFO is empty
await queue.add('medium',  data, { priority: 100 });     // higher number = later
await queue.add('general', data, { priority: 10000 });   // processed last
```

#### Important: The `priority: 0` Trap

Omitting priority (or setting it to `0`) puts the job in the FIFO wait list, which is **processed before all prioritized jobs**. This means:

```typescript
// ❌ BAD: general task jumps ahead of urgent tasks
queue.add('urgent',   data, { priority: 1 });    // processed second!
queue.add('general',  data);                      // processed first (oops!)

// ✅ GOOD: always set priority explicitly
queue.add('urgent',   data, { priority: 1 });    // processed first
queue.add('general',  data, { priority: 10000 }); // processed second
```

If you want a priority system where urgent jobs always come first, **always set priority explicitly** — never rely on the default `0`.

#### Internals

All prioritized jobs are stored in a single Redis **sorted set** with the priority value as the score. When a worker requests a job, BullMQ picks the lowest score. Within the same priority, jobs are processed FIFO based on their timestamp-based job ID.

Adding a prioritized job has `O(log(n))` complexity relative to the number of jobs in the sorted set.

#### Change Priority After Insertion

```typescript
const job = await Job.create(queue, 'test', { foo: 'bar' }, { priority: 16 });
await job.changePriority({ priority: 1 });   // upgrade priority
await job.changePriority({ lifo: true });     // switch to LIFO within its priority
```

---

## Job IDs

Every job in BullMQ has a unique ID. You can let BullMQ auto-generate it or provide your own.

### Auto-Generated IDs

By default, BullMQ generates a job ID using a combination of a **incrementing counter** and the **queue name**. The format is typically an integer string like `"1"`, `"2"`, etc. These IDs are unique within a queue.

### Custom Job IDs

You can provide your own ID when adding a job:

```typescript
await queue.add('task', data, { jobId: 'my-custom-id-123' });
```

This is useful for **idempotency** — if you try to add a job with an existing ID, BullMQ will reject it (no duplicate created). Combined with `removeOnComplete`, this can act as a simple deduplication mechanism.

```typescript
// Will only create one job — subsequent calls with same jobId are ignored
await queue.add('process-order', data, { jobId: `order-${orderId}` });
await queue.add('process-order', data, { jobId: `order-${orderId}` }); // ignored
```

### Job ID Constraints

- IDs must be strings
- Avoid colons (`:`) in custom IDs — BullMQ uses them as internal separators in Redis keys
- When using `FlowProducer`, parent-child relationships use job IDs internally

---

## Returning Job Data

The return value of the worker's processor function is stored as `job.returnvalue`. This is useful for passing results back to parent jobs or for auditing.

```typescript
const worker = new Worker('orders', async (job) => {
  const result = await processOrder(job.data.orderId);
  return { status: 'completed', total: result.amount };
});

// Access the return value:
// 1. Via completed event
worker.on('completed', (job, returnvalue) => {
  console.log(job.returnvalue); // { status: 'completed', total: 99.99 }
});

// 2. By fetching the job later
const job = await queue.getJob(jobId);
console.log(job.returnvalue);

// 3. From parent job via FlowProducer
const parentJob = await queue.getJob(parentId);
const childrenValues = await parentJob.getChildrenValues();
// childrenValues contains { [childJobKey]: childReturnValue }
```

### What can be returned

- Any JSON-serializable value (object, array, string, number)
- Used by `FlowProducer` to pass child results to parent jobs
- Visible in Bull Board dashboard
- Stored in Redis until removed by auto-removal policies

---

## Removing Jobs

BullMQ provides several ways to remove jobs from a queue.

### Remove a Single Job

```typescript
const job = await queue.getJob(jobId);
await job.remove();
```

### Remove from Queue by ID

```typescript
await queue.remove(jobId);
```

### Remove Jobs by State

```typescript
// Remove all failed jobs
await queue.drain({ type: 'failed' });

// Remove all completed jobs older than 24 hours
await queue.clean(86400000, 1000, 'completed');
// clean(gracePeriodMs, limit, type)
```

### Cascading Removal in Flows

When removing a job that is part of a FlowProducer tree:

1. If a **parent** is removed, all its **children** are also removed
2. If a **child** is removed, its dependency link to the parent is removed
3. If the removed child was the last dependency, the parent becomes eligible for processing
4. If any job being removed is currently **locked** (being processed), the removal fails

```typescript
// This removes all jobs in the tree
await job.remove();
```

### Drain a Queue

Completely empties a queue of all waiting/active jobs (does not affect completed/failed):

```typescript
await queue.drain();
```

### Obliterate a Queue

Completely removes the queue and all its data from Redis:

```typescript
await queue.obliterate({ force: true });
// force: true — bypasses any safety checks
```

---

## Getters

BullMQ provides rich APIs for fetching jobs by state, ID, or custom criteria.

### Get a Single Job

```typescript
const job = await queue.getJob(jobId);
```

### Get Jobs by State

```typescript
const active = await queue.getActive();         // currently processing
const waiting = await queue.getWaiting();        // waiting to be processed
const delayed = await queue.getDelayed();        // delayed jobs
const completed = await queue.getCompleted();    // completed jobs
const failed = await queue.getFailed();          // failed jobs
const prioritized = await queue.getPrioritized(); // prioritized jobs
```

### Get Jobs by Multiple States

```typescript
const jobs = await queue.getJobs(['active', 'waiting', 'delayed']);
```

### Get Job Counts

```typescript
const counts = await queue.getJobCounts();
// { wait: 5, active: 2, completed: 100, failed: 3, delayed: 1 }
```

### Get Job Counts Per Priority

```typescript
const counts = await queue.getCountsPerPriority([1, 5, 10]);
// { '1': 3, '5': 7, '10': 0 }
```

### Get Job Logs

```typescript
const logs = await job.getLogs();         // get all logs
const logs = await job.getLogs(0, 10);    // paginated (start, end)
await job.log('Custom log entry');        // add a log entry
```

### Pagination for Large Queues

Most getter methods support pagination using `start` and `end` parameters (0-indexed):

```typescript
const first10 = await queue.getCompleted(0, 9);
const next10 = await queue.getCompleted(10, 19);
```

### Flow-Related Getters

```typescript
await job.getChildrenValues();        // get return values from child jobs
await job.getDependencies();          // get all child jobs
await job.getDependencies({           // get specific types
  processed: { count: 5, cursor: 0 },
  failed: { count: 5, cursor: 0 },
});
await job.getDependenciesCount();     // get counts of child jobs by state
```

---

Deduplication prevents duplicate jobs from being added within a given time window.

### Simple Mode

No new job with the same `deduplication.id` is added while the original job is still incomplete (waiting/active).

```typescript
await queue.add('task', data, { deduplication: { id: 'unique-key' } });
```

### Throttle Mode (TTL)

No duplicate for `ttl` milliseconds regardless of job status.

```typescript
await queue.add('task', data, {
  deduplication: { id: 'unique-key', ttl: 5000 },
});
```

### Debounce Mode

Each new addition replaces the previous one and resets the TTL. Only the latest data survives.

```typescript
await queue.add('task', data, {
  deduplication: { id: 'unique-key', ttl: 5000, extend: true, replace: true },
  delay: 5000,
});
```

### Keep Last If Active

When a job with the same dedup ID is currently being processed, stores the latest data and creates a new job as soon as the active one finishes.

```typescript
await queue.add('deploy', { commit: sha }, {
  deduplication: { id: `deploy-${repo}`, keepLastIfActive: true },
});
```

### Deduplicated Event

```typescript
events.on('deduplicated', ({ jobId, deduplicationId, deduplicatedJobId }) => {
  console.log(`Job ${deduplicatedJobId} was deduplicated`);
});
```

---

## Rate Limiting

Limit the number of jobs processed per time unit across **all workers** for a queue.

```typescript
const worker = new Worker('queue', processor, {
  limiter: {
    max: 10,         // max jobs
    duration: 1000,  // per 1000ms
  },
});
```

### Manual Rate Limit

```typescript
await worker.rateLimit(5000); // rate limit for 5 seconds
```

### Check Rate Limit TTL

```typescript
const ttl = await queue.getRateLimitTtl(10); // ms until 10 more jobs allowed
```

### Remove Rate Limit

```typescript
await queue.removeRateLimitKey(); // resets limiter
```

---

## Retries & Backoff

Jobs can be automatically retried on failure with configurable backoff strategies.

### Attempts

```typescript
await queue.add('task', data, { attempts: 5 });
```

### Built-in Backoff Strategies

**Fixed** — constant delay between retries:

```typescript
backoff: { type: 'fixed', delay: 2000 }
```

**Exponential** — delay doubles with each retry: `2^(attempt-1) * delay`

```typescript
backoff: { type: 'exponential', delay: 1000 }
// attempt 1: 1s, attempt 2: 2s, attempt 3: 4s, attempt 4: 8s ...
```

**With jitter** — adds randomness to avoid thundering herd:

```typescript
backoff: { type: 'exponential', delay: 1000, jitter: 0.5 }
```

### Custom Backoff Strategy

```typescript
const worker = new Worker('queue', processor, {
  settings: {
    backoffStrategy: (attemptsMade: number, type: string, err: Error, job: Job) => {
      return attemptsMade * 1000;
    },
  },
});
```

### Manual Retry

```typescript
const job = await queue.getJob(jobId);
await job.retry();
```

---

## Sandboxed Processors

Run job processing in an **isolated child process** to prevent CPU-heavy jobs from blocking the event loop.

### Processor File

```typescript
// my-processor.ts
import { SandboxedJob } from 'bullmq';

module.exports = async (job: SandboxedJob) => {
  // heavy computation here
  return { result: 'done' };
};
```

### Worker

```typescript
const worker = new Worker('queue', path.join(__dirname, 'my-processor.js'));
```

### Worker Threads (alternative to child process)

```typescript
const worker = new Worker('queue', processorFile, { useWorkerThreads: true });
```

---

## Events

BullMQ emits events through two mechanisms:

### Local Events (per-instance)

Directly on `Queue`, `Worker`, `QueueEvents` instances:

| Event        | Emitter        | Description                          |
| ------------ | -------------- | ------------------------------------ |
| `completed`  | Worker         | Job completed by this worker         |
| `failed`     | Worker         | Job failed on this worker            |
| `progress`   | Worker         | Progress update from this worker     |
| `drained`    | Worker         | Queue has no more jobs               |
| `error`      | Worker         | Connection/Redis error               |
| `active`     | Worker         | Job started processing               |
| `paused`     | Queue/Worker   | Queue/Worker paused                  |
| `resumed`    | Queue/Worker   | Queue/Worker resumed                 |
| `waiting`    | Queue          | New job is waiting                   |
| `cleaned`    | Queue          | Old jobs cleaned                     |

### Global Events (via QueueEvents)

Using Redis streams, captures events from **all workers**:

```typescript
const events = new QueueEvents('queue-name');
events.on('completed', ({ jobId, returnvalue }) => {});
events.on('failed', ({ jobId, failedReason }) => {});
events.on('progress', ({ jobId, data }) => {});
events.on('active', ({ jobId }) => {});
events.on('delayed', ({ jobId }) => {});
events.on('waiting', ({ jobId }) => {});
events.on('deduplicated', ({ jobId, deduplicationId }) => {});
events.on('removed', ({ jobId }) => {});
```

---

## Metrics

BullMQ provides per-minute metrics for completed and failed jobs.

### Enable

```typescript
import { MetricsTime } from 'bullmq';

const worker = new Worker('queue', processor, {
  metrics: {
    maxDataPoints: MetricsTime.ONE_WEEK * 2, // 2 weeks of data
  },
});
```

### Query

```typescript
const metrics = await queue.getMetrics('completed', 0, MetricsTime.ONE_WEEK * 2);
// { data: number[], count: number, meta: { count, prevTS, prevCount } }
```

Each index in `data` represents one minute, with the count of jobs completed/failed in that minute.

---

## Auto-Removal of Jobs

Control how many completed/failed jobs to retain to prevent Redis memory growth.

### Per-Job

```typescript
queue.add('task', data, {
  removeOnComplete: { count: 100 },  // keep last 100 completed
  removeOnFail: { count: 50 },       // keep last 50 failed
  // shorthand:
  removeOnComplete: true,            // remove immediately on complete
  removeOnFail: 1000,                 // keep last 1000 failed
});
```

### Default for Queue

```typescript
new Queue('name', {
  defaultJobOptions: {
    removeOnComplete: { age: 86400 },  // keep for 24h
    removeOnFail: { count: 100 },
  },
});
```

---

## BullMQ vs Bull

| Feature                    | Bull (deprecated)  | BullMQ              |
| -------------------------- | ------------------ | ------------------- |
| **Package**                | `bull`             | `bullmq`            |
| **Status**                 | Maintenance only   | Active development  |
| **Redis Cluster**          | No                 | Yes                 |
| **Parent-Child Flows**     | No                 | Yes                 |
| **Deduplication**          | Basic              | Full (simple, throttle, debounce) |
| **Job Schedulers**         | No                 | Yes (v5.16+)        |
| **QueueEvents (streams)**  | No                 | Yes                 |
| **Metrics**                | No                 | Yes                 |
| **Atomic Lua scripts**     | Partial            | Full                |
| **TypeScript**             | Community types    | First-class         |
| **Multi-language support** | Node.js only       | Python, Rust, Elixir, PHP |
| **Bull Board**             | Compatible         | Compatible          |
| **Express 5 support**      | No                 | Yes                 |

---

## Quick Reference: Common Patterns

### Producer-Consumer Setup

```typescript
// Producer
const queue = new Queue('orders', { connection });
await queue.add('process-order', { orderId: 123, amount: 99.99 });

// Consumer
const worker = new Worker('orders', async (job) => {
  const { orderId, amount } = job.data;
  await processPayment(orderId, amount);
  await sendConfirmation(orderId);
  return { status: 'ok' };
}, { connection });
```

### Job with Retries and Backoff

```typescript
await queue.add('email', { to: 'user@example.com' }, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
});
```

### Scheduled Job (Cron)

```typescript
await queue.upsertJobScheduler('midnight-cleanup', {
  pattern: '0 0 * * *',  // every midnight
}, {
  name: 'cleanup',
  data: { purge: true },
});
```

### Parallel Processing with Concurrency

```typescript
const worker = new Worker('queue', processor, {
  concurrency: 10, // process 10 jobs simultaneously
});
```

### Graceful Shutdown

```typescript
process.on('SIGTERM', async () => {
  await worker.close();  // wait for active jobs to finish
});
```

---

## Batching

BullMQ offers several ways to handle jobs in batches, depending on whether you want to add or process jobs in bulk.

### Adding Jobs in Bulk (Producer Side)

Use `addBulk` to atomically add multiple jobs to a queue. Workers still receive and process them **one by one**.

```typescript
await queue.addBulk([
  { name: 'order', data: { orderId: 1, amount: 50 } },
  { name: 'order', data: { orderId: 2, amount: 75 } },
  { name: 'order', data: { orderId: 3, amount: 100 } },
]);
// Worker processes each job individually
```

This is more efficient than calling `queue.add()` in a loop — it uses a single Redis transaction.

### Processing Jobs in a Batch (Worker Side)

BullMQ open-source does **not** have a native batch processor. To process work in batches, design your producer to group items into a single job:

```typescript
// Producer — batch items into one job
await queue.add('batch-process', {
  batchId: 'batch-001',
  items: [
    { id: 1, type: 'email' },
    { id: 2, type: 'email' },
    { id: 3, type: 'email' },
  ],
});

// Worker — process all items in one processor call
const worker = new Worker('queue', async (job) => {
  if (job.name === 'batch-process') {
    const results = await Promise.allSettled(
      job.data.items.map((item) => processItem(item))
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    console.log(`Batch ${job.data.batchId}: ${succeeded} ok, ${failed} failed`);
    return { succeeded, failed };
  }
});
```

### Using Concurrency for "Logical Batching"

If you set `concurrency: 10`, a single worker processes up to 10 jobs simultaneously. This gives you aggregate throughput similar to batching, but each job remains individually tracked:

```typescript
const worker = new Worker('queue', processor, {
  concurrency: 10,  // 10 jobs processed in parallel
});
```

### When to use each approach

| Approach | Best For | Trade-off |
|----------|----------|-----------|
| `addBulk` + individual processing | Independent jobs that need individual retries | More Redis operations |
| Grouped single job | Related work that should succeed/fail together | Single point of failure for the batch |
| `concurrency: N` | I/O-bound work at high throughput | No atomic batch semantics |
| BullMQ Pro `batches` | Native batch processing with Redis optimization | Paid feature |

### BullMQ Pro Batches

BullMQ Pro (paid) provides a native `batches` feature where workers receive multiple jobs in a single processor call, reducing Redis round-trips. See [BullMQ Pro documentation](https://docs.bullmq.io/bullmq-pro/batches) for details.

---

## BullMQ vs Amazon SQS

BullMQ and AWS SQS are both queue systems but target different use cases. Here's a feature comparison:

| Feature | BullMQ | AWS SQS |
|---------|--------|---------|
| **Backend** | Redis | AWS-managed |
| **Pricing** | Free (Redis cost only) | Pay per request |
| **Latency** | Sub-millisecond | 10-100ms typical |
| **Visibility Timeout** | `lockDuration` (auto-extending) | `VisibilityTimeout` (fixed, no auto-extend) |
| **Max Visibility Timeout** | Unlimited (auto-extends) | 12 hours (fixed) |
| **Job Size Limit** | Redis limit (~512MB) | 256KB (max) |
| **Message Retention** | Unlimited (Redis memory) | 14 days max |
| **Retries** | `attempts` + `backoff` (fixed, exponential, custom) | Redrive policy + DLQ |
| **Scheduling / Delayed** | Native (`delay`, cron via `upsertJobScheduler`) | Delay queue (up to 15 min) |
| **Priorities** | Yes (0 to 2,097,151) | No |
| **Batch Operations** | `addBulk`, `addBulk` flows | `SendMessageBatch` (10 msg max) |
| **FIFO Queues** | Yes (via `removeOnComplete` + polling) | FIFO queues (300 msg/s) |
| **Dead Letter Queue** | Failed job set (built-in) | Separate DLQ (required) |
| **Progress Tracking** | `job.updateProgress()` | No |
| **Parent-Child Dependencies** | Yes (`FlowProducer`) | No |
| **Rate Limiting** | Global per-queue | No |
| **Metrics** | Built-in (per-minute) | CloudWatch metrics |
| **Events / Notifications** | `QueueEvents` (Redis streams) | SQS polling + SNS + Lambda triggers |
| **Guarantee** | At-least-once | At-least-once (standard) / Exactly-once (FIFO) |
| **Ordering** | FIFO + priority + delayed | Best-effort (standard) / Strict FIFO |
| **Max Message Size** | ~512MB | 256KB |
| **Polling** | Blocking (no CPU usage) | Long polling (HTTP request-based) |
| **Reliability** | Depends on Redis HA | AWS-managed, multi-AZ |
| **Language Support** | Multi (Node, Python, Rust, Elixir, PHP) | Any (HTTP API) |
| **Local Dev** | Docker Redis | LocalStack or AWS account |

### When to use which

**Choose BullMQ when:** you need rich job features (retries, priorities, flows, scheduling), low latency, want to run locally without cloud costs, or need control over your infrastructure.

**Choose SQS when:** you need fully-managed infinite scalability, don't want to operate Redis, or are already deep in AWS ecosystem and need simple message passing between services.

---

## References

- [Official Documentation](https://docs.bullmq.io)
- [API Reference](https://api.docs.bullmq.io)
- [GitHub Repository](https://github.com/taskforcesh/bullmq)
- [BullMQ Blog](https://blog.taskforce.sh/)
