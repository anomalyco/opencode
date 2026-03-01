import type { Dict } from "./en"
import { dict as en } from "./en"

export const dict = {
  ...en,
  "nav.docs": "Dokumentacioni",
  "nav.changelog": "Ndryshimet",
  "nav.enterprise": "Enterprise",
  "nav.login": "Hyr",
  "nav.free": "Falas",
  "nav.home": "Kreu",
  "nav.openMenu": "Hap menunë",
  "nav.getStartedFree": "Fillo falas",

  "footer.docs": "Dokumentacioni",
  "footer.changelog": "Ndryshimet",

  "legal.privacy": "Privatësia",
  "legal.terms": "Kushtet",

  "email.placeholder": "Adresa e email-it",
  "email.subscribe": "Abonohu",

  "notFound.heading": "404 - Faqja nuk u gjet",
  "notFound.home": "Kreu",
  "notFound.docs": "Dokumentacioni",

  "user.logout": "Dil",

  "workspace.select": "Zgjidh workspace",
  "workspace.createNew": "+ Krijo workspace të ri",
  "workspace.modal.title": "Krijo workspace të ri",
  "workspace.modal.placeholder": "Shkruaj emrin e workspace",

  "common.cancel": "Anulo",
  "common.creating": "Duke krijuar...",
  "common.create": "Krijo",
  "common.learnMore": "Mëso më shumë",

  "error.workspaceRequired": "ID e workspace është e detyrueshme",
  "error.workspaceNameRequired": "Emri i workspace është i detyrueshëm.",
  "error.emailRequired": "Email-i është i detyrueshëm",
  "error.nameRequired": "Emri është i detyrueshëm",
  "error.apiKeyRequired": "Çelësi API është i detyrueshëm",

  "app.meta.description": "OpenCode - Agjenti open source për kodim.",

  "home.title": "OpenCode | Agjenti open source për kodim me AI",
  "home.hero.title": "Agjenti open source për kodim me AI",
  "home.hero.subtitle.a": "Përdor modelet falas ose lidh çdo model nga çdo ofrues,",
  "home.hero.subtitle.b": "përfshirë Claude, GPT, Gemini dhe më shumë.",
  "home.what.title": "Çfarë është OpenCode?",
  "home.what.readDocs": "Lexo dokumentacionin",

  "download.title": "OpenCode | Shkarko",
  "download.hero.title": "Shkarko OpenCode",
  "download.action.download": "Shkarko",
  "download.action.install": "Instalo",

  "changelog.hero.title": "Ndryshimet",
  "changelog.empty": "Nuk u gjetën hyrje në changelog.",
} satisfies Dict
