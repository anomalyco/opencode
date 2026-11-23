// `debug heap-dump` answered by a declared error (401): stderr has its message without the tag, as
// `errorMessage` prints it, and the exit is 1.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["debug", "heap-dump"],
  server: {
    routes: [
      {
        method: "POST",
        path: "/api/debug/heap-dump",
        status: 401,
        json: { _tag: "UnauthorizedError", message: "Authentication required" },
      },
    ],
  },
})
