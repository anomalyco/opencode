#!/usr/bin/env node
const { spawnSync } = require('child_process')
const opts = { stdio: 'inherit', shell: true }
console.log('Running build...')
let r = spawnSync('pnpm -C packages/opendeepseek run build', opts)
if (r.status !== 0) process.exit(r.status)
console.log('Running quick import check (tsx --help)...')
r = spawnSync('pnpm -C packages/opendeepseek exec -- npx tsx --conditions=browser src/index.ts --help', opts)
process.exit(r.status)
