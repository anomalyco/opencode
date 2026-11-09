/** SolidStart's route manifest: one entry per route file, with its path (for example `/changelog/:tag`). */
declare module "solid-start:routes" {
  const routes: { path: string; page?: boolean }[]
  export default routes
}
