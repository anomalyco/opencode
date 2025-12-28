export const $ = (...args) => {
  if ((globalThis).Bun && (globalThis).Bun.$) return (globalThis).Bun.$(...args)
  throw new Error('Bun API not available: $')
}

export const readableStreamToText = async (stream) => {
  if ((globalThis).Bun && (globalThis).Bun.readableStreamToText) return (globalThis).Bun.readableStreamToText(stream)
  // fallback for Node readable stream
  if (!stream) return ''
  const chunks = []
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? chunk : chunk.toString())
  return chunks.join('')
}

export const spawn = (...args) => {
  if ((globalThis).Bun && (globalThis).Bun.spawn) return (globalThis).Bun.spawn(...args)
  // fallback to child_process.spawnSync-like wrapper
  const cp = require('child_process')
  return cp.spawnSync(...args)
}

export const file = (p) => {
  if ((globalThis).Bun && (globalThis).Bun.file) return (globalThis).Bun.file(p)
  // Minimal file-like fallback
  const fs = require('fs')
  return {
    text: async () => fs.promises.readFile(p, 'utf8'),
    json: async () => JSON.parse(await fs.promises.readFile(p, 'utf8')),
    exists: async () => !!(await fs.promises.stat(p).catch(()=>false)),
  }
}
