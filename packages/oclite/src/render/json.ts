// JSON renderers (ARCHITECTURE §11, SPEC §9). stream-json: one JSON object per line on stdout and nothing else,
// written as each event arrives. Every event is redacted (render/event.ts `cleanEvent`) before it is kept or written. json: collects silently; the caller prints the single `result` object at the end.
import { Effect } from "effect"
import type { EventSink, RenderEvent } from "../contract"
import { cleanEvent } from "./event"

export function streamJsonSink(write: (line: string) => void = (line) => void process.stdout.write(line)): EventSink {
  return (event) => Effect.sync(() => write(JSON.stringify(cleanEvent(event)) + "\n"))
}

export function jsonCollector() {
  const state = { result: undefined as RenderEvent | undefined, errors: [] as string[], session_id: "" }
  const sink: EventSink = (raw) =>
    Effect.sync(() => {
      const event = cleanEvent(raw)
      if (event.session_id) state.session_id = event.session_id
      if (event.type === "error") state.errors.push(event.message)
      if (event.type === "result") state.result = event
    })
  return {
    sink,
    /** The run's result event, plus any error messages seen on the way (`errors`, only when there were some). */
    result: (): RenderEvent & { errors?: string[] } => ({
      ...(state.result ?? {
        type: "result",
        session_id: state.session_id,
        agent_path: [],
        state: "failed",
        text: "",
        turns: 0,
        usage: { input: 0, output: 0, estimated: true },
        exit_code: 1,
      }),
      ...(state.errors.length ? { errors: state.errors } : {}),
    }),
  }
}
