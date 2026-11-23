import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"

export default Plugin.define({
  id: "fixture.tool-settings",
  setup(context) {
    const [showHeader, setShowHeader] = createSignal(true)
    const [headerGap, setHeaderGap] = createSignal(false)
    const [workdirMode, setWorkdirMode] = createSignal<"header" | "command">("header")

    context.ui.settings.register({
      id: "header",
      title: "Header",
      category: "Shell",
      description: "Show shell header",
      value: showHeader,
      values: [false, true],
      labels: ["off", "on"],
      onChange: (next) => {
        setShowHeader(Boolean(next))
      },
    })

    context.ui.settings.register({
      id: "header_gap",
      title: "Header spacing",
      category: "Shell",
      description: "Blank line after shell header",
      value: headerGap,
      values: [false, true],
      labels: ["off", "on"],
      onChange: (next) => {
        setHeaderGap(Boolean(next))
      },
    })

    context.ui.settings.register({
      id: "workdir",
      title: "Workdir",
      category: "Shell",
      description: "Place workdir in header or command",
      value: workdirMode,
      values: ["header", "command"],
      labels: ["header", "command (cd)"],
      onChange: (next) => {
        setWorkdirMode(next === "command" ? "command" : "header")
      },
    })

    context.ui.tools.decorate("shell", (ctx) => {
      const shell = typeof ctx.metadata.shell === "string" ? ctx.metadata.shell : undefined
      const dir = ctx.workdir && ctx.workdir !== "." ? ctx.workdir : undefined
      const inHeader = workdirMode() === "header"
      if (inHeader && dir) {
        return {
          path: { label: showHeader() ? `# ${shell ?? "shell"} in` : "# in", value: dir },
          gap: headerGap() ? 1 : 0,
          commandPrefix: "",
        }
      }
      return {
        title: showHeader() && shell ? `# ${shell}` : undefined,
        gap: headerGap() ? 1 : 0,
      }
    })
  },
})
