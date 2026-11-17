// F16's data collections: `opencode-skills-tui@1.2.3`, unmodified from npm, lists the location's skills in the sidebar
// from `data.location.skill` and `data.location.agent`. The layer answered both with an empty list and a warning
// toast, so the section listed none; now they load through the plugin's `client`. TS loads the package from
// node_modules; the Rust client runs the same files on the JS host through the V2 compatibility layer.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_k"
const location = { directory: "/tmp/opencode/packages/tui" }
const skill = (name: string, description: string) => ({
  id: name,
  name,
  description,
  path: `/tmp/opencode/.opencode/skill/${name}/SKILL.md`,
  location: "project",
})

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/opencode-skills-tui"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Use the skills", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Use the skills", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Used.", 2000), user("msg_1", "Use them", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    {
      path: "/api/agent",
      json: {
        location,
        data: [
          {
            id: "build",
            name: "build",
            mode: "primary",
            hidden: false,
            permissions: [],
            request: { settings: {}, headers: {}, body: {} },
          },
        ],
      },
    },
    {
      path: "/api/skill",
      json: {
        location,
        data: [skill("release-notes", "Write the release notes"), skill("triage", "Triage the issue queue")],
      },
    },
  ],
  steps: [{ checkpoint: "skills", until: "triage" }],
})
