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
    rehypePlugins: [rehypeHeadingIds, [rehypeAutolinkHeadings, { behavior: "wrap" }]],
  },
  build: {},
  integrations: [
    configSchema(),
    solidJs(),
    starlight({
      title: "OpenCode",
      defaultLocale: "root",
      locales: {
        root: {
          label: "English",
          lang: "en",
          dir: "ltr",
        },
        ar: {
          label: "العربية",
          lang: "ar",
          dir: "rtl",
        },
        bs: {
          label: "Bosanski",
          lang: "bs-BA",
          dir: "ltr",
        },
        da: {
          label: "Dansk",
          lang: "da-DK",
          dir: "ltr",
        },
        de: {
          label: "Deutsch",
          lang: "de-DE",
          dir: "ltr",
        },
        es: {
          label: "Espa\u00f1ol",
          lang: "es-ES",
          dir: "ltr",
        },
        fr: {
          label: "Fran\u00e7ais",
          lang: "fr-FR",
          dir: "ltr",
        },
        it: {
          label: "Italiano",
          lang: "it-IT",
          dir: "ltr",
        },
        ja: {
          label: "日本語",
          lang: "ja-JP",
          dir: "ltr",
        },
        ko: {
          label: "한국어",
          lang: "ko-KR",
          dir: "ltr",
        },
        nb: {
          label: "Norsk Bokm\u00e5l",
          lang: "nb-NO",
          dir: "ltr",
        },
        pl: {
          label: "Polski",
          lang: "pl-PL",
          dir: "ltr",
        },
        "pt-br": {
          label: "Portugu\u00eas (Brasil)",
          lang: "pt-BR",
          dir: "ltr",
        },
        ru: {
          label: "Русский",
          lang: "ru-RU",
          dir: "ltr",
        },
        th: {
          label: "ไทย",
          lang: "th-TH",
          dir: "ltr",
        },
        tr: {
          label: "T\u00fcrk\u00e7e",
          lang: "tr-TR",
          dir: "ltr",
        },
        "zh-cn": {
          label: "简体中文",
          lang: "zh-CN",
          dir: "ltr",
        },
        "zh-tw": {
          label: "繁體中文",
          lang: "zh-TW",
          dir: "ltr",
        },
      },
      favicon: "/favicon-v3.svg",
      head: [
        {
          tag: "link",
          attrs: {
            rel: "icon",
            href: "/favicon-v3.ico",
            sizes: "32x32",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "icon",
            type: "image/png",
            href: "/favicon-96x96-v3.png",
            sizes: "96x96",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "apple-touch-icon",
            href: "/apple-touch-icon-v3.png",
            sizes: "180x180",
          },
        },
      ],
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
      sidebar: [
        "",
        "config",
        "providers",
        "network",
        "enterprise",
        "troubleshooting",
        {
          label: "Windows",
          translations: {
            en: "Windows",
            ar: "Windows",
            "bs-BA": "Windows",
            "da-DK": "Windows",
            "de-DE": "Windows",
            "es-ES": "Windows",
            "fr-FR": "Windows",
            "it-IT": "Windows",
            "ja-JP": "Windows",
            "ko-KR": "Windows",
            "nb-NO": "Windows",
            "pl-PL": "Windows",
            "pt-BR": "Windows",
            "ru-RU": "Windows",
            "th-TH": "Windows",
            "tr-TR": "Windows",
            "zh-CN": "Windows",
            "zh-TW": "Windows",
          },
          link: "windows-wsl",
        },
        {
          label: "Usage",
          translations: {
            en: "Usage",
            ar: "الاستخدام",
            "bs-BA": "Korištenje",
            "da-DK": "Brug",
            "de-DE": "Nutzung",
            "es-ES": "Uso",
            "fr-FR": "Utilisation",
            "it-IT": "Utilizzo",
            "ja-JP": "使い方",
            "ko-KR": "사용",
            "nb-NO": "Bruk",
            "pl-PL": "Użycie",
            "pt-BR": "Uso",
            "ru-RU": "Использование",
            "th-TH": "การใช้งาน",
            "tr-TR": "Kullanım",
            "zh-CN": "使用",
            "zh-TW": "使用",
          },
          items: ["go", "tui", "cli", "web", "ide", "zen", "share", "github", "gitlab"],
        },

        {
          label: "Configure",
          translations: {
            en: "Configure",
            ar: "الإعداد",
            "bs-BA": "Podešavanje",
            "da-DK": "Konfiguration",
            "de-DE": "Konfiguration",
            "es-ES": "Configuración",
            "fr-FR": "Configuration",
            "it-IT": "Configurazione",
            "ja-JP": "設定",
            "ko-KR": "구성",
            "nb-NO": "Konfigurasjon",
            "pl-PL": "Konfiguracja",
            "pt-BR": "Configuração",
            "ru-RU": "Настройка",
            "th-TH": "การกำหนดค่า",
            "tr-TR": "Yapılandırma",
            "zh-CN": "配置",
            "zh-TW": "設定",
          },
          items: [
            "tools",
            "rules",
            "agents",
            "models",
            "themes",
            "keybinds",
            "commands",
            "formatters",
            "permissions",
            "lsp",
            "mcp-servers",
            "acp",
            "skills",
            "custom-tools",
          ],
        },

        {
          label: "Develop",
          translations: {
            en: "Develop",
            ar: "التطوير",
            "bs-BA": "Razvoj",
            "da-DK": "Udvikling",
            "de-DE": "Entwicklung",
            "es-ES": "Desarrollo",
            "fr-FR": "Développement",
            "it-IT": "Sviluppo",
            "ja-JP": "開発",
            "ko-KR": "개발",
            "nb-NO": "Utvikling",
            "pl-PL": "Rozwój",
            "pt-BR": "Desenvolvimento",
            "ru-RU": "Разработка",
            "th-TH": "การพัฒนา",
            "tr-TR": "Geliştirme",
            "zh-CN": "开发",
            "zh-TW": "開發",
          },
          items: ["sdk", "server", "plugins", "ecosystem"],
        },
      ],
      components: {
        Hero: "./src/components/Hero.astro",
        Head: "./src/components/Head.astro",
        Header: "./src/components/Header.astro",
        Footer: "./src/components/Footer.astro",
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
        spawnSync("../opencode/script/schema.ts", ["./dist/config.json", "./dist/tui.json"])
      },
    },
  }
}
