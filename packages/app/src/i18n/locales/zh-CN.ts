export default {
  common: {
    loading: "加载中...",
    save: "保存",
    cancel: "取消",
    confirm: "确认",
    delete: "删除",
    edit: "编辑",
    search: "搜索",
    back: "返回",
    next: "下一步",
    close: "关闭",
  },
  home: {
    title: "OpenCode AI",
    subtitle: "AI 驱动的开发工具",
    start: "开始编码",
    recentProjects: "最近的项目",
    noRecentProjects: "没有最近的项目",
    getStarted: "打开本地项目开始使用",
    openProject: "打开项目",
  },
  session: {
    new: "新会话",
    newSession: "新会话",
    mainBranch: "主分支",
    mainBranchWithName: "主分支 ({branch})",
    createWorktree: "创建新工作树",
    lastModified: "最后修改",
    backToParent: "返回父会话",
    share: "分享会话",
    terminate: "终止",
    archive: "归档会话",
    filesChanged: "{count} 个文件已更改",
  },
  dialog: {
    selectProvider: {
      title: "选择提供商",
      description: "选择要使用的 AI 提供商",
    },
    selectModel: {
      title: "选择模型",
      description: "选择要使用的模型",
      unpaid: {
        title: "模型需要付费",
        description: "此模型需要付费才能使用",
      },
    },
    selectServer: {
      title: "选择服务器",
      description: "选择要连接的服务器",
    },
    selectDirectory: {
      title: "选择目录",
      description: "选择要使用的目录",
      openProject: "打开项目",
    },
    selectFile: {
      title: "选择文件",
      description: "选择要使用的文件",
    },
    selectMcp: {
      title: "选择 MCP",
      description: "选择模型上下文协议服务器",
    },
    connectProvider: {
      title: "连接提供商",
      description: "配置您的 AI 提供商凭据",
    },
    editProject: {
      title: "编辑项目",
      description: "编辑项目设置",
      editProject: "编辑项目",
      closeProject: "关闭项目",
    },
    manageModels: {
      title: "管理模型",
      description: "管理可用模型",
    },
  },
  terminal: {
    tabs: {
      session: "会话",
      context: "上下文",
      lsp: "LSP",
      mcp: "MCP",
    },
  },
  fileTree: {
    empty: "未找到文件",
    refresh: "刷新",
  },
  sidebar: {
    toggle: "切换侧边栏",
    newSession: "新会话",
    loadMore: "加载更多",
    gettingStarted: "入门指南",
    gettingStartedDesc1: "OpenCode 包含免费模型，您可以立即开始使用。",
    gettingStartedDesc2: "连接任何提供商以使用模型，包括 Claude、GPT、Gemini 等。",
    connectProvider: "连接提供商",
    shareFeedback: "分享反馈",
    changeLanguage: "切换语言",
  },
  layout: {
    editProject: "编辑项目",
    closeProject: "关闭项目",
  },
} as const
