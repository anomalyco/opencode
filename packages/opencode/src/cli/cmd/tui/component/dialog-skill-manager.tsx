import { createMemo, createSignal, onMount, For } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { useToast } from "@tui/ui/toast"
import { TextAttributes } from "@opentui/core"

interface Skill {
  name: string
  description: string
  path: string
  source: "project" | "user" | "plugin"
  activated: boolean
  allowedTools?: string[]
  keywords?: string[]
}

export function DialogSkillManager() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const toast = useToast()

  // TODO: This will be replaced with actual skill system integration
  const [skills, setSkills] = createSignal<Skill[]>([
    {
      name: "react-components",
      description: "Create React components with TypeScript and best practices",
      path: ".claude/skills/react-components",
      source: "project",
      activated: false,
      keywords: ["react", "component", "typescript"],
    },
    {
      name: "api-testing",
      description: "Generate API tests with proper error handling",
      path: ".claude/skills/api-testing",
      source: "project",
      activated: false,
      keywords: ["api", "test", "testing"],
    },
  ])

  const [selectedSkill, setSelectedSkill] = createSignal<string>()

  onMount(() => {
    dialog.setSize("large")
    loadSkills()
  })

  async function loadSkills() {
    // TODO: Integrate with actual SkillSystem
    // const system = await getSkillSystem()
    // const discovered = await system.discoverSkills()
    // setSkills(discovered)

    toast.show({
      message: "Skill system integration pending",
      variant: "info",
    })
  }

  const options = createMemo(() => {
    return skills().map((skill) => {
      const sourceEmoji = {
        project: "📁",
        user: "👤",
        plugin: "🔌",
      }[skill.source]

      const statusEmoji = skill.activated ? "✅" : "⭕"

      return {
        value: skill.name,
        title: `${sourceEmoji} ${statusEmoji} ${skill.name}`,
        footer: skill.description,
        category: skill.activated ? "Active" : "Available",
      }
    })
  })

  async function toggleSkillActivation(skillName: string) {
    const skill = skills().find((s) => s.name === skillName)
    if (!skill) return

    // TODO: Integrate with actual SkillSystem
    // await system.activateSkill(skillName) or deactivateSkill(skillName)

    setSkills(skills().map((s) => (s.name === skillName ? { ...s, activated: !s.activated } : s)))

    toast.show({
      message: `${skillName} ${skill.activated ? "deactivated" : "activated"}`,
      variant: "success",
    })
  }

  async function showSkillDetails(skillName: string) {
    const skill = skills().find((s) => s.name === skillName)
    if (!skill) return

    const details = `
${skill.name}

${skill.description}

Source: ${skill.source}
Path: ${skill.path}
Status: ${skill.activated ? "Active" : "Inactive"}
${skill.keywords ? `Keywords: ${skill.keywords.join(", ")}` : ""}
${skill.allowedTools ? `Allowed Tools: ${skill.allowedTools.join(", ")}` : ""}
    `.trim()

    toast.show({
      message: details,
      variant: "info",
    })
  }

  if (skills().length === 0) {
    return (
      <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD}>Skill Manager</text>
          <text fg={theme.textMuted}>esc</text>
        </box>
        <box gap={1}>
          <text>No skills found</text>
          <text fg={theme.textMuted}>Create skills in .claude/skills/ or ~/.claude/skills/</text>
          <box marginTop={1}>
            <text attributes={TextAttributes.BOLD}>Skill Structure:</text>
            <text fg={theme.textMuted}>skill-name/</text>
            <text fg={theme.textMuted}> ├── SKILL.md (required)</text>
            <text fg={theme.textMuted}> ├── reference.md (optional)</text>
            <text fg={theme.textMuted}> └── examples.md (optional)</text>
          </box>
        </box>
      </box>
    )
  }

  return (
    <DialogSelect
      title={`Skill Manager (${skills().length} skills)`}
      options={options()}
      limit={50}
      onSelect={(option) => {
        toggleSkillActivation(option.value)
      }}
      keybind={[
        {
          keybind: Keybind.parse("space")[0],
          title: "toggle",
          onTrigger: async (option) => {
            await toggleSkillActivation(option.value)
          },
        },
        {
          keybind: Keybind.parse("i")[0],
          title: "info",
          onTrigger: async (option) => {
            await showSkillDetails(option.value)
          },
        },
        {
          keybind: Keybind.parse("r")[0],
          title: "reload",
          onTrigger: async () => {
            await loadSkills()
            toast.show({
              message: "Skills reloaded",
              variant: "success",
            })
          },
        },
        {
          keybind: Keybind.parse("a")[0],
          title: "activate all",
          onTrigger: async () => {
            setSkills(skills().map((s) => ({ ...s, activated: true })))
            toast.show({
              message: "All skills activated",
              variant: "success",
            })
          },
        },
        {
          keybind: Keybind.parse("d")[0],
          title: "deactivate all",
          onTrigger: async () => {
            setSkills(skills().map((s) => ({ ...s, activated: false })))
            toast.show({
              message: "All skills deactivated",
              variant: "success",
            })
          },
        },
      ]}
    />
  )
}
