const dict: Record<string, string> = {
  "session.todo.title": "Todos",
  "session.todo.collapse": "Collapse todos",
  "session.todo.expand": "Expand todos",
  "prompt.loading": "Loading prompt...",
  "prompt.placeholder.normal": "Ask anything...",
  "prompt.placeholder.simple": "Ask anything...",
  "prompt.placeholder.shell": "Run a shell command...",
  "prompt.placeholder.summarizeComment": "Summarize this comment",
  "prompt.placeholder.summarizeComments": "Summarize these comments",
  "prompt.action.attachFile": "Attach files",
  "prompt.action.send": "Send",
  "prompt.action.stop": "Stop",
  "prompt.attachment.remove": "Remove attachment",
  "prompt.dropzone.label": "Drop image to attach",
  "prompt.dropzone.file.label": "Drop file to attach",
  "prompt.mode.shell": "Shell",
  "prompt.mode.normal": "Prompt",
  "dialog.model.select.title": "Select model",
  "common.default": "Default",
  "common.key.esc": "Esc",
  "command.category.file": "File",
  "command.category.session": "Session",
  "command.agent.cycle": "Cycle agent",
  "command.model.choose": "Choose model",
  "command.model.variant.cycle": "Cycle model variant",
  "command.prompt.mode.shell": "Switch to shell mode",
  "command.prompt.mode.normal": "Switch to prompt mode",
  "command.permissions.autoaccept.enable": "Enable auto-accept",
  "command.permissions.autoaccept.disable": "Disable auto-accept",
  "prompt.example.1": "Refactor this function and keep behavior the same",
  "prompt.example.2": "Find the root cause of this error",
  "prompt.example.3": "Write tests for this module",
  "prompt.example.4": "Explain this diff",
  "prompt.example.5": "Optimize this query",
  "prompt.example.6": "Clean up this component",
  "prompt.example.7": "Summarize the recent changes",
  "prompt.example.8": "Add accessibility checks",
  "prompt.example.9": "Review this API design",
  "prompt.example.10": "Generate migration notes",
  "prompt.example.11": "Patch this bug",
  "prompt.example.12": "Make this animation smoother",
  "prompt.example.13": "Improve error handling",
  "prompt.example.14": "Document this feature",
  "prompt.example.15": "Refine these styles",
  "prompt.example.16": "Check edge cases",
  "prompt.example.17": "Help me write a commit message",
  "prompt.example.18": "Reduce re-renders in this component",
  "prompt.example.19": "Verify keyboard navigation",
  "prompt.example.20": "Make this copy clearer",
  "prompt.example.21": "Add telemetry for this flow",
  "prompt.example.22": "Compare these two implementations",
  "prompt.example.23": "Create a minimal reproduction",
  "prompt.example.24": "Suggest naming improvements",
  "prompt.example.25": "What should we test next?",
}

function render(template: string, params?: Record<string, unknown>) {
  if (!params) return template
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
    const value = params[key.trim()]
    if (value === undefined || value === null) return ""
    return String(value)
  })
}

export function useLanguage() {
  return {
    locale: () => "en" as const,
    t(key: string, params?: Record<string, unknown>) {
      return render(dict[key] ?? key, params)
    },
  }
}
