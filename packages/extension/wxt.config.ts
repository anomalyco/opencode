import { defineConfig } from "wxt"

export default defineConfig({
  modules: ["@wxt-dev/module-solid"],
  manifest: {
    name: "Eidorail - AI Chat Sidebar",
    version: "0.1.0",
    description: "AI-powered chat sidebar with OpenCode integration and multi-platform support",
    icons: {
      16: "icon-16.png",
      32: "icon-32.png",
      48: "icon-48.png",
      128: "icon-128.png",
    },
    permissions: ["sidePanel", "storage", "tabs", "activeTab", "scripting", "declarativeNetRequest", "tabGroups"],
    host_permissions: [
      "http://localhost:4096/*",
      "http://127.0.0.1:4096/*",
      "http://localhost:4097/*",
      "http://127.0.0.1:4097/*",
      "https://claude.ai/*",
      "https://chat.openai.com/*",
      "https://chatgpt.com/*",
      "https://gemini.google.com/*",
      "<all_urls>",
    ],
    side_panel: {
      default_path: "sidepanel.html",
    },
    action: {
      default_title: "Eidorail",
      default_icon: {
        16: "icon-16.png",
        32: "icon-32.png",
        48: "icon-48.png",
        128: "icon-128.png",
      },
    },
    commands: {
      _execute_action: {
        suggested_key: {
          default: "Ctrl+Shift+E",
          mac: "Command+Shift+E",
        },
        description: "Open Eidorail side panel",
      },
      "toggle-side-panel": {
        suggested_key: {
          default: "Ctrl+E",
          mac: "Command+E",
        },
        description: "Toggle Eidorail side panel",
      },
    },
    // Options page configuration for Edge/Chrome
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
    // Declarative Net Request rules for iframe embedding
    declarative_net_request: {
      rule_resources: [
        {
          id: "iframe_rules",
          enabled: true,
          path: "iframe-rules.json",
        },
      ],
    },
  },
})
