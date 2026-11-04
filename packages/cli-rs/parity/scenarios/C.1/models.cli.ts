// `models`: `provider/model` lines in `localeCompare` order (case and punctuation included), for the
// working directory. Fields the client does not read stay out of the fixture: it must not decode them.
import { defineCli } from "../../cli/run"

const location = { directory: "/work", project: { id: "proj_test", directory: "/work", canonical: "/work" } }

export default defineCli({
  args: ["models"],
  server: {
    routes: [
      {
        path: "/api/model",
        json: {
          location,
          data: [
            { providerID: "openai", id: "gpt-5" },
            { providerID: "OpenAI", id: "b" },
            { providerID: "openai-x", id: "a" },
            { providerID: "anthropic", id: "claude-sonnet-5-5" },
            { providerID: "anthropic", id: "claude-opus-5-5" },
            { providerID: "anthropic", id: "Claude_10" },
            { providerID: "anthropic", id: "claude.9" },
          ],
        },
      },
    ],
  },
})
