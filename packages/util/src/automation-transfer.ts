import z from "zod"

export namespace AutomationTransfer {
  export const Item = z
    .object({
      name: z.string(),
      projects: z.array(z.string()).min(1),
      prompt: z.string(),
      schedule: z.string().nullable().optional(),
      enabled: z.boolean().optional(),
    })
    .passthrough()

  export const File = z.object({
    automations: z.array(Item),
  })

  export type Item = z.output<typeof Item>

  type Shape = {
    name: string
    projects: string[]
    prompt: string
    schedule: string | null
    enabled: boolean
  }

  export function serialize(items: Shape[]) {
    return {
      version: 1,
      automations: items,
    }
  }

  export function parse(input: unknown) {
    const payload = Array.isArray(input) ? { automations: input } : input
    const result = File.safeParse(payload)
    if (!result.success) return []

    return result.data.automations
      .map((item) => ({
        ...item,
        projects: [...new Set(item.projects.map((project) => project.trim()).filter(Boolean))],
      }))
      .filter((item) => item.projects.length > 0)
  }
}
