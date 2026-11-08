import type { LegalNode } from "~/lib/legal"

/**
 * A plain-language summary for the top of each legal document, by its path: up to five points, each
 * a restatement of what the document itself says with a link to the section that says it. Nothing
 * here adds to or changes the documents; the full text applies. Kept out of the document files so
 * the documents' version history only tracks the legal text.
 */
export const legalSummaries: Record<string, LegalNode[][]> = {
  "/legal/privacy-policy": [
    [
      "It covers the hosted Services. Open source software you run yourself is governed by its own license. ",
      ["a", { href: "#what-this-privacy-policy-covers" }, "Scope"],
    ],
    [
      "We collect profile and contact data, payment data, device and IP data, and information you choose to provide, such as prompts you submit to AI. ",
      ["a", { href: "#categories-of-personal-data" }, "What we collect"],
    ],
    [
      "Prompts are passed through to the upstream model provider to provide the services and are not stored. ",
      ["a", { href: "#categories-of-personal-data" }, "What we collect"],
    ],
    [
      "We have not sold or shared your Personal Data in the last 12 months. ",
      ["a", { href: "#california-resident-rights-personal-data-sales-opt-out" }, "Sales opt-out"],
    ],
    [
      "Depending on where you live, you can ask to access, correct or delete your data. Send requests to help@anoma.ly. ",
      ["a", { href: "#exercising-your-rights" }, "Exercising your rights"],
    ],
  ],
  "/legal/terms-of-service": [
    [
      "These Terms cover the website, the inference product and the hosted software. Open source software you run yourself is governed by its own license.",
    ],
    ["You keep ownership of your Input and you own the Output. ", ["a", { href: "#your-ip" }, "Your IP"]],
    [
      "We use Content to provide the Services, comply with the law, enforce our terms and keep the Services safe. On an unpaid account, we may also use it to develop and improve the Services. We never use Content obtained or derived from a Connected Service for that. ",
      ["a", { href: "#your-ip" }, "Your IP"],
    ],
    [
      "With Third Party Models, the model provider's retention policies apply to your Content. ",
      ["a", { href: "#what-about-third-party-models" }, "Third Party Models"],
    ],
    [
      "Disputes go to binding individual arbitration, with no class actions. You can opt out by mail within 30 days. ",
      ["a", { href: "#arbitration-agreement" }, "Arbitration"],
    ],
  ],
}
