import { architect } from "./architect"
import { debuggerAgent } from "./debugger"
import { e2e } from "./e2e"
import { explorer } from "./explorer"
import { frontend } from "./frontend"
import { hades } from "./hades"
import { implementer } from "./implementer"
import { librarian } from "./librarian"
import { lead } from "./lead"
import { quickHigh } from "./quick-high"
import { quick } from "./quick"
import { reviewer } from "./reviewer"

export const sub = {
  architect,
  debugger: debuggerAgent,
  e2e,
  explorer,
  frontend,
  hades,
  implementer,
  librarian,
  lead,
  quick,
  "quick-high": quickHigh,
  reviewer,
}
