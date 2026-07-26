# BullMQ Concepts

BullMQ is a Redis-based distributed job queue library for Node.js. It is the successor to the `bull` package, offering better performance, atomic operations, parent-child flows, and Redis Cluster support.

---

## Table of Contents

- [Architecture & Job Lifecycle](#architecture--job-lifecycle)
- [Queue](#queue)
- [Worker](#worker)
- [Job](#job)
- [QueueEvents](#queueevents)
- [FlowProducer](#flowproducer)
- [Job Scheduler (Repeatable Jobs)](#job-scheduler-repeatable-jobs)
- [Connections](#connections)
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
- [BullMQ vs Bull](#bullmq-vs-bull)

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
- **Exactly-once semantics**: Best-effort exactly-once delivery; at-least-once in worst-case scenarios (e.g., worker crashes after processing but before acknowledging).

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

## Job Types

### FIFO (First-In, First-Out)

Default behavior. Jobs are processed in the order they were added.

```typescript
await queue.add('task', data);
```

### LIFO (Last-In, First-Out)

The most recently added job is processed first.

```typescript
await queue.add('task', data, { lifo: true });
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

## Deduplication

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

## References

- [Official Documentation](https://docs.bullmq.io)
- [API Reference](https://api.docs.bullmq.io)
- [GitHub Repository](https://github.com/taskforcesh/bullmq)
- [BullMQ Blog](https://blog.taskforce.sh/)
