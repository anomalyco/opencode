import { defineTaxonomies } from "../dsl"

export const taxonomies = defineTaxonomies({
  screenLabels: {
    "getting-started": {
      label: "Getting started",
      items: {
        "start-screen": "Start screen",
        "new-session": "New session",
      },
    },
    conversation: {
      label: "Conversation",
      items: {
        composer: "Composer",
        "question-response": "Question response",
        "tool-execution": "Tool execution",
        "diff-review": "Diff review",
        "subagent-activity": "Subagent activity",
        "shell-activity": "Shell activity",
      },
    },
    "session-management": {
      label: "Session management",
      items: {
        "session-list": "Session list",
        "rename-session": "Rename session",
        "fork-session": "Fork session",
        "export-session": "Export session",
      },
    },
    notifications: {
      label: "Notifications",
      items: {
        "toast-info": "Info toast",
        "toast-success": "Success toast",
        "toast-error": "Error toast",
      },
    },
    "models-and-agents": {
      label: "Models & agents",
      items: {
        "model-selection": "Model selection",
        "agent-selection": "Agent selection",
        "skill-selection": "Skill selection",
      },
    },
    configuration: {
      label: "Configuration",
      items: {
        "integration-setup": "Integration setup",
        "mcp-management": "MCP management",
        "theme-selection": "Theme selection",
        "device-pairing": "Device pairing",
      },
    },
    system: {
      label: "System",
      items: {
        "command-navigation": "Command navigation",
        "system-status": "System status",
        "help-reference": "Help & reference",
        debugging: "Debugging",
        "error-recovery": "Error recovery",
      },
    },
  },
  uiElements: {
    navigation: {
      label: "Navigation",
      items: {
        "command-palette": "Command palette",
        tabs: "Tabs",
        "keyboard-hints": "Keyboard hints",
        "shortcut-list": "Shortcut list",
      },
    },
    selection: {
      label: "Selection",
      items: {
        picker: "Picker",
        "search-field": "Search field",
        "single-select": "Single select",
        list: "List",
      },
    },
    input: {
      label: "Input",
      items: {
        "text-input": "Text input",
        form: "Form",
        composer: "Composer",
        "question-prompt": "Question prompt",
      },
    },
    actions: {
      label: "Actions",
      items: {
        "button-group": "Button group",
        "approval-actions": "Approval actions",
        "destructive-action": "Destructive action",
      },
    },
    feedback: {
      label: "Feedback",
      items: {
        "empty-state": "Empty state",
        "status-indicator": "Status indicator",
        toast: "Toast",
        confirmation: "Confirmation",
        "error-report": "Error report",
      },
    },
    content: {
      label: "Content",
      items: {
        "terminal-output": "Terminal output",
        transcript: "Transcript",
        "tool-card": "Tool card",
        "qr-code": "QR code",
        "debug-information": "Debug information",
      },
    },
    containers: {
      label: "Containers",
      items: {
        dialog: "Dialog",
        "inline-prompt": "Inline prompt",
        panel: "Panel",
        "full-screen-view": "Full-screen view",
      },
    },
  },
})
