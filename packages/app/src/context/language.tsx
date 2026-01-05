import { createContext, createSignal, useContext, type Accessor } from "solid-js"

export type Language = "en" | "zh"

export interface LanguageContextType {
  language: Accessor<Language>
  setLanguage: (language: Language) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageContextType>()

export function useLanguage(): LanguageContextType {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider")
  }
  return context
}

export function LanguageProvider(props: { children: any }) {
  const [language, setLanguage] = createSignal<Language>(
    (localStorage.getItem("opencode-language") as Language) ?? "en",
  )

  function setLanguageWithStorage(lang: Language) {
    setLanguage(lang)
    localStorage.setItem("opencode-language", lang)
  }

  async function loadTranslations(lang: Language) {
    const translations = await import(`../locales/${lang}.json`)
    return translations.default
  }

  function t(key: string, params?: Record<string, string | number>): string {
    const lang = language()
    const keys = key.split(".")

    // Simple fallback mechanism - in a real implementation you'd want to preload translations
    const translations: Record<string, any> = {
      en: {
        common: {
          loading: "Loading...",
          save: "Save",
          cancel: "Cancel",
          delete: "Delete",
          edit: "Edit",
          close: "Close",
          open: "Open",
          new: "New",
          settings: "Settings",
          search: "Search",
          clear: "Clear",
          confirm: "Confirm",
          retry: "Retry",
          back: "Back",
          next: "Next",
          previous: "Previous",
          done: "Done",
        },
        sidebar: {
          toggle: "Toggle sidebar",
          openProject: "Open project",
          connectProvider: "Connect provider",
          shareFeedback: "Share feedback",
          newSession: "New session",
          archiveSession: "Archive session",
          editProject: "Edit project",
          closeProject: "Close project",
          gettingStarted: "Getting started",
          gettingStartedDesc1: "OpenCode includes free models so you can start immediately.",
          gettingStartedDesc2: "Connect any provider to use models, inc. Claude, GPT, Gemini etc.",
        },
        session: {
          new: "New session",
          previous: "Previous session",
          next: "Next session",
          archive: "Archive session",
          noFiles: "No files changed",
          filesChanged: "{count} file(s) changed",
        },
        theme: {
          switched: "Theme switched",
          colorScheme: "Color scheme",
          cycle: "Cycle theme",
          cycleColorScheme: "Cycle color scheme",
        },
        dialog: {
          selectDirectory: "Select directory",
          selectFile: "Select file",
          editProject: "Edit project",
          connectProvider: "Connect provider",
          selectServer: "Select server",
          selectModel: "Select model",
        },
        notification: {
          permissionRequired: "Permission required",
          updateAvailable: "Update available",
          updateDesc: "A new version of OpenCode ({version}) is now available to install.",
          installAndRestart: "Install and restart",
          notYet: "Not yet",
          goToSession: "Go to session",
          dismiss: "Dismiss",
        },
        server: { switch: "Switch server" },
        provider: { connect: "Connect provider" },
        project: { open: "Open project" },
      },
      zh: {
        common: {
          loading: "加载中...",
          save: "保存",
          cancel: "取消",
          delete: "删除",
          edit: "编辑",
          close: "关闭",
          open: "打开",
          new: "新建",
          settings: "设置",
          search: "搜索",
          clear: "清除",
          confirm: "确认",
          retry: "重试",
          back: "返回",
          next: "下一个",
          previous: "上一个",
          done: "完成",
        },
        sidebar: {
          toggle: "切换侧边栏",
          openProject: "打开项目",
          connectProvider: "连接提供商",
          shareFeedback: "分享反馈",
          newSession: "新会话",
          archiveSession: "归档会话",
          editProject: "编辑项目",
          closeProject: "关闭项目",
          gettingStarted: "开始使用",
          gettingStartedDesc1: "OpenCode 包含免费模型，您可以立即开始使用。",
          gettingStartedDesc2: "连接任何提供商以使用模型，包括 Claude、GPT、Gemini 等。",
        },
        session: {
          new: "新会话",
          previous: "上一个会话",
          next: "下一个会话",
          archive: "归档会话",
          noFiles: "无文件更改",
          filesChanged: "{count} 个文件已更改",
        },
        theme: {
          switched: "主题已切换",
          colorScheme: "配色方案",
          cycle: "循环切换主题",
          cycleColorScheme: "循环切换配色方案",
        },
        dialog: {
          selectDirectory: "选择目录",
          selectFile: "选择文件",
          editProject: "编辑项目",
          connectProvider: "连接提供商",
          selectServer: "选择服务器",
          selectModel: "选择模型",
        },
        notification: {
          permissionRequired: "需要权限",
          updateAvailable: "有可用更新",
          updateDesc: "OpenCode 的新版本 ({version}) 现在可以安装。",
          installAndRestart: "安装并重启",
          notYet: "暂不",
          goToSession: "前往会话",
          dismiss: "忽略",
        },
        server: { switch: "切换服务器" },
        provider: { connect: "连接提供商" },
        project: { open: "打开项目" },
      },
    }

    let value: any = translations[lang]
    for (const k of keys) {
      value = value?.[k]
    }

    if (typeof value !== "string") {
      // Fallback to English if translation not found
      value = translations.en
      for (const k of keys) {
        value = value?.[k]
      }
    }

    if (typeof value !== "string") {
      return key // Return the key if no translation found
    }

    // Replace parameters in the translation
    if (params) {
      return value.replace(/\{(\w+)\}/g, (match: string, param: string) => {
        return params[param]?.toString() || match
      })
    }

    return value
  }

  const value: LanguageContextType = {
    language,
    setLanguage: setLanguageWithStorage,
    t,
  }

  return <LanguageContext.Provider value={value}>{props.children}</LanguageContext.Provider>
}
