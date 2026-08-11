declare module "virtual:opencode-app-assets" {
  const assets: Readonly<
    Record<string, { readonly content: string; readonly encoding: "utf8" | "base64" }>
  >
  export default assets
}
