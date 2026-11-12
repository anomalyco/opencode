import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth login --answer` for a field of a type this client does not know, answered with JSON that is not a
// selection: rejected before any write.
export default defineCli({
  args: ["auth", "login", "future", "--answer", 'region="west"'],
  env: sink,
  server: {
    routes: [
      ...integrationRoutes([
        {
          id: "future",
          name: "Future",
          methods: [{ id: "oauth", type: "oauth", label: "OAuth", form: [{ key: "region", type: "future-choice" }] }],
          connections: [],
        },
      ]),
    ],
  },
})
