import { describe, expect, test } from "bun:test"
import { initialState, transition, type Event, type State } from "./background-notice-machine"

const replay = (events: readonly Event[], from: State) =>
  events.reduce(
    (result, event) => {
      const next = transition(result.state, event)

      return { state: next.state, holdsQuit: next.holdsQuit, commands: [...result.commands, ...next.commands] }
    },
    { state: from, holdsQuit: false, commands: [] as unknown[] },
  )

describe("background service notice", () => {
  test.each([
    {
      name: "the first quit holds for the notice, and Quit quits",
      events: [
        { type: "quit.requested", keepRunning: true },
        { type: "dialog.closed", choice: "quit", stopService: false },
      ],
      commands: [{ type: "show" }, { type: "persist-shown" }, { type: "quit" }],
    },
    {
      name: "the checkbox turns the service off before quitting",
      events: [
        { type: "quit.requested", keepRunning: true },
        { type: "dialog.closed", choice: "quit", stopService: true },
      ],
      commands: [{ type: "show" }, { type: "persist-shown" }, { type: "stop-service-on-quit" }, { type: "quit" }],
    },
    {
      name: "Open Settings opens them instead of quitting",
      events: [
        { type: "quit.requested", keepRunning: true },
        { type: "dialog.closed", choice: "settings", stopService: false },
      ],
      commands: [{ type: "show" }, { type: "persist-shown" }, { type: "open-settings" }],
    },
    {
      name: "a second quit while the notice is open shows it only once",
      events: [
        { type: "quit.requested", keepRunning: true },
        { type: "quit.requested", keepRunning: true },
      ],
      commands: [{ type: "show" }],
    },
  ] satisfies { name: string; events: Event[]; commands: unknown[] }[])("$name", (row) => {
    expect(replay(row.events, initialState(false)).commands).toEqual(row.commands)
  })

  test("the quit that opens the notice waits, and so does one while it is open", () => {
    const opened = transition(initialState(false), { type: "quit.requested", keepRunning: true })
    expect(opened.holdsQuit).toBe(true)
    expect(transition(opened.state, { type: "quit.requested", keepRunning: true }).holdsQuit).toBe(true)
  })

  test.each([
    { name: "once it was shown", from: initialState(true), keepRunning: true, commands: [] },
    {
      name: "when the service already stops on quit",
      from: initialState(false),
      keepRunning: false,
      commands: [{ type: "persist-shown" }],
    },
  ] satisfies { name: string; from: State; keepRunning: boolean; commands: unknown[] }[])(
    "a quit goes straight through $name",
    (row) => {
      const next = transition(row.from, { type: "quit.requested", keepRunning: row.keepRunning })

      expect(next.holdsQuit).toBe(false)
      expect(next.commands).toEqual(row.commands)
      expect(next.state.status).toBe("done")
    },
  )
})
