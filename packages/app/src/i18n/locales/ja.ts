export default {
  common: {
    loading: "読み込み中...",
    save: "保存",
    cancel: "キャンセル",
    confirm: "確認",
    delete: "削除",
    edit: "編集",
    search: "検索",
    back: "戻る",
    next: "次へ",
    close: "閉じる",
  },
  home: {
    title: "OpenCode AI",
    subtitle: "AI による開発ツール",
    start: "コーディングを開始",
    recentProjects: "最近のプロジェクト",
    noRecentProjects: "最近のプロジェクトがありません",
    getStarted: "ローカルプロジェクトを開いて始めましょう",
    openProject: "プロジェクトを開く",
  },
  session: {
    new: "新しいセッション",
    newSession: "新しいセッション",
    mainBranch: "メインブランチ",
    mainBranchWithName: "メインブランチ ({branch})",
    createWorktree: "新しいワークツリーを作成",
    lastModified: "最終更新",
    backToParent: "親セッションに戻る",
    share: "セッションを共有",
    terminate: "終了",
    archive: "セッションをアーカイブ",
    filesChanged: "{count} ファイルが変更されました",
  },
  dialog: {
    selectProvider: {
      title: "プロバイダーを選択",
      description: "使用する AI プロバイダーを選択してください",
    },
    selectModel: {
      title: "モデルを選択",
      description: "使用するモデルを選択してください",
      unpaid: {
        title: "モデルの支払いが必要",
        description: "このモデルを使用するには支払いが必要です",
      },
    },
    selectServer: {
      title: "サーバーを選択",
      description: "接続するサーバーを選択してください",
    },
    selectDirectory: {
      title: "ディレクトリを選択",
      description: "使用するディレクトリを選択してください",
      openProject: "プロジェクトを開く",
    },
    selectFile: {
      title: "ファイルを選択",
      description: "使用するファイルを選択してください",
    },
    selectMcp: {
      title: "MCP を選択",
      description: "モデル コンテキスト プロトコル サーバーを選択してください",
    },
    connectProvider: {
      title: "プロバイダーに接続",
      description: "AI プロバイダーの認証情報を設定してください",
    },
    editProject: {
      title: "プロジェクトを編集",
      description: "プロジェクト設定を編集してください",
      editProject: "プロジェクトを編集",
      closeProject: "プロジェクトを閉じる",
    },
    manageModels: {
      title: "モデルを管理",
      description: "利用可能なモデルを管理してください",
    },
  },
  terminal: {
    tabs: {
      session: "セッション",
      context: "コンテキスト",
      lsp: "LSP",
      mcp: "MCP",
    },
  },
  fileTree: {
    empty: "ファイルが見つかりません",
    refresh: "更新",
  },
  sidebar: {
    toggle: "サイドバーを切り替え",
    newSession: "新しいセッション",
    loadMore: "もっと見る",
    gettingStarted: "はじめに",
    gettingStartedDesc1: "OpenCode には無料モデルが含まれており、すぐに始められます。",
    gettingStartedDesc2: "プロバイダーを接続してモデルを使用できます（Claude、GPT、Gemini など）。",
    connectProvider: "プロバイダーに接続",
    shareFeedback: "フィードバックを共有",
    changeLanguage: "言語を変更",
  },
  layout: {
    editProject: "プロジェクトを編集",
    closeProject: "プロジェクトを閉じる",
  },
} as const
