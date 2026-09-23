import type { Poll } from "../../src/index.js"

/**
 * Video generations take minutes live, so record with a realistic interval. Replay consumes the recorded polls in
 * cassette order regardless of timing, so it runs them back-to-back instead of sleeping between each one.
 */
export const videoPoll: Poll = {
  interval: process.env.RECORD === "true" ? "10 seconds" : "10 millis",
  timeout: "15 minutes",
}
