// `--prompt hello --session ses_new` where the server has no `ses_new` (C01): the home prompt shows the text,
// submits it once the catalogs load, and the session it creates takes the ID `ses_new`.
import { defineApp, session } from "../../lib/app"
import { catalog, inbox } from "./catalog"

export default defineApp({
  args: { prompt: "hello", newSessionID: "ses_new" },
  routes: [
    ...catalog,
    { method: "POST", path: "/api/session", json: { data: session("ses_new", "") } },
    { path: "/api/session/ses_new", json: { data: session("ses_new", "") } },
    { path: "/api/session/ses_new/message", json: { data: [], cursor: {} } },
    { path: "/api/session/ses_new/inbox", json: { data: [] } },
    { method: "POST", path: "/api/session/ses_new/prompt", json: { data: inbox("ses_new") } },
  ],
  steps: [{ checkpoint: "sent", until: "Demo Model", deviation: ["C01-startup-prompt-cells"] }],
})
