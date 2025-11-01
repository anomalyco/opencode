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

  const [skills, setSkills] = createSignal<SkillMetadata[]>([])
  const [activeSkills, setActiveSkills] = createSignal<Set<string>>(new Set())
  const [loading, setLoading] = createSignal(true)

  onMount(() => {
    dialog.setSize("large")
    loadSkills()
  })

  async function loadSkills() {
    try {
      setLoading(true)
      console.log("[DialogSkillManager] Starting to load skills...")

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Skill loading timeout after 10 seconds")), 10000),
      )

      const system = (await Promise.race([SkillInstance.get(), timeoutPromise])) as Awaited<
        ReturnType<typeof SkillInstance.get>
      >

      console.log("[DialogSkillManager] Got skill system instance")
      const discovered = system.getAllSkills()
      const active = system.getActiveSkills()

      console.log(
        `[DialogSkillManager] Discovered ${discovered.length} skills, ${active.length} active`,
      )
      setSkills(discovered)
      setActiveSkills(new Set(active.map((s) => s.frontmatter.name)))

      toast.show({
        message: `Loaded ${discovered.length} skills`,
        variant: "success",
      })
    } catch (error) {
      console.error("[DialogSkillManager] Failed to load skills:", error)
      toast.show({
        message: `Failed to load skills: ${error}`,
        variant: "error",
      })
    } finally {
      setLoading(false)
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

  if (loading()) {
    return (
      <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD}>Skill Manager</text>
          <text fg={theme.textMuted}>esc</text>
        </box>
        <text>Loading skills...</text>
      </box>
    )
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
            Create skills in .codesurf/skills/, .claude/skills/, or ~/.codesurf/skills/
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
          keybind: Keybind.parse("d")[0],
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
