// @ts-check
import { defineConfig } from "astro/config"
import starlight from "@astrojs/starlight"
import solidJs from "@astrojs/solid-js"
import cloudflare from "@astrojs/cloudflare"
import theme from "toolbeam-docs-theme"
import config from "./config.mjs"
import { rehypeHeadingIds } from "@astrojs/markdown-remark"
import rehypeAutolinkHeadings from "rehype-autolink-headings"
import { spawnSync } from "child_process"
import { visit } from "unist-util-visit"

// https://astro.build/config
export default defineConfig({
  site: config.url,
  base: "/docs",
  output: "server",
  adapter: cloudflare({
    imageService: "passthrough",
  }),
  devToolbar: {
    enabled: false,
  },
  server: {
    host: "0.0.0.0",
  },
  markdown: {
    rehypePlugins: [
      rehypeHeadingIds,
      [rehypeAutolinkHeadings, { behavior: "wrap" }],
      () => (tree, file) => {
        const filePath = typeof file?.path === "string" ? file.path : ""
        const normalizedPath = filePath.replace(/\\/g, "/")
        const docsMarker = "/src/content/docs/"
        const docsIndex = normalizedPath.lastIndexOf(docsMarker)
        const localeDir =
          docsIndex === -1
            ? "en"
            : normalizedPath.slice(docsIndex + docsMarker.length).split("/")[0] || "en"
        const locale = localeDir === "en" ? "root" : localeDir
        const base = locale === "root" ? "/docs" : `/docs/${locale}`

        visit(tree, "element", (node) => {
          if (node.tagName !== "a") return
          const href = node.properties?.href
          if (typeof href !== "string") return
          if (!href.startsWith("/docs")) return
          const isRoot = href === "/docs"
          const isRootHash = href.startsWith("/docs#")
          const normalized = isRoot ? base : isRootHash ? `${base}${href.slice(5)}` : href.replace("/docs/", `${base}/`)
          node.properties.href = normalized
        })
      },
    ],
  },
  build: {},
  integrations: [
    configSchema(),
    solidJs(),
    starlight({
      title: "OpenCode",
      locales: {
        root: { label: "English", lang: "en" },
        "zh-cn": { label: "中文", lang: "zh-CN" },
      },
      defaultLocale: "root",
      lastUpdated: true,
      expressiveCode: { themes: ["github-light", "github-dark"] },
      social: [
        { icon: "github", label: "GitHub", href: config.github },
        { icon: "discord", label: "Discord", href: config.discord },
      ],
      editLink: {
        baseUrl: `${config.github}/edit/dev/packages/web/`,
      },
      markdown: {
        headingLinks: false,
      },
      customCss: ["./src/styles/custom.css"],
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: true,
      },
      // @ts-ignore
      sidebar: withTranslations([
        {
          label: "Intro",
          translations: { "zh-cn": "介绍" },
          link: "",
        },
        {
          label: "Config",
          translations: { "zh-cn": "配置" },
          link: "config",
        },
        {
          label: "Providers",
          translations: { "zh-cn": "提供商" },
          link: "providers",
        },
        {
          label: "Network",
          translations: { "zh-cn": "网络" },
          link: "network",
        },
        {
          label: "Enterprise",
          translations: { "zh-cn": "企业" },
          link: "enterprise",
        },
        {
          label: "Troubleshooting",
          translations: { "zh-cn": "故障排查" },
          link: "troubleshooting",
        },
        {
          label: "1-0",
          translations: { "zh-cn": "1-0 版本" },
          link: "1-0",
        },
        {
          label: "Usage",
          translations: { "zh-cn": "使用" },
          items: [
            { label: "TUI", translations: { "zh-cn": "TUI" }, link: "tui" },
            { label: "CLI", translations: { "zh-cn": "CLI" }, link: "cli" },
            { label: "Web", translations: { "zh-cn": "Web" }, link: "web" },
            { label: "IDE", translations: { "zh-cn": "IDE" }, link: "ide" },
            { label: "Zen", translations: { "zh-cn": "Zen" }, link: "zen" },
            { label: "Share", translations: { "zh-cn": "分享" }, link: "share" },
            { label: "GitHub", translations: { "zh-cn": "GitHub" }, link: "github" },
            { label: "GitLab", translations: { "zh-cn": "GitLab" }, link: "gitlab" },
          ],
        },
        {
          label: "Configure",
          translations: { "zh-cn": "配置" },
          items: [
            { label: "tools", translations: { "zh-cn": "tools" }, link: "tools" },
            { label: "rules", translations: { "zh-cn": "规则" }, link: "rules" },
            { label: "agents", translations: { "zh-cn": "agents" }, link: "agents" },
            { label: "models", translations: { "zh-cn": "模型" }, link: "models" },
            { label: "themes", translations: { "zh-cn": "主题" }, link: "themes" },
            { label: "keybinds", translations: { "zh-cn": "快捷键" }, link: "keybinds" },
            { label: "commands", translations: { "zh-cn": "命令" }, link: "commands" },
            { label: "formatters", translations: { "zh-cn": "格式化" }, link: "formatters" },
            { label: "permissions", translations: { "zh-cn": "权限" }, link: "permissions" },
            { label: "lsp", translations: { "zh-cn": "LSP" }, link: "lsp" },
            { label: "mcp-servers", translations: { "zh-cn": "mcp servers" }, link: "mcp-servers" },
            { label: "acp", translations: { "zh-cn": "ACP" }, link: "acp" },
            { label: "skills", translations: { "zh-cn": "skills" }, link: "skills" },
            { label: "custom tools", translations: { "zh-cn": "custom tools" }, link: "custom-tools" },
          ],
        },
        {
          label: "Develop",
          translations: { "zh-cn": "开发" },
          items: [
            { label: "SDK", translations: { "zh-cn": "SDK" }, link: "sdk" },
            { label: "Server", translations: { "zh-cn": "服务器" }, link: "server" },
            { label: "Plugins", translations: { "zh-cn": "插件" }, link: "plugins" },
            { label: "Ecosystem", translations: { "zh-cn": "生态" }, link: "ecosystem" },
          ],
        },
      ]),
      components: {
        Hero: "./src/components/Hero.astro",
        Head: "./src/components/Head.astro",
        Header: "./src/components/Header.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      plugins: [
        theme({
          headerLinks: config.headerLinks,
        }),
      ],
    }),
  ],
})

function configSchema() {
  return {
    name: "configSchema",
    hooks: {
      "astro:build:done": async () => {
        console.log("generating config schema")
        spawnSync("../opencode/script/schema.ts", ["./dist/config.json"])
      },
    },
  }
}

/**
 * @param {any[]} sidebar
 */
function withTranslations(sidebar) {
  return sidebar.map((item) => {
    if (item.translations && item.translations["zh-cn"]) {
      item.translations["zh-CN"] = item.translations["zh-cn"]
    }
    if (item.items) {
      item.items = withTranslations(item.items)
    }
    return item
  })
}
