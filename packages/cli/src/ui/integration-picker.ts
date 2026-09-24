import { AutocompletePrompt } from "@clack/core"
import { S_BAR, S_BAR_END, S_RADIO_ACTIVE, S_RADIO_INACTIVE, symbol } from "@clack/prompts"
import color from "picocolors"

export type IntegrationChoice = {
  value: string
  label: string
  category: "MCP" | "Popular" | "Services"
  connected: boolean
}

export async function selectIntegration(choices: IntegrationChoice[], kind = "integration") {
  const result = await new AutocompletePrompt<IntegrationChoice>({
    options: choices,
    filter: (search, choice) =>
      [choice.label, choice.value, choice.category].some((value) => value.toLowerCase().includes(search.toLowerCase())),
    validate: (value) => (value ? undefined : `Select an ${kind}`),
    render() {
      const title = `${color.gray(S_BAR)}\n${symbol(this.state)}  Select ${kind}\n`
      if (this.state === "submit") {
        const choice = choices.find((item) => item.value === this.value)
        return `${title}${color.gray(S_BAR)}  ${color.dim(choice?.label ?? "")}`
      }
      if (this.state === "cancel")
        return `${title}${color.gray(S_BAR)}  ${color.strikethrough(color.dim(this.userInput))}`

      // Leave room for the category headings as well as Clack's title and footer.
      const maxItems = Math.min(8, Math.max(2, (process.stdout.rows ?? 24) - 14 - Number(this.state === "error")))
      const compact = (process.stdout.rows ?? 24) < 18
      const start = Math.min(Math.max(0, this.cursor - 2), Math.max(0, this.filteredOptions.length - maxItems))
      const visible = this.filteredOptions.slice(start, start + maxItems)
      const rows = visible.flatMap((choice, index) => [
        ...(index === 0 || visible[index - 1].category !== choice.category
          ? [...(compact ? [] : [`${color.cyan(S_BAR)}  `]), `${color.cyan(S_BAR)}  ${color.bold(choice.category)}`]
          : []),
        `${color.cyan(S_BAR)}  ${start + index === this.cursor ? color.green(S_RADIO_ACTIVE) : color.dim(S_RADIO_INACTIVE)} ${
          start + index === this.cursor ? choice.label : color.dim(choice.label)
        }${choice.connected ? ` ${color.green("✓")}` : ""}`,
      ])
      return [
        title,
        `${color.cyan(S_BAR)}  ${color.dim("Search:")} ${this.isNavigating ? color.dim(this.userInput) : this.userInputWithCursor}`,
        ...(visible.length === 0 && this.userInput
          ? [`${color.cyan(S_BAR)}  ${color.yellow(`No ${kind}s found`)}`]
          : []),
        ...(this.state === "error" && visible.length > 0
          ? [`${color.yellow(S_BAR)}  ${color.yellow(this.error)}`]
          : []),
        ...(start > 0 ? [`${color.cyan(S_BAR)}  ${color.dim("…")}`] : []),
        ...rows,
        ...(start + maxItems < this.filteredOptions.length ? [`${color.cyan(S_BAR)}  ${color.dim("…")}`] : []),
        `${color.cyan(S_BAR)}  ${color.dim(
          (process.stdout.columns ?? 80) < 50
            ? "↑/↓ navigate • Enter select"
            : "↑/↓ to select • Enter: confirm • Type: to search",
        )}`,
        color.cyan(S_BAR_END),
      ].join("\n")
    },
  }).prompt()
  if (typeof result === "string" || typeof result === "symbol") return result
  throw new Error(`No ${kind} selected`)
}
