import { describe, expect, test } from "bun:test"
import {
  DISPOSED_STEER_ARRIVAL_EVENT,
  DISPOSED_STEER_ARRIVAL_STATE,
  INITIAL_STEER_ARRIVAL_STATE,
  shouldGrowUserMessage,
  shouldSnapUserRun,
  transitionSteerArrival,
  type SteerArrivalState,
} from "./steer-arrival-machine"
import { TimelineRow } from "./timeline-row"

const user = (id: string) => new TimelineRow.UserMessage({ userMessageID: id })

const assistant = (userMessageID: string, messageID: string) =>
  new TimelineRow.AssistantPart({
    userMessageID,
    group: { key: `${messageID}:text`, type: "part", ref: { messageID, partID: "text" } },
    previousAssistantPart: false,
  })

const sync = (state: SteerArrivalState, rows: TimelineRow.TimelineRow[], busy = true, sessionID = "ses_1", at = 0) =>
  transitionSteerArrival(state, { type: "sync", sessionID, rows, busy, at })

const rendered = (state: SteerArrivalState, messageID: string) =>
  transitionSteerArrival(state, { type: "rendered", messageID })

const page = [user("m50"), assistant("m50", "a50")]

describe("transitionSteerArrival", () => {
  test("does not grow history loaded above the first page", () => {
    const loaded = sync(INITIAL_STEER_ARRIVAL_STATE, page)
    const paged = sync(loaded, [user("m10"), assistant("m10", "a10"), ...page])

    // Before the machine, every prepended user message counted as a steer once the first page loaded.
    expect(shouldGrowUserMessage(paged, "m10")).toBe(false)
    expect(shouldGrowUserMessage(sync(paged, [...page, user("m51")]), "m51")).toBe(true)
  })

  test("does not grow the user message of a truncated first turn when its history loads", () => {
    const loaded = sync(INITIAL_STEER_ARRIVAL_STATE, [assistant("m50", "a50")])
    const paged = sync(loaded, page)

    expect(shouldGrowUserMessage(paged, "m50")).toBe(false)
    expect(shouldGrowUserMessage(sync(paged, [...page, user("m51")]), "m51")).toBe(true)
  })

  test("keeps a steer through row updates until its row renders", () => {
    const steered = sync(sync(INITIAL_STEER_ARRIVAL_STATE, page), [...page, user("m51")])
    const updated = [1, 2, 3].reduce((state) => sync(state, [...page, user("m51"), assistant("m51", "a51")]), steered)

    // Before the machine, the next row update recomputed the arrivals and dropped the unrendered steer.
    expect(shouldGrowUserMessage(updated, "m51")).toBe(true)

    const shown = rendered(updated, "m51")

    expect(shouldGrowUserMessage(shown, "m51")).toBe(false)
    expect(rendered(shown, "m51")).toBe(shown)
  })

  test("never grows a prompt sent while idle or a steer left unrendered when the session went idle", () => {
    const loaded = sync(INITIAL_STEER_ARRIVAL_STATE, page)
    const prompted = sync(loaded, [...page, user("m51")], false)

    expect(shouldGrowUserMessage(sync(prompted, [...page, user("m51")], true), "m51")).toBe(false)

    const steered = sync(loaded, [...page, user("m51")])
    const idle = sync(steered, [...page, user("m51")], false)

    // Before the machine, an offscreen prompt still grew in when the user scrolled to it during a later turn.
    expect(shouldGrowUserMessage(sync(idle, [...page, user("m51")], true), "m51")).toBe(false)
  })

  test("does not grow the opener after a leading notice", () => {
    const notice = new TimelineRow.Notice({ userMessageID: "", messageID: "n1" })
    const empty = sync(INITIAL_STEER_ARRIVAL_STATE, [notice])

    expect(shouldGrowUserMessage(sync(empty, [notice, user("m1")]), "m1")).toBe(false)
  })

  test("returns the same state for row updates that add nothing", () => {
    const loaded = sync(INITIAL_STEER_ARRIVAL_STATE, page)
    const steered = sync(loaded, [...page, user("m51")])

    expect(sync(loaded, [...page])).toBe(loaded)
    expect(sync(loaded, [...page], false)).toBe(loaded)
    expect(sync(steered, [...page, user("m51")])).toBe(steered)
  })

  test("snaps a run only right after a steer lands, not when one is delivered into the run above", () => {
    const loaded = sync(INITIAL_STEER_ARRIVAL_STATE, page, true, "ses_1", 1000)
    const steered = sync(loaded, [...page, user("m51")], true, "ses_1", 2000)

    expect(shouldSnapUserRun(loaded, 1000)).toBe(false)
    expect(shouldSnapUserRun(steered, 2050)).toBe(true)
    expect(shouldSnapUserRun(steered, 2100)).toBe(false)

    // A delivery or reply changes the rows without a new steer, so the run springs.
    const replied = sync(steered, [...page, user("m51"), assistant("m51", "a51")], true, "ses_1", 3000)

    expect(shouldSnapUserRun(replied, 3000)).toBe(false)
    expect(shouldSnapUserRun(DISPOSED_STEER_ARRIVAL_STATE, 2000)).toBe(false)
  })

  test("starts over on another session and stops after disposal", () => {
    const steered = sync(sync(INITIAL_STEER_ARRIVAL_STATE, page), [...page, user("m51")])
    const other = sync(steered, [user("m1"), user("m51")], true, "ses_2")

    expect(shouldGrowUserMessage(other, "m51")).toBe(false)
    expect(shouldGrowUserMessage(other, "m1")).toBe(false)

    const disposed = transitionSteerArrival(steered, DISPOSED_STEER_ARRIVAL_EVENT)

    expect(disposed).toBe(DISPOSED_STEER_ARRIVAL_STATE)
    expect(sync(disposed, [...page, user("m52")])).toBe(disposed)
    expect(shouldGrowUserMessage(disposed, "m51")).toBe(false)
  })
})
