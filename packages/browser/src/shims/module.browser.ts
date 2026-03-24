type BrowserRequire = ((specifier: string) => never) & {
  resolve(specifier: string): never
}

function createThrowingRequire(base?: string): BrowserRequire {
  const require = ((specifier: string) => {
    throw new Error(`Cannot require ${specifier} from ${base ?? "browser"} in browser mode`)
  }) as BrowserRequire

  require.resolve = (specifier: string) => {
    throw new Error(`Cannot resolve ${specifier} from ${base ?? "browser"} in browser mode`)
  }

  return require
}

export function createRequire(base: string | URL): BrowserRequire {
  return createThrowingRequire(String(base))
}

export default {
  createRequire,
}
