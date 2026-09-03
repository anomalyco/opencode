import { fixture } from "./session-timeline-stress.fixture"

// A realistic large per-directory catalog: the provider-memory benchmark's 1,200-model
// catalog plus agents with system prompts, slash commands, and skills with SKILL.md content.
// Every directory serves the same payload, so distinct directories hold byte-identical catalogs.
export function createLocationCatalog(models: number) {
  const provider = fixture.provider.all[0]
  const selected = provider.models["claude-opus-4-6"]
  return {
    provider: {
      ...fixture.provider,
      all: [
        {
          ...provider,
          models: {
            [selected.id]: selected,
            ...Object.fromEntries(
              Array.from({ length: models - 1 }, (_, index) => {
                const id = `catalog-model-${index}`
                return [
                  id,
                  {
                    id,
                    name: `Catalog model ${index}`,
                    cost: { input: 1, output: 2 },
                    limit: { context: 200_000, output: 8192 },
                    variants: { high: { reasoningEffort: "high" } },
                  },
                ]
              }),
            ),
          },
        },
      ],
    },
    agents: ["build", "plan", "explore", "review", "docs", "test", "refactor", "general"].map((id, index) => ({
      id,
      name: id[0]!.toUpperCase() + id.slice(1),
      description: `${id} agent for ${prose(index, 120)}`,
      mode: index < 2 ? "primary" : "subagent",
      hidden: false,
      color: "blue",
      steps: 50,
      system: prose(index * 7, 2_500),
      request: { settings: { temperature: 0.2 }, headers: {}, body: {} },
      permissions: [
        { action: "edit", resource: "*", effect: "allow" },
        { action: "bash", resource: "git *", effect: "ask" },
        { action: "webfetch", resource: "*", effect: index % 2 === 0 ? "allow" : "deny" },
      ],
    })),
    commands: Array.from({ length: 24 }, (_, index) => ({
      name: `command-${index}`,
      description: prose(index * 3, 90),
    })),
    skills: Array.from({ length: 12 }, (_, index) => ({
      id: `skill-${index}`,
      name: `skill-${index}`,
      description: prose(index * 5, 140),
      slash: true,
      autoinvoke: false,
      location: `.opencode/skills/skill-${index}/SKILL.md`,
      content: `# Skill ${index}\n\n${prose(index * 11, 3_000)}`,
    })),
  }
}

const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"]

function prose(seed: number, length: number) {
  let out = ""
  let index = seed
  while (out.length < length) {
    out += (out ? " " : "") + words[index % words.length]
    if (index % 13 === 0) out += ".\n\n"
    index += 3
  }
  return out.slice(0, length)
}
