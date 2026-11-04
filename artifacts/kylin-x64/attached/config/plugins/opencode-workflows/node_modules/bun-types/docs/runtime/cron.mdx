---
title: Cron
description: Schedule and parse cron jobs with Bun
---

Bun has built-in support for cron — parse expressions, run a callback on a schedule inside your process, or register OS-level jobs that survive restarts.

## Quickstart

**Run a callback on a schedule in the current process:**

```ts
Bun.cron("0 * * * *", async () => {
  await cleanupTempFiles();
});
```

**Parse a cron expression to find the next matching time:**

```ts
// Next weekday at 9:30 AM UTC
const next = Bun.cron.parse("30 9 * * MON-FRI");
```

**Register an OS-level cron job that runs a script on a schedule:**

```ts
await Bun.cron("./worker.ts", "30 2 * * MON", "weekly-report");
```

---

## `Bun.cron.parse()`

Parse a cron expression and return the next matching `Date` in UTC.

```ts
const next = Bun.cron.parse("*/15 * * * *");
console.log(next); // => next quarter-hour boundary
```

### Parameters

| Parameter      | Type             | Description                                              |
| -------------- | ---------------- | -------------------------------------------------------- |
| `expression`   | `string`         | A 5-field cron expression or predefined nickname         |
| `relativeDate` | `Date \| number` | Starting point for the search (defaults to `Date.now()`) |

### Returns

`Date | null` — the next matching time, or `null` if no match exists within 8 years (e.g. February 30th).

### Chaining calls

Call `parse()` repeatedly to get a sequence of upcoming times:

```ts
let cursor: Date | number = Date.now();
for (let i = 0; i < 3; i++) {
  cursor = Bun.cron.parse("0 * * * *", cursor)!;
  console.log(cursor.toLocaleString()); // next three top-of-hour boundaries
}
```

---

## Cron expression syntax

Standard 5-field format: `minute hour day-of-month month day-of-week`

| Field        | Values                  | Special characters |
| ------------ | ----------------------- | ------------------ |
| Minute       | `0`–`59`                | `*` `,` `-` `/`    |
| Hour         | `0`–`23`                | `*` `,` `-` `/`    |
| Day of month | `1`–`31`                | `*` `,` `-` `/`    |
| Month        | `1`–`12` or `JAN`–`DEC` | `*` `,` `-` `/`    |
| Day of week  | `0`–`7` or `SUN`–`SAT`  | `*` `,` `-` `/`    |

### Special characters

| Character | Description | Example                               |
| --------- | ----------- | ------------------------------------- |
| `*`       | All values  | `* * * * *` — every minute            |
| `,`       | List        | `1,15 * * * *` — minute 1 and 15      |
| `-`       | Range       | `9-17 * * * *` — minutes 9 through 17 |
| `/`       | Step        | `*/15 * * * *` — every 15 minutes     |

### Named values

Month and weekday fields accept case-insensitive names:

```ts
// 3-letter abbreviations
Bun.cron.parse("0 9 * * MON-FRI"); // weekdays
Bun.cron.parse("0 0 1 JAN,JUN *"); // January and June

// Full names
Bun.cron.parse("0 9 * * Monday-Friday");
Bun.cron.parse("0 0 1 January *");
```

Both `0` and `7` mean Sunday in the weekday field.

### Predefined nicknames

| Nickname                | Equivalent  | Description               |
| ----------------------- | ----------- | ------------------------- |
| `@yearly` / `@annually` | `0 0 1 1 *` | Once a year (January 1st) |
| `@monthly`              | `0 0 1 * *` | Once a month (1st day)    |
| `@weekly`               | `0 0 * * 0` | Once a week (Sunday)      |
| `@daily` / `@midnight`  | `0 0 * * *` | Once a day (midnight)     |
| `@hourly`               | `0 * * * *` | Once an hour              |

```ts
const next = Bun.cron.parse("@daily");
console.log(next); // => next UTC midnight
```

### Time zone

`Bun.cron.parse()` and the in-process `Bun.cron(schedule, handler)` interpret schedules in **UTC**. There is no DST to handle — `0 9 * * *` always means 9:00 UTC.

The OS-level `Bun.cron(path, schedule, title)` uses the **system's local time zone**, because that's how crontab, launchd, and Windows Task Scheduler work. To make the two forms agree, run the process with `TZ=UTC`.

### Day-of-month and day-of-week interaction

When **both** day-of-month and day-of-week are specified (neither is `*`), the expression matches when **either** condition is true. This follows the [POSIX cron](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/crontab.html) standard.

```ts
// Fires on the 15th of every month OR every Friday
Bun.cron.parse("0 0 15 * FRI");
```

When only one is specified (the other is `*`), only that field is used for matching.

---

## `Bun.cron(schedule, handler)` — in-process

Run a callback on a cron schedule inside the current process.

```ts
const job = Bun.cron("*/5 * * * *", async () => {
  await syncToDatabase();
});
```

This is the lightweight option for long-running servers and workers — no system cron daemon required, works the same on every platform, and shares state (database pools, caches, module-level variables) between invocations.

|                              | In-process                       | [OS-level](#bun-cron-path-schedule-title-os-level) |
| ---------------------------- | -------------------------------- | -------------------------------------------------- |
| Survives process exit/reboot | No                               | Yes                                                |
| Shared state between runs    | Yes                              | No (fresh process each time)                       |
| Platform requirements        | None                             | crontab / launchd / Task Scheduler                 |
| Windows expression limits    | None                             | [48-trigger cap](#trigger-limit)                   |
| Return type                  | [`CronJob`](#the-cronjob-handle) | `Promise<void>`                                    |

### Parameters

| Parameter  | Type                         | Description                                                                                                                                                                  |
| ---------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schedule` | `string`                     | A [cron expression](#cron-expression-syntax) or nickname like `"@hourly"`.                                                                                                   |
| `handler`  | `(this: CronJob) => unknown` | Called on each fire. May return a Promise — the next fire is not scheduled until it settles. Inside a `function` callback, `this` is the `CronJob` (so `this.stop()` works). |

Returns a [`CronJob`](#the-cronjob-handle) synchronously. Throws a `TypeError` if the expression is invalid or has no future occurrences (e.g. `"0 0 30 2 *"` — February 30th).

### No-overlap guarantee

The next fire time is computed only after the handler — including any returned `Promise` — settles. If your handler takes 90 seconds and the schedule is `* * * * *`, the second fire is the first minute boundary _after_ the handler finishes, not 60 seconds after the first fire. Invocations never stack.

### Error handling

Errors match `setTimeout` semantics:

- A synchronous `throw` emits `process.on("uncaughtException")`.
- A rejected returned `Promise` emits `process.on("unhandledRejection")`.

Without a listener, the process exits with code `1`. With a listener, the job keeps running — it does not stop on the first failure.

```ts
process.on("unhandledRejection", err => log.error("cron failed:", err));

Bun.cron("* * * * *", async () => {
  await mightThrow(); // logged and retried next minute
});
```

### `bun --hot`

Under `bun --hot`, all in-process cron jobs are stopped immediately before the module graph re-evaluates. Every `Bun.cron()` call still in your source then re-registers. Editing the schedule, editing the handler, or deleting the line entirely all take effect on save without leaking timers.

### The `CronJob` handle

```ts
using job = Bun.cron("0 * * * *", () => {});

job.cron; // => "0 * * * *"
job.stop(); // cancel — the handler will not fire again
job.unref(); // allow the process to exit even while scheduled
job.ref(); // keep the process alive (default)
```

`CronJob` is [`Disposable`](https://github.com/tc39/proposal-explicit-resource-management) — `using job = Bun.cron(...)` auto-stops at scope exit. `stop()`, `ref()`, and `unref()` all return the job for chaining.

### Fake timers

In-process cron is anchored to the real wall clock. `jest.useFakeTimers()`, `setSystemTime()`, `advanceTimersByTime()`, and `runAllTimers()` do not affect when it fires.

---

## `Bun.cron(path, schedule, title)` — OS-level

Register an OS-level cron job that runs a JavaScript/TypeScript module on a schedule.

```ts
await Bun.cron("./worker.ts", "30 2 * * MON", "weekly-report");
```

### Parameters

| Parameter  | Type     | Description                                                |
| ---------- | -------- | ---------------------------------------------------------- |
| `path`     | `string` | Path to the script (resolved relative to caller)           |
| `schedule` | `string` | Cron expression or nickname                                |
| `title`    | `string` | Unique job identifier (alphanumeric, hyphens, underscores) |

Re-registering with the same `title` overwrites the existing job in-place — the old schedule is replaced, not duplicated.

```ts
await Bun.cron("./worker.ts", "0 * * * *", "my-job"); // every hour
await Bun.cron("./worker.ts", "*/15 * * * *", "my-job"); // replaces: every 15 min
```

### The `scheduled()` handler

The registered script must export a default object with a `scheduled()` method, following the [Cloudflare Workers Cron Triggers API](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/):

```ts worker.ts
export default {
  scheduled(controller: Bun.CronController) {
    console.log(controller.cron); // "30 2 * * 1"
    console.log(controller.type); // "scheduled"
    console.log(controller.scheduledTime); // 1737340201847 (Date.now() at invocation)
  },
};
```

The handler can be `async`. Bun waits for the returned promise to settle before exiting.

---

## How it works per platform

### Linux

Bun uses [crontab](https://man7.org/linux/man-pages/man5/crontab.5.html) to register jobs. Each job is stored as a line in your user's crontab with a `# bun-cron: <title>` marker comment above it.

The crontab entry looks like:

```
<schedule> '<bun-path>' run --cron-title=<title> --cron-period='<schedule>' '<script-path>'
```

When the cron daemon fires the job, Bun imports your module and calls the `scheduled()` handler.

**Viewing registered jobs:**

```sh
crontab -l
```

**Logs:** On Linux, cron output goes to the system log. Check with:

```sh
# systemd-based (Ubuntu, Fedora, Arch, etc.)
journalctl -u cron       # or crond on some distros
journalctl -u cron --since "1 hour ago"

# syslog-based (older systems)
grep CRON /var/log/syslog
```

To capture stdout/stderr to a file, redirect output in the crontab entry directly, or add logging inside your `scheduled()` handler.

**Manually uninstalling without code:**

```sh
# Edit your crontab and remove the "# bun-cron: <title>" comment
# and the command line below it
crontab -e

# Or remove ALL bun cron jobs at once by filtering them out:
crontab -l | grep -v "# bun-cron:" | grep -v "\-\-cron-title=" | crontab -
```

### macOS

Bun uses [launchd](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) to register jobs. Each job is installed as a plist file at:

```
~/Library/LaunchAgents/bun.cron.<title>.plist
```

The plist uses `StartCalendarInterval` to define the schedule. Complex patterns with ranges, lists, or steps are supported — Bun expands them into multiple `StartCalendarInterval` dicts via Cartesian product.

**Viewing registered jobs:**

```sh
launchctl list | grep bun.cron
```

**Logs:** stdout and stderr are written to:

```
/tmp/bun.cron.<title>.stdout.log
/tmp/bun.cron.<title>.stderr.log
```

For example, a job titled `weekly-report`:

```sh
cat /tmp/bun.cron.weekly-report.stdout.log
tail -f /tmp/bun.cron.weekly-report.stderr.log
```

**Manually uninstalling without code:**

```sh
# Unload the job from launchd
launchctl bootout gui/$(id -u)/bun.cron.<title>

# Delete the plist file
rm ~/Library/LaunchAgents/bun.cron.<title>.plist

# Example for a job titled "weekly-report":
launchctl bootout gui/$(id -u)/bun.cron.weekly-report
rm ~/Library/LaunchAgents/bun.cron.weekly-report.plist
```

### Windows

Bun uses [Windows Task Scheduler](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page) with XML-based task definitions. Each job is registered as a scheduled task named `bun-cron-<title>` using [`CalendarTrigger`](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-calendartrigger-triggergroup-element) elements and [`Repetition`](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-repetition-triggerbasetype-element) patterns.

Most cron expressions are fully supported, including `@daily`, `@weekly`, `@monthly`, `@yearly`, ranges (`1-5`), lists (`1,15`), named days/months, and day-of-month patterns.

#### User context

Tasks are registered using [`S4U` (Service-for-User)](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-logontype-simpletype) logon type, which runs jobs as the registering user even when not logged in — matching Linux `crontab` behavior. No password is stored.

TCP/IP networking (`fetch()`, HTTP, WebSocket, database connections) works normally. The only restriction is that S4U tasks cannot access [Windows-authenticated network resources](https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks) (SMB file shares, mapped drives, Kerberos/NTLM services).

On headless servers and CI environments where the current user's [Security Identifier (SID)](https://learn.microsoft.com/en-us/windows/security/identity-protection/access-control/security-identifiers) cannot be resolved — such as service accounts created by [NSSM](https://nssm.cc/) or similar tools — `Bun.cron()` will fail with an error explaining the issue. To work around this, either run Bun as a regular user account, or create the scheduled task manually with `schtasks /create /xml <file> /tn <name> /ru SYSTEM /f`.

#### Trigger limit

<Warning>
  Windows Task Scheduler enforces a limit of [48 triggers per
  task](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-triggers-tasktype-element) (the
  `CalendarTrigger` element has
  [`maxOccurs="48"`](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-calendartrigger-triggergroup-element)).
  Some cron expressions that work on Linux and macOS exceed this limit on Windows. When a pattern exceeds the limit,
  `Bun.cron()` rejects it with an error message.
</Warning>

**Expressions that work on all platforms:**

| Pattern                                    | Trigger strategy                                                                                                                                           | Count |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `*/5 * * * *`                              | Single trigger with [`Repetition`](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-repetition-triggerbasetype-element) (PT5M) | 1     |
| `*/15 * * * *`                             | Single trigger with Repetition (PT15M)                                                                                                                     | 1     |
| `0 9 * * MON-FRI`                          | One `CalendarTrigger` per weekday                                                                                                                          | 5     |
| `0,30 9-17 * * *`                          | 2 minutes × 9 hours                                                                                                                                        | 18    |
| `@daily`, `@weekly`, `@monthly`, `@yearly` | Single trigger                                                                                                                                             | 1     |

**Expressions that fail on Windows** (but work on Linux and macOS):

| Pattern           | Why                                           | Trigger count |
| ----------------- | --------------------------------------------- | ------------- |
| `*/7 * * * *`     | 9 minute values × 24 hours                    | 216           |
| `*/8 * * * *`     | 8 minute values × 24 hours                    | 192           |
| `*/9 * * * *`     | 7 minute values × 24 hours                    | 168           |
| `*/11 * * * *`    | 6 minute values × 24 hours                    | 144           |
| `*/13 * * * *`    | 5 minute values × 24 hours                    | 120           |
| `*/15 * * 6 *`    | Month restriction prevents Repetition: 4 × 24 | 96            |
| `0,30 * 15 * FRI` | OR-split doubles triggers: 2 × 24 × 2         | 96            |

The key factor is whether the expression can use a [`Repetition`](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-repetition-triggerbasetype-element) interval (single trigger) or must expand to individual `CalendarTrigger` elements. Minute steps that **evenly divide 60** (`*/1`, `*/2`, `*/3`, `*/4`, `*/5`, `*/6`, `*/10`, `*/12`, `*/15`, `*/20`, `*/30`) use Repetition and work regardless of other fields. Steps that don't divide 60 (`*/7`, `*/8`, `*/9`, `*/11`, `*/13`, etc.) must be expanded, and with 24 hours active, the count quickly exceeds 48.

To work around it, simplify the expression or restrict the hour range:

```ts
// ❌ Fails on Windows: */7 with all hours = 216 triggers
await Bun.cron("./job.ts", "*/7 * * * *", "my-job");

// ✅ Works: restrict to specific hours (9 values × 5 hours = 45 triggers)
await Bun.cron("./job.ts", "*/7 9-13 * * *", "my-job");

// ✅ Works: use a divisor of 60 instead (Repetition, 1 trigger)
await Bun.cron("./job.ts", "*/5 * * * *", "my-job");
```

#### Windows containers

<Warning>
  `Bun.cron()` is not supported in Windows Docker containers. The Task Scheduler service is not running in `servercore`
  or `nanoserver` images. Use an in-process scheduler for containerized workloads.
</Warning>

**Viewing registered jobs:**

```powershell
schtasks /query /tn "bun-cron-<title>"

# List all bun cron tasks
schtasks /query | findstr "bun-cron-"
```

**Manually uninstalling without code:**

```powershell
schtasks /delete /tn "bun-cron-<title>" /f

# Example:
schtasks /delete /tn "bun-cron-weekly-report" /f
```

Or open **Task Scheduler** (taskschd.msc), find the task named `bun-cron-<title>`, right-click, and delete it.

---

## `Bun.cron.remove()`

Remove a previously registered cron job by its title. Works on all platforms.

```ts
await Bun.cron.remove("weekly-report");
```

This reverses what `Bun.cron()` did:

| Platform | What `remove()` does                                     |
| -------- | -------------------------------------------------------- |
| Linux    | Edits crontab to remove the entry and its marker comment |
| macOS    | Runs `launchctl bootout` and deletes the plist file      |
| Windows  | Runs `schtasks /delete` to remove the scheduled task     |

Removing a job that doesn't exist resolves without error.
