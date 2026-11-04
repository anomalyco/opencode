// `models` against a server with three models: one GET of `/api/model` for the working directory,
// sorted `provider/model` lines. Rust gets the command in C.1.
import { defineCli } from "../../cli/run"

const location = { directory: "/work", project: { id: "proj_test", directory: "/work", canonical: "/work" } }

export default defineCli({
  args: ["models"],
  tsOnly: true,
  server: {
    routes: [
      {
        path: "/api/model",
        json: {
          location,
          data: [
            { providerID: "openai", id: "gpt-5" },
            { providerID: "anthropic", id: "claude-sonnet-5-5" },
            { providerID: "anthropic", id: "claude-opus-5-5" },
          ],
        },
      },
    ],
  },
})
