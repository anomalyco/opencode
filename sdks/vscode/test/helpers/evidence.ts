import { promises as fsp } from 'fs'
import fs from 'fs'
import path from 'path'

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export async function initRunDir(base = 'test-results') {
  const runDir = path.join(process.cwd(), base, `run-${safeTimestamp()}`)
  await fsp.mkdir(runDir, { recursive: true })
  return runDir
}

async function copyDir(src: string, dest: string) {
  try {
    const entries = await fsp.readdir(src, { withFileTypes: true })
    await fsp.mkdir(dest, { recursive: true })
    for (const ent of entries) {
      const srcPath = path.join(src, ent.name)
      const destPath = path.join(dest, ent.name)
      if (ent.isDirectory()) {
        await copyDir(srcPath, destPath)
      } else {
        await fsp.copyFile(srcPath, destPath)
      }
    }
  } catch (err) {
    // ignore errors
  }
}

export async function captureFailure(test: any, err: any, runDir?: string) {
  try {
    const run = runDir || path.join(process.cwd(), 'test-results', `run-${safeTimestamp()}`)
    await fsp.mkdir(run, { recursive: true })
    const title = typeof test.fullTitle === 'function' ? test.fullTitle() : test.title || 'unknown_test'
    const safeName = title.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 200)
    const out = path.join(run, safeName)
    await fsp.mkdir(out, { recursive: true })

    const errorText = err && (err.stack || err.message || String(err)) || 'no error object'
    await fsp.writeFile(path.join(out, 'error.txt'), String(errorText), 'utf8')

    // extension logs buffer populated by bootstrap
    try {
      // @ts-ignore
      const logs = (global as any).__EXT_LOGS__ || []
      await fsp.writeFile(path.join(out, 'extension-logs.txt'), logs.join('\n'), 'utf8')
    } catch (e) {}

    // capture editor content if vscode available
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const vscode = require('vscode')
      const editor = vscode.window.activeTextEditor
      if (editor) {
        const text = editor.document.getText()
        await fsp.writeFile(path.join(out, 'editor.txt'), text, 'utf8')
      }
    } catch (e) {}

    // copy mochawesome outputs if present in test-results dir
    try {
      const reportDir = path.join(process.cwd(), 'test-results')
      await copyDir(reportDir, path.join(out, 'mochawesome'))
    } catch (e) {}

    // capture Playwright page screenshot if available
    try {
      // @ts-ignore
      const page = (global as any).page
      if (page && typeof page.screenshot === 'function') {
        const png = path.join(out, 'screenshot.png')
        await page.screenshot({ path: png })
      }
    } catch (e) {}

  } catch (outerErr) {
    try {
      await fsp.writeFile(path.join(process.cwd(), 'test-results', `capture-error-${safeTimestamp()}.txt`), String(outerErr), 'utf8')
    } catch (e) {}
  }
}
