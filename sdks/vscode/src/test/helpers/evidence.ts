import { promises as fsp } from 'fs'
import fs from 'fs'
import path from 'path'

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export async function initRunDir(base = 'test-results/artifacts') {
  // ensure run dirs are created under the package root so the extension host can access them
  const pkgRoot = path.resolve(__dirname, '..', '..', '..')
  const runDir = path.join(pkgRoot, base, `run-${safeTimestamp()}`)
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
    // marker to indicate capture started
    try { await fsp.writeFile(path.join(run, 'capture-started.txt'), new Date().toISOString(), 'utf8') } catch (e) {}
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

      // Try to activate this extension so its commands are registered
      try {
        const ext = vscode.extensions.getExtension('sst-dev.opencode')
        if (ext && !ext.isActive) {
          try { await ext.activate() } catch (e) {}
        }
      } catch (e) {}

      // Attempt to use VS Code's capture-related commands if present.
      try {
        const cmds: string[] = await vscode.commands.getCommands(true)
        try { await fsp.writeFile(path.join(out, 'vscode-commands.txt'), cmds.join('\n'), 'utf8') } catch (e) {}
        const captureCmd = cmds.find(c => /screenshot|capture|screencap|captureScreen/i.test(c))
        if (captureCmd) {
          try {
            // some capture commands may open a file or return a uri; record whatever is returned
            const res = await vscode.commands.executeCommand(captureCmd)
            await fsp.writeFile(path.join(out, 'vscode-capture-cmd.txt'), String(res || captureCmd), 'utf8')
            // If command returned a data URL for an image, save it as screenshot.png
            try {
              if (typeof res === 'string' && /^data:image\/(png|jpeg);base64,/.test(res)) {
                const base64 = res.split(',')[1]
                const buf = Buffer.from(base64, 'base64')
                await fsp.writeFile(path.join(out, 'screenshot.png'), buf)
              }
            } catch (e) {
              // ignore write failures
            }
          } catch (e) {
            // attempt well-known command ids, ignore errors
            try { await vscode.commands.executeCommand('workbench.action.captureScreen') } catch (e) {}
            try { await vscode.commands.executeCommand('workbench.action.captureEditor') } catch (e) {}
            try { await vscode.commands.executeCommand('workbench.action.captureScreenshot') } catch (e) {}
          }
        }
      } catch (e) {
        // getCommands may fail in some hosts
      }

      // Try extension-specific capture command as a fallback (opencode.captureEvidence) with retries
      try {
        const maxAttempts = 10
        let attempt = 0
        let got = null
        while (attempt < maxAttempts) {
          try { await fsp.appendFile(path.join(out, `capture-attempt-${attempt}.log`), new Date().toISOString() + "\n", 'utf8') } catch (e) {}
          attempt++
          try {
            // try to activate extension before executing
            try {
              const ext = vscode.extensions.getExtension('sst-dev.opencode')
              if (ext && !ext.isActive) {
                try { await ext.activate() } catch (e) {}
              }
            } catch (e) {}

            // @ts-ignore
            const res2 = await vscode.commands.executeCommand('opencode.captureEvidence')
            try { await fsp.writeFile(path.join(out, `vscode-capture-cmd-opencode-attempt-${attempt}.txt`), String(res2 || 'opencode.captureEvidence'), 'utf8') } catch (e) {}
            try { await fsp.writeFile(path.join(out, `vscode-capture-opencode-raw-attempt-${attempt}.txt`), JSON.stringify(res2), 'utf8') } catch (e) {}
            if (res2) { got = res2; break }
          } catch (e) {
            try { await new Promise(r => setTimeout(r, 500)) } catch (e) {}
          }
        }
        if (got) {
          const res2 = got
          if (typeof res2 === 'string' && /^data:image\/(png|jpeg);base64,/.test(res2)) {
            const base642 = res2.split(',')[1]
            const buf2 = Buffer.from(base642, 'base64')
            await fsp.writeFile(path.join(out, 'screenshot.png'), buf2)
          } else {
            try {
              const maybePath = String(res2)
              if (await (fsp.stat(maybePath).then(() => true).catch(() => false))) {
                await fsp.copyFile(maybePath, path.join(out, 'screenshot.png'))
              }
            } catch (e) {}
          }
        } else {
          try { await fsp.writeFile(path.join(out, 'vscode-capture-opencode-not-found.txt'), 'no-result-after-retries', 'utf8') } catch (e) {}
        }
      } catch (e) {}
    } catch (e) {}

    // copy mochawesome outputs if present in test-results dir
    try {
      const reportDir = path.join(process.cwd(), 'test-results')
      await copyDir(reportDir, path.join(out, 'mochawesome'))
    } catch (e) {}

    // capture Playwright page screenshot if available; otherwise try X11 screenshot tools
    try {
      // @ts-ignore
      const page = (global as any).page
      const png = path.join(out, 'screenshot.png')
      if (page && typeof page.screenshot === 'function') {
        await page.screenshot({ path: png })
      } else {
        // fallback: attempt to take a screenshot of the X display using common tools
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const child_process = require('child_process')
          const { promisify } = require('util')
          const exec = promisify(child_process.exec)
          const display = process.env.DISPLAY || ':0'
          const cmds = [
            `import -display ${display} -window root ${png}`,
            `xwd -root -display ${display} -silent | convert xwd:- png:${png}`,
            `scrot --display ${display} ${png}`,
            `gnome-screenshot -f ${png}`
          ]
          for (const cmd of cmds) {
            try {
              await exec(cmd, { timeout: 5000 })
              if (fs.existsSync(png)) break
            } catch (e) {
              // try next
            }
          }
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {}

    // If no screenshot was produced yet, create a trigger file in the OS tmp dir and in a package-local triggers dir that the extension polls for.
    try {
      const os = require('os')
      const tmpDir = os.tmpdir()
      const pkgRoot = path.resolve(__dirname, '..', '..', '..')
      const localTriggerDir = path.join(pkgRoot, 'test-results', 'triggers')
      try { await fsp.mkdir(localTriggerDir, { recursive: true }) } catch (e) {}
      const png = path.join(out, 'screenshot.png')
      if (!fs.existsSync(png)) {
        const triggerName = `opencode-capture-${safeTimestamp()}.json`
        const triggerPathOs = path.join(tmpDir, triggerName)
        const triggerPathLocal = path.join(localTriggerDir, triggerName)
        const payload = { outPath: png }
        try { await fsp.writeFile(triggerPathOs, JSON.stringify(payload), 'utf8') } catch (e) {}
        try { await fsp.writeFile(triggerPathLocal, JSON.stringify(payload), 'utf8') } catch (e) {}
        try { await fsp.writeFile(path.join(out, 'vscode-capture-trigger.json'), JSON.stringify({ triggerPathOs, triggerPathLocal, payload }), 'utf8') } catch (e) {}
        // wait up to 5s for the extension to produce the png
        const deadline = Date.now() + 10000 // wait up to 10s for extension-produced screenshot
        let produced = false
        while (Date.now() < deadline) {
          if (fs.existsSync(png)) { produced = true; break }
          await new Promise(r => setTimeout(r, 200))
        }
        try { await fsp.writeFile(path.join(out, produced ? 'vscode-capture-produced.txt' : 'vscode-capture-timeout.txt'), produced ? new Date().toISOString() : 'timeout', 'utf8') } catch (e) {}
        // remove triggers if still present
        try { await fsp.unlink(triggerPathOs) } catch (e) {}
        try { await fsp.unlink(triggerPathLocal) } catch (e) {}
      }
    } catch (e) {}

    // mirror artifacts to package-local test-results (best-effort)
    try {
      const pkgRoot = path.resolve(__dirname, '..', '..', '..')
      const mirrorBase = path.join(pkgRoot, 'test-results')
      const mirrorRun = path.join(mirrorBase, path.basename(run))
      await copyDir(run, mirrorRun)
    } catch (e) {
      // ignore mirror failures
    }

  } catch (outerErr) {
    try {
      await fsp.writeFile(path.join(process.cwd(), 'test-results', `capture-error-${safeTimestamp()}.txt`), String(outerErr), 'utf8')
    } catch (e) {}
  }
}
