import { Option, Schema } from "effect"

/** The trace config that makes Chromium dump every process's memory, broken down by allocator. */
export const traceConfig = {
  included_categories: ["disabled-by-default-memory-infra"],
  excluded_categories: ["*"],
  memory_dump_config: { triggers: [{ mode: "detailed", periodic_interval_ms: 1000 }] },
}

/** One Chromium process in the summary. Sizes are MiB. */
export type ProcessMemory = {
  readonly pid: number
  /** Chromium's name for the process, e.g. `Browser`, `Renderer`, `GPU Process`. */
  readonly name?: string
  /** What the process shows, as Chromium labels it. */
  readonly labels?: string
  /** What the OS charges the process: Chromium's private footprint and resident set. */
  readonly totals: { readonly privateFootprint?: number; readonly resident?: number }
  /**
   * Each allocator's effective size (shared memory counted once, with its owner), largest first: `malloc`, `partition_alloc`, `blink_gc`, `v8`, `skia`, `cc`, `gpu`,
   * `discardable`, `web_cache`, `font_caches`… Some overlap: `cc`, `skia`, `gpu` and `web_cache` report memory that
   * `malloc`, `discardable` or `shared_memory` also count.
   */
  readonly allocators: Readonly<Record<string, number>>
  /** Every sub-allocator of at least 1 MiB, up to three levels deep, e.g. `partition_alloc/partitions/layout`. */
  readonly detail: Readonly<Record<string, number>>
}

const Size = Schema.Struct({ value: Schema.String })

const Event = Schema.Struct({
  pid: Schema.Number,
  ph: Schema.String,
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  args: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      labels: Schema.optional(Schema.String),
      dumps: Schema.optional(
        Schema.Struct({
          process_totals: Schema.optional(
            Schema.Struct({
              private_footprint_bytes: Schema.optional(Schema.String),
              resident_set_bytes: Schema.optional(Schema.String),
            }),
          ),
          allocators: Schema.optional(
            Schema.Record(
              Schema.String,
              Schema.Struct({
                // Shared `global/…` entries carry only a guid.
                attrs: Schema.optional(
                  Schema.Struct({ size: Schema.optional(Size), effective_size: Schema.optional(Size) }),
                ),
              }),
            ),
          ),
        }),
      ),
    }),
  ),
})

// Electron writes `{ traceEvents: [...] }`; events of other shapes are skipped one by one.
const decodeTrace = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ traceEvents: Schema.Array(Schema.Unknown) })),
)

const decodeEvent = Schema.decodeUnknownOption(Event)

/**
 * Summarizes a memory-infra trace: for each process, the last detailed dump's totals and allocator sizes.
 *
 * @param json - The trace file's text, as `contentTracing.stopRecording` wrote it.
 * @returns One entry per process that dumped, largest private footprint first.
 */
export function summarize(json: string): ProcessMemory[] {
  const events = decodeTrace(json).traceEvents.flatMap((value) => Option.toArray(decodeEvent(value)))

  const names = new Map(
    events.flatMap((event) =>
      event.ph === "M" && event.name === "process_name" ? [[event.pid, event.args?.name]] : [],
    ),
  )

  const labels = new Map(
    events.flatMap((event) =>
      event.ph === "M" && event.name === "process_labels" ? [[event.pid, event.args?.labels]] : [],
    ),
  )

  // Each periodic dump shares an id across processes, and a process reports its totals and its allocators in separate
  // events (the browser in two). Stopping the recording can cut into the last dump, so use the latest one every
  // process reported both for, else the latest with any allocators.
  const dumps = events.flatMap((event) =>
    event.ph === "v" && event.args?.dumps ? [{ ...event, dumps: event.args.dumps }] : [],
  )

  const pids = [...new Set(dumps.map((event) => event.pid))]

  const complete = [...new Set(dumps.map((event) => event.id))].findLast((id) =>
    pids.every((pid) => {
      const own = dumps.filter((event) => event.id === id && event.pid === pid)

      return own.some((event) => event.dumps.allocators) && own.some((event) => event.dumps.process_totals)
    }),
  )

  const latest = complete ?? dumps.findLast((event) => event.dumps.allocators)?.id
  const current = dumps.filter((event) => event.id === latest)

  return [...new Set(current.map((event) => event.pid))]
    .map((pid): ProcessMemory => {
      const own = current.filter((event) => event.pid === pid)

      // Effective size counts memory shared between allocators once, with its owner.
      const sizes = own.flatMap((event) =>
        Object.entries(event.dumps.allocators ?? {}).flatMap(([key, value]) => {
          const size = value.attrs?.effective_size ?? value.attrs?.size

          return size ? [[key, mib(parseInt(size.value, 16))] as const] : []
        }),
      )

      const totals = own.find((event) => event.dumps.process_totals)?.dumps.process_totals

      return {
        pid,
        name: names.get(pid),
        labels: labels.get(pid),
        totals: {
          privateFootprint: hexMib(totals?.private_footprint_bytes),
          resident: hexMib(totals?.resident_set_bytes),
        },
        allocators: Object.fromEntries(
          sizes.filter(([key, size]) => !key.includes("/") && size > 0).sort((a, b) => b[1] - a[1]),
        ),
        detail: Object.fromEntries(
          sizes
            // `global/<guid>` and `shared_memory/<guid>` name buffers by id, which says nothing on its own.
            .filter(
              ([key, size]) =>
                key.includes("/") && key.split("/").length <= 3 && size >= 1 && !/^(global|shared_memory)\//.test(key),
            )
            .sort((a, b) => b[1] - a[1]),
        ),
      }
    })
    .sort((a, b) => (b.totals.privateFootprint ?? 0) - (a.totals.privateFootprint ?? 0))
}

function hexMib(value: string | undefined) {
  return value === undefined ? undefined : mib(parseInt(value, 16))
}

function mib(bytes: number) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10
}
