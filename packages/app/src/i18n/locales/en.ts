export default {
  common: {
    loading: "Loading...",
    save: "Save",
    cancel: "Cancel",
    confirm: "Confirm",
    delete: "Delete",
    edit: "Edit",
    search: "Search",
    back: "Back",
    next: "Next",
    close: "Close",
  },
  home: {
    title: "OpenCode AI",
    subtitle: "AI-powered development tool",
    start: "Start Coding",
    recentProjects: "Recent projects",
    noRecentProjects: "No recent projects",
    getStarted: "Get started by opening a local project",
    openProject: "Open project",
  },
  session: {
    new: "New Session",
    newSession: "New session",
    mainBranch: "Main branch",
    mainBranchWithName: "Main branch ({branch})",
    createWorktree: "Create new worktree",
    lastModified: "Last modified",
    backToParent: "Back to parent session",
    share: "Share session",
    terminate: "Terminate",
    archive: "Archive session",
    filesChanged: "{count} file{plural} changed",
  },
  dialog: {
    selectProvider: {
      title: "Select Provider",
      description: "Choose an AI provider to use",
    },
    selectModel: {
      title: "Select Model",
      description: "Choose a model to use",
      unpaid: {
        title: "Model Payment Required",
        description: "This model requires payment to use",
      },
    },
    selectServer: {
      title: "Select Server",
      description: "Choose a server to connect to",
    },
    selectDirectory: {
      title: "Select Directory",
      description: "Choose a directory to work with",
      openProject: "Open project",
    },
    selectFile: {
      title: "Select File",
      description: "Choose a file to work with",
    },
    selectMcp: {
      title: "Select MCP",
      description: "Choose a Model Context Protocol server",
    },
    connectProvider: {
      title: "Connect Provider",
      description: "Configure your AI provider credentials",
    },
    editProject: {
      title: "Edit Project",
      description: "Edit project settings",
      editProject: "Edit project",
      closeProject: "Close project",
    },
    manageModels: {
      title: "Manage Models",
      description: "Manage available models",
    },
  },
  terminal: {
    tabs: {
      session: "Session",
      context: "Context",
      lsp: "LSP",
      mcp: "MCP",
    },
  },
  fileTree: {
    empty: "No files found",
    refresh: "Refresh",
  },
  sidebar: {
    toggle: "Toggle sidebar",
    newSession: "New session",
    loadMore: "Load more",
    gettingStarted: "Getting started",
    gettingStartedDesc1: "OpenCode includes free models so you can start immediately.",
    gettingStartedDesc2: "Connect any provider to use models, inc. Claude, GPT, Gemini etc.",
    connectProvider: "Connect provider",
    shareFeedback: "Share feedback",
    changeLanguage: "Change language",
  },
  layout: {
    editProject: "Edit project",
    closeProject: "Close project",
  },
} as const
