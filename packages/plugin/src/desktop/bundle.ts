export function evaluateBundle(source: string, modules: ReadonlyMap<string, unknown>): unknown {
  const module = { exports: {} as unknown }
  // Installed extensions are trusted code. Supplying the host modules keeps Solid
  // contexts and shared controls identical to those used by the application.
  new Function("require", "module", "exports", source)(
    (id: string) => {
      if (!modules.has(id)) throw new Error(`Unsupported desktop extension import: ${id}`)
      return modules.get(id)
    },
    module,
    module.exports,
  )
  return module.exports
}
