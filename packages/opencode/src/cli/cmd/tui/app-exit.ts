import type { Route } from "./context/route"

export function shouldExit(route: Route["type"]) {
  return route === "plugin"
}
