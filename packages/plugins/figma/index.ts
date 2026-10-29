import { Plugin, Skill } from "@opencode/plugin"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import matter from "gray-matter"
import source from "./skills-source.json" with { type: "json" }

export default Plugin.define({
  id: "opencode.figma",
  async setup(ctx) {
    await ctx.mcp.transform((editor) => {
      if (editor.get("figma")) return
      editor.set("figma", {
        type: "remote",
        url: "https://mcp.figma.com/mcp",
      })
    })

    const directory = new URL("./skills/", import.meta.url)
    const skills = await Promise.all(
      source.skills.map(async (name) => {
        const file = new URL(`${name}/SKILL.md`, directory)
        const markdown = matter(await readFile(file, "utf8"))
        return Skill.Info.make({
          id: Skill.ID.make(name),
          name: Skill.Name.make(markdown.data.name),
          description: markdown.data.description,
          autoinvoke: markdown.data["disable-model-invocation"] !== true,
          path: Skill.Info.fields.path.make(fileURLToPath(file)),
          content: markdown.content,
        })
      }),
    )
    await ctx.skill.transform((editor) => {
      skills.forEach((skill) => {
        if (!editor.get(skill.id)) editor.add(skill)
      })
    })
  },
})
