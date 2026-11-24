import { docsUrl } from "~/lib/docs"
import { config } from "~/config"
import type { Translate } from "~/i18n"
import { rich } from "~/i18n/rich"
import type { RichText } from "~/lib/markdown"

/**
 * The FAQ in the product pages' download section (lib/download-content.ts). A module of its own, so
 * the download section, on every page, doesn't take the home page copy with it.
 */
export function homeFaq(t: Translate, route: (path: string) => string) {
  const docs = (path: string) => `https://opencode.ai${docsUrl(path)}`
  return {
    title: t("common.faq"),
    items: [
      {
        question: t("home.faq.q1"),
        answer: [t("home.faq.a1.body")],
      },
      {
        question: t("home.faq.q2"),
        answer: [`${t("home.faq.a2.before")} `, { text: t("home.faq.a2.link"), href: docs("/") }, "."],
      },
      {
        question: t("home.faq.q3"),
        answer: rich(
          `${t("home.faq.a3.p1")} ${t("home.faq.a3.p4.beforeLocal")} ${t("home.faq.a3.providers")} ${t("home.faq.a3.models.after")}`,
          { local: docs("/models/#local"), models: "https://opencode.ai/console/models" },
        ),
      },
      {
        question: t("home.faq.q4"),
        answer: [`${t("home.faq.a4.p1")} `, { text: t("common.learnMore"), href: docs("/providers/") }, "."],
      },
      {
        question: t("home.faq.q5"),
        answer: rich(t("home.faq.a5.body"), {
          desktop: route("/desktop"),
          mobile: route("/mobile"),
          sdk: route("/sdk"),
        }),
      },
      { question: t("home.faq.q6"), answer: [t("home.faq.a6")] },
      {
        question: t("home.faq.q7"),
        answer: [
          `${t("home.faq.a7.p1")} ${t("home.faq.a7.p2.beforeModels")} `,
          { text: t("home.faq.a7.p2.modelsLink"), href: docs("/console/models/#privacy") },
          ".",
        ],
      },
      {
        question: t("home.faq.q8"),
        answer: [
          `${t("home.faq.a8.p1")} `,
          { text: t("nav.github"), href: config.github.repoUrl, external: true },
          ` ${t("home.faq.a8.p2")} `,
          {
            text: t("home.faq.a8.mitLicense"),
            href: `${config.github.repoUrl}?tab=MIT-1-ov-file#readme`,
            external: true,
          },
          t("home.faq.a8.p3"),
        ],
      },
    ] satisfies { question: string; answer: RichText }[],
  }
}
