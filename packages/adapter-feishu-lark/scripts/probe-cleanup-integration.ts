// [fork-only] 集成探针 — 在真 tmp 文件系统上跑 applyStaleSessionsCleanup 三种路径,
// 不动 user 真实 ~/.opencode。验证 C5(首装)/ C7(幂等)。
// 用法:bun run packages/adapter-feishu-lark/scripts/probe-cleanup-integration.ts

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyStaleSessionsCleanup } from "../src/plugin"

const tmp = mkdtempSync(join(tmpdir(), "cleanup-probe-"))
const marker = join(tmp, ".imbot-workspace-rename-cleanup-applied")
const store = join(tmp, "feishu-chat-sessions.json")

const log = {
  info: (m: string) => console.log(`  [info] ${m}`),
  warn: (m: string) => console.warn(`  [warn] ${m}`),
}

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}${detail ? "  " + detail : ""}`)
    pass++
  } else {
    console.log(`  ✗ ${name}${detail ? "  " + detail : ""}`)
    fail++
  }
}

try {
  // ===== C5 首装路径 =====
  console.log("\n[C5 首装] 空目录(无 marker / 无 chatStore)")
  check("起始:marker 不存在", !existsSync(marker))
  check("起始:chatStore 不存在", !existsSync(store))

  const r1 = applyStaleSessionsCleanup(
    marker,
    store,
    { existsSync, unlinkSync, writeFileSync },
    log,
  )
  check("返回值 = noop-no-sessions", r1 === "noop-no-sessions", `(got "${r1}")`)
  check("marker 已写入", existsSync(marker))
  check("chatStore 未被创建", !existsSync(store))
  const m1 = JSON.parse(readFileSync(marker, "utf-8"))
  check(
    'marker 内容 feat = "imbot-workspace-rename"',
    m1.feat === "imbot-workspace-rename",
    `(got "${m1.feat}")`,
  )
  check(
    "marker appliedAt 是 ISO 字符串",
    typeof m1.appliedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(m1.appliedAt),
    `(got "${m1.appliedAt}")`,
  )

  // ===== C7 幂等路径(第二次 init,marker 已存在) =====
  console.log("\n[C7 幂等] marker 已存在,模拟二次 init")
  const markerMtimeBefore = statSync(marker).mtimeMs
  // 故意造一个 stale chatStore,看 helper 会不会去碰它(不该碰)
  writeFileSync(store, JSON.stringify({ should: "not be touched" }), "utf-8")
  check("起始:marker 存在", existsSync(marker))
  check("起始:chatStore 存在(自造)", existsSync(store))

  const r2 = applyStaleSessionsCleanup(
    marker,
    store,
    { existsSync, unlinkSync, writeFileSync },
    log,
  )
  check("返回值 = noop-already-applied", r2 === "noop-already-applied", `(got "${r2}")`)
  check("chatStore 没被删(idempotency 兜住)", existsSync(store))
  check(
    "marker mtime 未变(没重写)",
    statSync(marker).mtimeMs === markerMtimeBefore,
    `(before=${markerMtimeBefore} after=${statSync(marker).mtimeMs})`,
  )

  // ===== bonus:升级路径(C6 已 user 实测过,这里再补一遍证明环境一致) =====
  console.log("\n[bonus C6 升级] 删 marker 留 chatStore,再跑")
  unlinkSync(marker)
  check("起始:marker 已删", !existsSync(marker))
  check("起始:chatStore 仍存在", existsSync(store))

  const r3 = applyStaleSessionsCleanup(
    marker,
    store,
    { existsSync, unlinkSync, writeFileSync },
    log,
  )
  check("返回值 = applied", r3 === "applied", `(got "${r3}")`)
  check("chatStore 被清", !existsSync(store))
  check("marker 重新创建", existsSync(marker))
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n===== ${pass} 项通过 / ${fail} 项失败 =====`)
process.exit(fail === 0 ? 0 : 1)
