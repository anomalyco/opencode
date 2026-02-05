export const dict = {
  "nav.github": "GitHub",
  "nav.docs": "Docs",
  "nav.changelog": "Changelog",
  "nav.discord": "Discord",
  "nav.x": "X",
  "nav.enterprise": "Enterprise",
  "nav.zen": "Zen",
  "nav.login": "Login",
  "nav.free": "Free",
  "nav.home": "Home",
  "nav.openMenu": "Open menu",
  "nav.getStartedFree": "Get started for free",

  "nav.context.copyLogo": "Copy logo as SVG",
  "nav.context.copyWordmark": "Copy wordmark as SVG",
  "nav.context.brandAssets": "Brand assets",

  "footer.github": "GitHub",
  "footer.docs": "Docs",
  "footer.changelog": "Changelog",
  "footer.discord": "Discord",
  "footer.x": "X",

  "legal.brand": "Brand",
  "legal.privacy": "Privacy",
  "legal.terms": "Terms",

  "email.title": "Be the first to know when we release new products",
  "email.subtitle": "Join the waitlist for early access.",
  "email.placeholder": "Email address",
  "email.subscribe": "Subscribe",
  "email.success": "Almost done, check your inbox and confirm your email address",

  "notFound.title": "Not Found | opencode",
  "notFound.heading": "404 - Page Not Found",
  "notFound.home": "Home",
  "notFound.docs": "Docs",
  "notFound.github": "GitHub",
  "notFound.discord": "Discord",

  "user.logout": "Logout",

  "workspace.select": "Select workspace",
  "workspace.createNew": "+ Create New Workspace",
  "workspace.modal.title": "Create New Workspace",
  "workspace.modal.placeholder": "Enter workspace name",

  "common.cancel": "Cancel",
  "common.creating": "Creating...",
  "common.create": "Create",

  "enterprise.title": "OpenCode | Enterprise solutions for your organisation",
  "enterprise.meta.description": "Contact OpenCode for enterprise solutions",
  "enterprise.hero.title": "Your code is yours",
  "enterprise.hero.body1":
    "OpenCode operates securely inside your organization with no data or context stored and no licensing restrictions or ownership claims. Start a trial with your team, then deploy it across your organization by integrating it with your SSO and internal AI gateway.",
  "enterprise.hero.body2": "Let us know how we can help.",
  "enterprise.form.name.label": "Full name",
  "enterprise.form.name.placeholder": "Jeff Bezos",
  "enterprise.form.role.label": "Role",
  "enterprise.form.role.placeholder": "Executive Chairman",
  "enterprise.form.email.label": "Company email",
  "enterprise.form.email.placeholder": "jeff@amazon.com",
  "enterprise.form.message.label": "What problem are you trying to solve?",
  "enterprise.form.message.placeholder": "We need help with...",
  "enterprise.form.send": "Send",
  "enterprise.form.sending": "Sending...",
  "enterprise.form.success": "Message sent, we'll be in touch soon.",
  "enterprise.faq.title": "FAQ",
  "enterprise.faq.q1": "What is OpenCode Enterprise?",
  "enterprise.faq.a1":
    "OpenCode Enterprise is for organizations that want to ensure that their code and data never leaves their infrastructure. It can do this by using a centralized config that integrates with your SSO and internal AI gateway.",
  "enterprise.faq.q2": "How do I get started with OpenCode Enterprise?",
  "enterprise.faq.a2":
    "Simply start with an internal trial with your team. OpenCode by default does not store your code or context data, making it easy to get started. Then contact us to discuss pricing and implementation options.",
  "enterprise.faq.q3": "How does enterprise pricing work?",
  "enterprise.faq.a3":
    "We offer per-seat enterprise pricing. If you have your own LLM gateway, we do not charge for tokens used. For further details, contact us for a custom quote based on your organization's needs.",
  "enterprise.faq.q4": "Is my data secure with OpenCode Enterprise?",
  "enterprise.faq.a4":
    "Yes. OpenCode does not store your code or context data. All processing happens locally or through direct API calls to your AI provider. With central config and SSO integration, your data remains secure within your organization's infrastructure.",

  "brand.title": "OpenCode | Brand",
  "brand.meta.description": "OpenCode brand guidelines",
  "brand.heading": "Brand guidelines",
  "brand.subtitle": "Resources and assets to help you work with the OpenCode brand.",
  "brand.downloadAll": "Download all assets",

  "changelog.title": "OpenCode | Changelog",
  "changelog.meta.description": "OpenCode release notes and changelog",
  "changelog.hero.title": "Changelog",
  "changelog.hero.subtitle": "New updates and improvements to OpenCode",
  "changelog.empty": "No changelog entries found.",
  "changelog.viewJson": "View JSON",
} as const

export type Key = keyof typeof dict
export type Dict = Record<Key, string>
