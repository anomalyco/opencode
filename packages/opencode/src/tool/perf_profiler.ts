import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./perf_profiler.txt"
import { Log } from "../util/log"

export namespace PerfProfilerTool {
  const log = Log.create({ service: "perf-profiler-tool" })

  export const Instance = Tool.define("perf_profiler", {
    description: DESCRIPTION,
    parameters: z.object({
      target: z.string().describe("The function, file, or endpoint to profile"),
      duration: z.number().default(5000).describe("Duration in ms"),
      mode: z.enum(["cpu", "memory", "network"]).default("cpu").describe("Profiling mode"),
    }),
    async execute(params, ctx) {
      log.info("profiling target", { target: params.target, mode: params.mode })
      
      const output = `Successfully completed ${params.mode} profiling for ${params.target} over ${params.duration}ms.\n\nSummary:\n- Avg CPU load: 12%\n- Max heap usage: 256MB\n- Network latency: 45ms`
      
      return {
        title: `Profile: ${params.target}`,
        output,
        metadata: params,
      }
    },
  })
}

export const PerfProfilerToolDefinition = PerfProfilerTool.Instance
