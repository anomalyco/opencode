import { Clock, Duration, Effect, Schedule, Schema, Stream } from "effect"
import { AIError, TimeoutError } from "./schema/errors.js"

export const Status = Schema.Literals(["queued", "running", "completed", "failed", "cancelled", "expired"])
export type Status = Schema.Schema.Type<typeof Status>

/** Provider-neutral view of one generation observation. */
export interface Snapshot {
  readonly id: string
  readonly status: Status
  /** Normalized 0..1 when the provider reports progress. */
  readonly progress?: number
  readonly position?: number
}

/**
 * Route-owned generation operations for one generation. The media route decodes its serializable token once (from the
 * submission response or a `resume` input) and closes over it, so `Generation` never sees the token's shape.
 */
export interface Route<Response> {
  readonly status: Effect.Effect<Snapshot, AIError>
  readonly result: Effect.Effect<Response, AIError>
  readonly cancel?: Effect.Effect<void, AIError>
}

export interface Poll {
  readonly interval?: Duration.Input
  readonly timeout?: Duration.Input
}

export interface AwaitOptions {
  readonly poll?: Poll
}

export const DEFAULT_POLL_INTERVAL = Duration.seconds(5)
export const DEFAULT_POLL_TIMEOUT = Duration.minutes(10)

export const QueuedEvent = Schema.Struct({
  type: Schema.tag("generation-queued"),
  id: Schema.String,
  position: Schema.optional(Schema.Number),
}).annotate({ identifier: "Generation.Event.Queued" })

export const ProgressEvent = Schema.Struct({
  type: Schema.tag("generation-progress"),
  id: Schema.String,
  progress: Schema.optional(Schema.Number),
}).annotate({ identifier: "Generation.Event.Progress" })

export type Observation = Schema.Schema.Type<typeof QueuedEvent> | Schema.Schema.Type<typeof ProgressEvent>

export type Event = Observation | { readonly type: "generation-finished"; readonly id: string; readonly status: Status }

const TERMINAL: ReadonlySet<Status> = new Set(["completed", "failed", "cancelled", "expired"])

export class Generation<Response> {
  readonly id: string
  readonly status: Status
  readonly progress?: number
  readonly position?: number

  constructor(
    readonly route: Route<Response>,
    /** Route-owned serializable JSON; pass it to the modality's `resume` from another process. */
    readonly token: unknown,
    snapshot: Snapshot,
  ) {
    this.id = snapshot.id
    this.status = snapshot.status
    this.progress = snapshot.progress
    this.position = snapshot.position
  }

  get snapshot(): Snapshot {
    return {
      id: this.id,
      status: this.status,
      progress: this.progress,
      position: this.position,
    }
  }

  get terminal() {
    return TERMINAL.has(this.status)
  }

  refresh(): Effect.Effect<Generation<Response>, AIError> {
    return this.route.status.pipe(Effect.map((snapshot) => new Generation(this.route, this.token, snapshot)))
  }

  /** Fetch the result without polling; non-completed terminal generations fail with the provider's terminal body. */
  result(): Effect.Effect<Response, AIError> {
    return this.route.result
  }

  /** Poll until the generation reaches a terminal status, then fetch the result. Fails with a `Timeout` reason on deadline. */
  await(options?: AwaitOptions): Effect.Effect<Response, AIError> {
    const timeout = Duration.fromInputUnsafe(options?.poll?.timeout ?? DEFAULT_POLL_TIMEOUT)
    const settled = this.terminal ? Effect.succeed(this) : this.poll(options?.poll)
    return settled.pipe(
      // Non-completed terminal states also go through `result` so the route can surface its provider failure body.
      Effect.flatMap((generation) => generation.result()),
      Effect.timeoutOrElse({ duration: timeout, orElse: () => this.timeoutError(timeout) }),
    )
  }

  cancel(): Effect.Effect<void, AIError> {
    return this.route.cancel ?? Effect.void
  }

  /**
   * Status observations as a stream, ending after the first terminal observation. Each poll and each sleep between polls
   * is bounded by the time remaining until `poll.timeout`, so a hung status request or a long interval fails the stream at
   * the deadline instead of stalling it. (`Stream.interruptWhen` would express this directly but deadlocks under
   * `TestClock` when the source completes while the timer sleeps.)
   */
  events(options?: AwaitOptions): Stream.Stream<Event, AIError> {
    if (this.terminal) return Stream.make(this.event())
    const timeout = Duration.fromInputUnsafe(options?.poll?.timeout ?? DEFAULT_POLL_TIMEOUT)
    return Stream.unwrap(
      Clock.currentTimeMillis.pipe(
        Effect.map((start) => {
          const deadline = start + Duration.toMillis(timeout)
          // Fail before polling once the deadline has passed: a fast status request could otherwise win the zero-budget
          // race and schedule another zero-delay poll.
          const refresh = Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) =>
              now >= deadline
                ? this.timeoutError(timeout)
                : this.refresh().pipe(
                    Effect.timeoutOrElse({
                      duration: Duration.millis(deadline - now),
                      orElse: () => this.timeoutError(timeout),
                    }),
                  ),
            ),
          )
          const schedule = this.schedule(options?.poll).pipe(
            Schedule.modifyDelay((meta) =>
              Effect.succeed(Duration.min(meta.duration, Duration.millis(Math.max(0, deadline - meta.now)))),
            ),
          )
          return Stream.fromEffectSchedule(refresh, schedule).pipe(
            Stream.takeUntil((generation) => generation.terminal),
            Stream.map((generation) => generation.event()),
          )
        }),
      ),
    )
  }

  private event(): Event {
    if (this.terminal) return { type: "generation-finished", id: this.id, status: this.status }
    if (this.status === "queued") return { type: "generation-queued", id: this.id, position: this.position }
    return { type: "generation-progress", id: this.id, progress: this.progress }
  }

  private timeoutError(timeout: Duration.Duration) {
    return new AIError({
      reason: new TimeoutError({
        message: `Generation ${this.id} did not finish within ${Duration.format(timeout)}`,
        timeoutMs: Duration.toMillis(timeout),
      }),
    })
  }

  private poll(poll: Poll | undefined) {
    return this.refresh().pipe(
      Effect.repeat({ schedule: this.schedule(poll), until: (generation) => generation.terminal }),
    )
  }

  private schedule(poll: Poll | undefined) {
    return Schedule.spaced(poll?.interval ?? DEFAULT_POLL_INTERVAL)
  }
}

export const resultEvents = <Response, A>(
  generation: Generation<Response>,
  expand: (response: Response) => ReadonlyArray<A>,
  options?: AwaitOptions,
): Stream.Stream<Observation | A, AIError> =>
  generation.events(options).pipe(
    Stream.filter((event): event is Observation => event.type !== "generation-finished"),
    Stream.concat(Stream.fromIterableEffect(Effect.map(generation.result(), expand))),
  )
