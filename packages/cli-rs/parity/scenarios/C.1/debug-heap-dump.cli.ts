// `debug heap-dump --directory snaps/../out/`: the relative directory resolves against the working
// directory, and a server that wrote elsewhere (one released before `directory`) gets the warning.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["debug", "heap-dump", "--directory", "snaps/../out/"],
  server: {
    routes: [
      {
        method: "POST",
        path: "/api/debug/heap-dump",
        json: {
          path: "/var/log/opencode/heap-1.heapsnapshot",
          pid: 42,
          memory: { rss: 1, heapTotal: 2, heapUsed: 3, external: 4, arrayBuffers: 5 },
        },
      },
    ],
  },
})
