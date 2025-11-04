import { createMemo, createSignal, onMount, For } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { useToast } from "@tui/ui/toast"
import { TextAttributes } from "@opentui/core"
import { SkillInstance } from "@/skills"
import type { SkillMetadata } from "@/skills"

export function DialogSkillManager() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const toast = useToast()

  const initialSkills = SkillInstance.list()
  console.log("[DialogSkillManager] Initial skills on mount:", initialSkills.length)

  const [skills, setSkills] = createSignal<SkillMetadata[]>(initialSkills)
  const [activeSkills, setActiveSkills] = createSignal<Set<string>>(
    new Set(SkillInstance.getActive().map((s) => s.frontmatter.name)),
  )

  onMount(() => {
    console.log("[DialogSkillManager] onMount - isReady:", SkillInstance.isReady())
    console.log("[DialogSkillManager] onMount - skills().length:", skills().length)

    dialog.setSize("large")

    // If already ready, load immediately
    if (SkillInstance.isReady()) {
      console.log("[DialogSkillManager] Skills ready, calling loadSkills()")
      loadSkills()
    } else {
      console.log("[DialogSkillManager] Skills not ready, starting poll")
      // Poll until initialized
      const interval = setInterval(() => {
        if (SkillInstance.isReady()) {
          clearInterval(interval)
          loadSkills()
        }
      }, 100)

      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(interval)
        if (!SkillInstance.isReady()) {
          toast.show({
            message: "Skill loading timeout - please try again",
            variant: "error",
          })
        }
      }, 10000)
    }
  })

  function loadSkills() {
    const discovered = SkillInstance.list()
    const active = SkillInstance.getActive()

    console.log(
      `[DialogSkillManager] loadSkills() called - Discovered ${discovered.length} skills, ${active.length} active`,
    )
    console.log(
      "[DialogSkillManager] Skills:",
      discovered.map((s) => s.frontmatter.name),
    )

    setSkills(discovered)
    setActiveSkills(new Set(active.map((s) => s.frontmatter.name)))

    console.log("[DialogSkillManager] After setSkills, skills().length =", skills().length)

    if (discovered.length > 0) {
      toast.show({
        message: `Loaded ${discovered.length} skills`,
        variant: "success",
      })
    }
  }

  const options = createMemo(() => {
    return skills().map((skill) => {
      const sourceEmoji = {
        project: "📁",
        user: "👤",
        plugin: "🔌",
      }[skill.source]

      const activated = activeSkills().has(skill.frontmatter.name)
      const statusEmoji = activated ? "✅" : "⭕"

      return {
        value: skill.frontmatter.name,
        title: `${sourceEmoji} ${statusEmoji} ${skill.frontmatter.name}`,
        footer: skill.frontmatter.description,
        category: activated ? "Active" : "Available",
      }
    })
  })

  async function toggleSkillActivation(skillName: string) {
    const skill = skills().find((s) => s.frontmatter.name === skillName)
    if (!skill) return

    try {
      const system = await SkillInstance.get()
      const isActive = activeSkills().has(skillName)

      if (isActive) {
        system.deactivateSkill(skillName)
        setActiveSkills((prev) => {
          const next = new Set(prev)
          next.delete(skillName)
          return next
        })
        toast.show({
          message: `${skillName} deactivated`,
          variant: "success",
        })
      } else {
        await system.activateSkill(skillName, "Manual activation from TUI")
        setActiveSkills((prev) => new Set(prev).add(skillName))
        toast.show({
          message: `${skillName} activated`,
          variant: "success",
        })
      }
    } catch (error) {
      toast.show({
        message: `Failed to toggle ${skillName}: ${error}`,
        variant: "error",
      })
    }
  }

  async function showSkillDetails(skillName: string) {
    const skill = skills().find((s) => s.frontmatter.name === skillName)
    if (!skill) return

    const isActive = activeSkills().has(skillName)
    const allowedTools = skill.frontmatter.allowedTools || []

    const details = `
${skill.frontmatter.name}

${skill.frontmatter.description}

Source: ${skill.source}
Path: ${skill.path}
Status: ${isActive ? "Active" : "Inactive"}
${allowedTools.length > 0 ? `Allowed Tools: ${allowedTools.join(", ")}` : "All tools allowed"}
Supporting Files: ${
      [
        skill.hasReference && "reference.md",
        skill.hasExamples && "examples.md",
        skill.hasScripts && "scripts/",
        skill.hasTemplates && "templates/",
      ]
        .filter(Boolean)
        .join(", ") || "None"
    }
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
          <text fg={theme.textMuted}>
            Create skills in .opencode/skills/, .claude/skills/, or ~/.opencode/skills/
          </text>
          <box marginTop={1}>
            <text attributes={TextAttributes.BOLD}>Skill Structure:</text>
            <text fg={theme.textMuted}>skill-name/</text>
            <text fg={theme.textMuted}> ├── SKILL.md (required)</text>
            <text fg={theme.textMuted}> ├── reference.md (optional)</text>
            <text fg={theme.textMuted}> ├── examples.md (optional)</text>
            <text fg={theme.textMuted}> ├── scripts/ (optional)</text>
            <text fg={theme.textMuted}> └── templates/ (optional)</text>
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
          keybind: Keybind.parse("ctrl+t")[0],
          title: "toggle",
          onTrigger: async (option) => {
            await toggleSkillActivation(option.value)
          },
        },
        {
          keybind: Keybind.parse("ctrl+i")[0],
          title: "info",
          onTrigger: async (option) => {
            await showSkillDetails(option.value)
          },
        },
        {
          keybind: Keybind.parse("ctrl+r")[0],
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
          keybind: Keybind.parse("ctrl+a")[0],
          title: "activate all",
          onTrigger: async () => {
            try {
              const system = await SkillInstance.get()
              const allSkills = skills()

              for (const skill of allSkills) {
                if (!activeSkills().has(skill.frontmatter.name)) {
                  await system.activateSkill(skill.frontmatter.name, "Bulk activation from TUI")
                }
              }

              setActiveSkills(new Set(allSkills.map((s) => s.frontmatter.name)))
              toast.show({
                message: `Activated ${allSkills.length} skills`,
                variant: "success",
              })
            } catch (error) {
              toast.show({
                message: `Failed to activate all: ${error}`,
                variant: "error",
              })
            }
          },
        },
        {
          keybind: Keybind.parse("ctrl+d")[0],
          title: "deactivate all",
          onTrigger: async () => {
            try {
              const system = await SkillInstance.get()
              const count = system.deactivateAll()

              setActiveSkills(new Set<string>())
              toast.show({
                message: `Deactivated ${count} skills`,
                variant: "success",
              })
            } catch (error) {
              toast.show({
                message: `Failed to deactivate all: ${error}`,
                variant: "error",
              })
            }
          },
        },
      ]}
    />
  )
}
