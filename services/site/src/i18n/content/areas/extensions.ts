import { extensionPages, type ExtensionSlug } from "~/component/site/extension-data"

/** The extension pages' English copy, by extension. */
export const extensionsSource = Object.fromEntries(
  extensionPages.map((extension) => [
    extension.slug,
    {
      name: extension.name,
      body: extension.body,
      title: extension.title,
      description: extension.description,
      intro: extension.intro,
      features: extension.features.map((feature) => ({ title: feature.title, body: feature.body })),
      install: extension.install.lead,
    },
  ]),
) as Record<
  ExtensionSlug,
  {
    name: string
    body: string
    title: string
    description: string
    intro: string
    features: { title: string; body: string }[]
    install: string
  }
>
