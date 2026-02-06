export type SecurityRegistrar = {
  use: (middleware: unknown) => SecurityRegistrar
}

export function registerSecurity<T extends SecurityRegistrar>(app: T): T {
  return app
}
