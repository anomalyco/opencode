/** SolidStart's route manifest: one entry per route file, with its path (for example `/changelog/:tag`). */
declare module "solid-start:routes" {
  const routes: { path: string; page?: boolean }[]
  export default routes
}

/** The client build's Vite manifest, read by the server (empty on the development server). */
declare module "solid-start:client-vite-manifest" {
  export const clientViteManifest: Record<string, { file: string; imports?: string[] }>
}
