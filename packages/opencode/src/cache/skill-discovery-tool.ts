import z from "zod"
import { Tool } from "@/tool/tool"
import { Cache } from "./cache"
import { Discover } from "./discover"

export const SkillDiscoveryTool = Tool.define("cache_discover_skill", async () => {
  const parameters = z.object({
    query: z.string().describe("Natural language description of the skill you need"),
    top_k: z.number().int().positive().max(20).optional().describe("Maximum number of results to return"),
  })

  return {
    description: "Search cached L2 skills and return names to pass to the skill tool.",
    parameters,
    async execute(params) {
      if (!(await Cache.isEnabled())) {
        return {
          title: "",
          output: "Skill discovery cache is not enabled.",
          metadata: {},
        }
      }

      const rows = await Cache.l2SkillRows()
      const skills = await Discover.skills(params.query, params.top_k ?? 5, rows)
      const output = [
        "Available cached skills:",
        ...skills.map((item) => `- ${item.name}: ${item.description}`),
        'Use the skill tool next with skill({ name: "<skill-name>" }).',
      ].join("\n")

      return {
        title: "",
        output,
        metadata: {},
      }
    },
  }
})
