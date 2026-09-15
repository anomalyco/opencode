import { Duration, Effect, Schedule, Schema, Stream } from "effect"
import { AIError, TimeoutError } from "./schema/errors.js"

export const Status = Schema.Literals(["queued", "running", "completed", "failed", "cancelled", "expired"])
export type Status = Schema.Schema.Type<typeof Status>

/** Provider-neutral view of one job observation. */
export interface Snapshot {
  readonly id: string
  readonly status: Status
  /** Normalized 0..1 when the provider reports progress. */
  readonly progress?: number
  readonly position?: number
  readonly expiresAt?: number
}

/**
 * Route-owned job operations. `token` is the route's serializable handle (operation name, task id, response URL)
 * so a job can be resumed from another process; its shape is opaque to `Job`.
 */
export interface Route<Response> {
  readonly status: (token: unknown) => Effect.Effect<Snapshot, AIError>
  readonly result: (token: unknown) => Effect.Effect<Response, AIError>
  readonly cancel?: (token: unknown) => Effect.Effect<void, AIError>
  /** Provider polling hint (e.g. `openai-poll-after-ms`) that overrides the default interval for the next poll. */
  readonly pollHint?: (snapshot: Snapshot) => Duration.Duration | undefined
}

export interface Poll {
  readonly interval?: Duration.Input
  readonly timeout?: Duration.Input
  /** Full override of the polling schedule; `interval` and `pollHint` are ignored when supplied. */
  readonly schedule?: Schedule.Schedule<unknown, Snapshot>
}

export const DEFAULT_POLL_INTERVAL = Duration.seconds(5)
export const DEFAULT_POLL_TIMEOUT = Duration.minutes(10)

export type Event =
  | { readonly type: "job-queued"; readonly id: string; readonly position?: number }
  | { readonly type: "job-progress"; readonly id: string; readonly progress?: number }
  | { readonly type: "job-finished"; readonly id: string; readonly status: Status }

const TERMINAL: ReadonlySet<Status> = new Set(["completed", "failed", "cancelled", "expired"])

export class Job<Response> {
  readonly id: string
  readonly status: Status
  readonly progress?: number
  readonly position?: number
  readonly expiresAt?: number

  constructor(
    readonly route: Route<Response>,
    readonly token: unknown,
    snapshot: Snapshot,
  ) {
    this.id = snapshot.id
    this.status = snapshot.status
    this.progress = snapshot.progress
    this.position = snapshot.position
    this.expiresAt = snapshot.expiresAt
  }

  get snapshot(): Snapshot {
    return {
      id: this.id,
      status: this.status,
      progress: this.progress,
      position: this.position,
      expiresAt: this.expiresAt,
    }
  }

  get terminal() {
    return TERMINAL.has(this.status)
  }

  refresh(): Effect.Effect<Job<Response>, AIError> {
    return this.route.status(this.token).pipe(Effect.map((snapshot) => new Job(this.route, this.token, snapshot)))
  }

  /** Poll until the job reaches a terminal status, then fetch the result. Fails with a `Timeout` reason on deadline. */
  await(options?: { readonly poll?: Poll }): Effect.Effect<Response, AIError> {
    const timeout = Duration.fromInputUnsafe(options?.poll?.timeout ?? DEFAULT_POLL_TIMEOUT)
    const settled = this.terminal ? Effect.succeed(this) : this.poll(options?.poll)
    return settled.pipe(
      // Non-completed terminal states also go through `result` so the route can surface its provider failure body.
      Effect.flatMap((job) => job.route.result(job.token)),
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () =>
          new AIError({
            reason: new TimeoutError({
              message: `Job ${this.id} did not finish within ${Duration.format(timeout)}`,
              timeoutMs: Duration.toMillis(timeout),
            }),
          }),
      }),
    )
  }

  cancel(): Effect.Effect<void, AIError> {
    return this.route.cancel?.(this.token) ?? Effect.void
  }

  /** Status observations as a stream, ending after the first terminal observation. */
  events(options?: { readonly poll?: Poll }): Stream.Stream<Event, AIError> {
    const observations = this.terminal
      ? Stream.make(this)
      : Stream.fromEffectSchedule(this.refresh(), this.schedule(options?.poll)).pipe(
          Stream.takeUntil((job) => job.terminal),
        )
    return observations.pipe(
      Stream.map((job): Event => {
        if (job.terminal) return { type: "job-finished", id: job.id, status: job.status }
        if (job.status === "queued") return { type: "job-queued", id: job.id, position: job.position }
        return { type: "job-progress", id: job.id, progress: job.progress }
      }),
    )
  }

  private poll(poll: Poll | undefined) {
    return this.refresh().pipe(Effect.repeat({ schedule: this.schedule(poll), until: (job) => job.terminal }))
  }

  private schedule(poll: Poll | undefined): Schedule.Schedule<unknown, Job<Response>> {
    if (poll?.schedule) return poll.schedule.pipe(Schedule.setInputType<Job<Response>>())
    const interval = poll?.interval ?? DEFAULT_POLL_INTERVAL
    const pollHint = this.route.pollHint
    const spaced = Schedule.spaced(interval).pipe(Schedule.setInputType<Job<Response>>())
    if (!pollHint) return spaced
    return spaced.pipe(
      Schedule.modifyDelay((metadata) => Effect.succeed(pollHint(metadata.input.snapshot) ?? interval)),
    )
  }
}
