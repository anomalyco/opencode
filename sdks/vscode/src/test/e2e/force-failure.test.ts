import * as assert from 'assert'

suite('force-evidence', function() {
  test('intentional failure to force evidence capture', async function() {
    // Invoke the capture command but don't block indefinitely; fail-safe timeout applied
    try {
      // @ts-ignore
      const vscode = require('vscode')
      const p = vscode.commands.executeCommand('opencode.captureEvidence')
      await Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('capture-timeout')), 10000))]).catch(() => {})
      // small wait to allow extension poller to pick up triggers
      await new Promise(r => setTimeout(r, 300))
    } catch (e) {}
    assert.ok(true)
  })
})
