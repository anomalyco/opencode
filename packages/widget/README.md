# @opencode/widget

The shared widget runtime: the canonical prelude, the view node set, the step ABI and the built-in templates
(`suggestions`, `form`, `confirm`). The contract is `specs/v2/widgets.md`; this README is the short version for client
authors in other languages (Rune desktop, Rust). The TypeScript runtime targets Bun.

A template's `version` is the first 16 hex chars of `sha256(program + "\n" + JSON.stringify(dataSchema))`, where
`program = prelude + "\n" + source`, so a prelude change yields new versions.

## TypeScript

```ts
import { WidgetSession, program, validateData, builtins } from "@opencode/widget"

const session = await WidgetSession.start(program(template.source), data) // or the server's `program` field
render(session.view)
const output = await session.dispatch({ id: "choose", type: "press" })
if ("submit" in output) respond({ value: output.submit })
if (output.dismiss) respond({ dismiss: true })
```

`step(program, input)` runs one step without a session. Failures reject with `StepError` (`kind`: `error`, `timeout`
or `invalid`); keep the previous state and view and show the message inline.

## ABI for other clients

1. Fetch `GET /widget/template/{name}/{version}` once and cache it forever by `name@version`. Its `program` field is
   the full program (prelude + template); you never need a prelude of your own.
2. Compile, once per program, this PsychoScript source:

   ```js
   <program>
   return __widget_step(__input())
   ```

   with exactly one global, a synchronous host function `__input()` that returns the step input. No other globals.
   Use a timeout of at most 250 ms per step.

3. Run it for each step with a different input:

   ```ts
   type StepInput =
     | { phase: "init"; data: unknown }
     | {
         phase: "event"
         data: unknown
         state: unknown
         event: { id: string; type: "press" | "change"; value?: unknown }
       }
   ```

   The run returns `{ state, view, submit?, dismiss? }`. Keep `state` and pass it back with the next event; render
   `view`. `submit` present (it may be `null`): send `{ value: submit }` to
   `POST /session/{sessionID}/widget/{messageID}/respond`. `dismiss: true`: send `{ dismiss: true }`.

4. Validate `view` against the node set in the spec. Drop nodes of unknown `type` from `children` (render nothing, log
   a warning) and ignore unknown props. A failed step (throw, timeout, invalid view) keeps the previous state and view
   and shows the error inline; a failed `init` shows an error card.

Event `id`s come from the nodes: `button` and `card` (with `id`) send `press`; `checkbox` (`boolean`), `slider`
(`number`, on release), `select` (`string`, or `string[]` when `multiple`), `input` (`string`, on commit or after
300 ms) and `carousel` (with `id`, new page index) send `change`.

## Development

The `.js` files in `src/` (`prelude.js`, `templates/*.js`) are canonical. After editing them run `bun run generate`,
which embeds them in `src/source.ts`; a test fails when the two differ.
