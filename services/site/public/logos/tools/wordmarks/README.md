# Tool wordmarks

One-colour copies of each product's full logo (mark and wordmark) for the "Tool tiles: logo" setting
in the home page's "Bring your own tools" section. Every file is one black fill with knockouts as
transparent holes, and its `viewBox` is cropped to the ink, so it works as a CSS mask. After you add
or change a file, run `bun script/measure-logos.ts` from `packages/console/app` to update
`src/component/site/logo-metrics.ts`.

| File         | Source                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| github.svg   | https://brand.github.com/foundations/logo (GitHub_Logos.zip, SVG/GitHub_Lockup_Black.svg)               |
| linear.svg   | https://linear.app/brand (Linear-Brand-Assets.zip, wordmark-dark.svg; same file as ../../companies)     |
| figma.svg    | https://www.figma.com/using-the-figma-brand/ (the "Figma" wordmark SVG inlined on the page)             |
| sentry.svg   | https://sentry.io/branding/ (the logo and wordmark SVG inlined on the page)                             |
| notion.svg   | https://www.notion.com/ (the header logo SVG; the white page fill removed, so the outline and N remain) |
| slack.svg    | https://svgl.app/library/slack-wordmark.svg (the four colours merged into one fill)                     |
| supabase.svg | https://svgl.app/library/supabase_wordmark_light.svg (gradient and shading layer merged into one fill)  |
| stripe.svg   | https://svgl.app/library/stripe_wordmark.svg                                                            |
