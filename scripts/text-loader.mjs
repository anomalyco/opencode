import fs from 'fs/promises'
import path from 'path'

const TEXT_EXTS = new Set(['.txt', '.scm', '.css', '.svg', '.frag', '.vert', '.html', '.md', '.markdown', '.toml'])

export async function resolve(specifier, context, defaultResolve) {
  // Resolve normally first
  try {
    const res = await defaultResolve(specifier, context, defaultResolve)
    if (res && TEXT_EXTS.has(path.extname(res.url))) return res
    return res
  } catch (e) {
    // Fallback: if specifier itself has a text extension, resolve relative to parent
    const parent = context.parentURL || `file://${process.cwd()}/`
    if (/(?:\.txt|\.scm|\.css|\.svg|\.frag|\.vert|\.html|\.md|\.markdown|\.toml)$/i.test(specifier)) {
      const resolved = new URL(specifier, parent).href
      return { url: resolved }
    }
    throw e
  }
}

export async function load(url, context, defaultLoad) {
  const ext = path.extname(url).toLowerCase()
  if (TEXT_EXTS.has(ext)) {
    const content = await fs.readFile(new URL(url), 'utf8')
    const src = `export default ${JSON.stringify(content)};` + '\n'
    return { format: 'module', source: src }
  }
  // For unknown binary-ish assets, return base64 string
  if (/\.(wasm|bin)$/i.test(ext)) {
    const buf = await fs.readFile(new URL(url))
    const b64 = Buffer.from(buf).toString('base64')
    const src = `export default ${JSON.stringify(b64)};` + '\n'
    return { format: 'module', source: src }
  }
  return defaultLoad(url, context, defaultLoad)
}
