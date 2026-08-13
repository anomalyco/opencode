import type * as OpenCodeServer from "./server.js"

/** Live control over the simulated model shared by every connected TUI. */
export interface Llm {
  readonly queue: OpenCodeServer.Server["llm"]["queue"]
  readonly send: OpenCodeServer.Server["llm"]["send"]
  readonly serve: OpenCodeServer.Server["llm"]["serve"]
  readonly title: OpenCodeServer.Server["llm"]["title"]
}
