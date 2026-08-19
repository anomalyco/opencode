declare module "x11" {
  const x11: {
    createClient(cb: (err: Error | null, display: unknown) => void): void
  }
  export default x11
}
