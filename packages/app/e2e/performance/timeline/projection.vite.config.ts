import { defineConfig, mergeConfig } from "vite"
import config from "../../../vite.config"

// Benchmark-only instrumentation. Normal production builds contain no probes.
export default mergeConfig(
  config,
  defineConfig({
    plugins: [
      {
        name: "timeline-projection-measurement",
        enforce: "pre",
        transform(source, id) {
          if (!id.replaceAll("\\", "/").endsWith("/session-ui/src/timeline/projection.ts")) return
          const start = "    type Turn = {"
          const end = "\n  export function constructMessageRows("
          if (!source.includes(start) || !source.includes(end)) throw new Error("Projection probe boundary changed")
          return source
            .replace(
              start,
              `
    const probe = globalThis.__timelineProjectionProbe
    const started = probe ? performance.now() : 0
    try {
${start}`,
            )
            .replace(
              end,
              `
    finally {
      if (probe) {
        probe.calls += 1
        probe.entries += messages.length
        probe.ms += performance.now() - started
      }
    }
  }
${end}`,
            )
        },
      },
    ],
  }),
)
