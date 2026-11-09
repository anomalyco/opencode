// Messages and tool blocks keep two columns free on the right (#62104): a user message long enough to wrap, a
// write whose path is cut to fit, an apply_patch with a deleted file whose path is cut, and the revert banner
// with a long file path, at a narrow width.
import { defineApp, session, user } from "../../lib/app"

const directory = "/tmp/opencode/packages/tui"
const long = "src/components/navigation/sidebar/sections/project-tree/expanded-folder-row.tsx"

const tool = (id: string, name: string, state: Record<string, unknown>) => ({
  type: "tool",
  id,
  name,
  state,
  time: { created: 1600, completed: 1700 },
})

export default defineApp({
  width: 60,
  height: 50,
  args: { sessionID: "ses_pad" },
  config: { session: { grouping: "none" } },
  routes: [
    {
      path: "/api/session/ses_pad",
      json: {
        data: {
          ...session("ses_pad", "Pad the blocks", { updated: 2, directory }),
          revert: {
            messageID: "msg_3",
            files: [{ file: long, patch: "", additions: 12, deletions: 3, status: "modified" }],
          },
        },
      },
    },
    {
      path: "/api/session/ses_pad/message",
      json: {
        data: [
          user("msg_3", "Undo this one", 3000),
          {
            id: "msg_2",
            type: "assistant",
            agent: "build",
            model: { providerID: "provider", id: "model" },
            content: [
              tool("call_1", "write", {
                status: "completed",
                input: { filePath: `${directory}/${long}`, content: "export {}\n" },
                content: [{ type: "text", text: "Wrote" }],
                metadata: {},
              }),
              tool("call_2", "apply_patch", {
                status: "completed",
                input: { patchText: "*** Begin Patch" },
                content: [{ type: "text", text: "Applied" }],
                metadata: {
                  files: [
                    {
                      file: long,
                      filePath: `${directory}/${long}`,
                      type: "delete",
                      patch: "",
                      additions: 0,
                      deletions: 12,
                    },
                  ],
                },
              }),
            ],
            time: { created: 2000, completed: 2500 },
          },
          user(
            "msg_1",
            "Rename every expanded folder row in the project tree so that the sidebar and the file picker share one component",
            1000,
          ),
        ],
        cursor: {},
      },
    },
    { path: "/api/session/ses_pad/inbox", json: { data: [] } },
  ],
  steps: [{ checkpoint: "open", until: "message reverted" }],
})
