// CT-8, CT-19: with no plugin, the host's own keys as before the change that routes a JS plugin's declined key on: the
// composer types `r` and a space, and Enter sends the prompt.
import { defineApp } from "../../lib/app"
import { keysApp } from "./keys"

export default defineApp(keysApp)
