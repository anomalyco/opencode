import { createContext, type JSX, useContext } from "solid-js"

const dictionaries = {
  en: {
    "home.placeholder.fixTodo": "Fix a TODO in the codebase",
    "home.placeholder.techStack": "What is the tech stack of this project?",
    "home.placeholder.fixTests": "Fix broken tests",
    "sidebar.gettingStarted": "Getting started",
    "sidebar.freeModels": "OpenCode includes free models so you can start immediately.",
    "sidebar.providers": "Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc",
    "sidebar.connectProvider": "Connect provider",
    "footer.getStarted": "Get started",
    "footer.permission": "Permission",
    "footer.permissions": "Permissions",
    "startup.finishing": "Finishing startup...",
    "startup.loadingPlugins": "Loading plugins...",
    "dialog.cancel": "Cancel",
    "dialog.confirm": "Confirm",
    "palette.commands": "Commands",
    "palette.suggested": "Suggested",
  },
  "zh-CN": {
    "home.placeholder.fixTodo": "修复代码库中的待办事项",
    "home.placeholder.techStack": "这个项目使用什么技术栈？",
    "home.placeholder.fixTests": "修复失败的测试",
    "sidebar.gettingStarted": "开始使用",
    "sidebar.freeModels": "OpenCode 包含免费模型，您可以立即开始使用。",
    "sidebar.providers": "连接超过 75 家提供商以使用其他模型，包括 Claude、GPT、Gemini 等。",
    "sidebar.connectProvider": "连接提供商",
    "footer.getStarted": "开始使用",
    "footer.permission": "项权限",
    "footer.permissions": "项权限",
    "startup.finishing": "正在完成启动...",
    "startup.loadingPlugins": "正在加载插件...",
    "dialog.cancel": "取消",
    "dialog.confirm": "确认",
    "palette.commands": "命令",
    "palette.suggested": "推荐",
  },
} as const

export type Locale = keyof typeof dictionaries
export type TranslationKey = keyof (typeof dictionaries)["en"]

export function resolveLocale(value: unknown, env = process.env): Locale {
  if (value === "en" || value === "zh-CN") return value
  const system = env.LC_ALL || env.LC_MESSAGES || env.LANG || ""
  return /^zh(?:[_-]CN|$)/i.test(system) ? "zh-CN" : "en"
}

export function translate(locale: Locale, key: TranslationKey) {
  return dictionaries[locale][key] ?? dictionaries.en[key]
}

const Context = createContext<Locale>("en")

export function TuiI18nProvider(props: { locale: Locale; children: JSX.Element }) {
  return <Context.Provider value={props.locale}>{props.children}</Context.Provider>
}

export function useTuiI18n() {
  const locale = useContext(Context)
  return {
    locale,
    t: (key: TranslationKey) => translate(locale, key),
  }
}