#!/usr/bin/env bun

/**
 * 验证 Build Studio 的基础设置
 */

import { existsSync } from 'fs'
import { join } from 'path'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const RESET = '\x1b[0m'

const checks = [
  {
    name: '前端文件',
    files: [
      'src/main.tsx',
      'src/App.tsx',
      'src/components/ChatPanel.tsx',
      'src/components/WorkspacePanel.tsx',
      'src/components/ActionsBar.tsx',
    ],
  },
  {
    name: 'Tauri 配置',
    files: [
      'src-tauri/Cargo.toml',
      'src-tauri/tauri.conf.json',
      'src-tauri/src/main.rs',
      'src-tauri/src/workspace_runner.rs',
    ],
  },
  {
    name: '配置文件',
    files: ['package.json', 'vite.config.ts', 'tsconfig.json', 'tailwind.config.js'],
  },
  {
    name: '类型定义',
    files: ['src/types/workspace.ts'],
  },
]

console.log('🔍 验证 Build Studio 基础设置...\n')

let totalChecks = 0
let passedChecks = 0

for (const { name, files } of checks) {
  console.log(`${YELLOW}${name}:${RESET}`)

  for (const file of files) {
    totalChecks++
    const exists = existsSync(join(process.cwd(), file))

    if (exists) {
      console.log(`  ${GREEN}✓${RESET} ${file}`)
      passedChecks++
    } else {
      console.log(`  ${RED}✗${RESET} ${file} (缺失)`)
    }
  }

  console.log('')
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
console.log(`总计: ${passedChecks}/${totalChecks} 通过`)

if (passedChecks === totalChecks) {
  console.log(`${GREEN}✓ 所有文件就位！${RESET}`)
  console.log(`\n下一步:`)
  console.log(`  1. bun install`)
  console.log(`  2. bun run --cwd packages/console tauri dev`)
  process.exit(0)
} else {
  console.log(`${RED}✗ 有文件缺失，请检查！${RESET}`)
  process.exit(1)
}
