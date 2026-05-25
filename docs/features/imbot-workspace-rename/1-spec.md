---
feat-id: imbot-workspace-rename
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# imbot-workspace-rename — 1-spec(需求 + 验收 + 测试用例)

## 背景

ADR `OPENCODE-PLAN/架构决策/im桥接-imbot单一架构.md` §一明说"所有 IM 桥接 plugin 共享同一个固定 home base workspace",但当前路径名 **`~/.opencode/feishu-workspace/`** 暗示飞书专属。

未来 telegram / 钉钉 / 微信 plugin 加入时:
- 共享一个叫 `feishu-workspace` 的目录**语义错乱**
- 任何 cross-IM 文档(如 imbot-定制指南)解释起来都要绕弯
- "imbot 是跨 IM 共享的 agent" 跟"它住在 feishu-workspace 里"是矛盾的

**timing 论证**:DeskFox prod 用户数 ≈ 0(基本就 doc 作者一人 + 1-2 测试),现在改 migration 损失低;未来 prod 用户多了再改,migration 风险大。

## 改名提案

`~/.opencode/feishu-workspace/` → **`~/.opencode/imbot-workspace/`**

理由:
- `imbot` 是这个 workspace 的**逻辑所有者**(运行在这里的 agent)
- 跟架构 ADR "唯一 imbot agent" 语义一致
- 比 `im-workspace` / `messaging-workspace` 更精确(workspace 是给 imbot 用的)
- 跟 `<workspace>/.opencode/agent/imbot.md` 文件路径形成视觉呼应

代码常量同步:
- `FEISHU_WORKSPACE` → `IMBOT_WORKSPACE`(`plugin.ts` / `message-pipeline.ts`)
- `FEISHU_WORKSPACE_ROOT` → `IMBOT_WORKSPACE_ROOT`(`reply-actions.ts`,ATTACH 路径白名单)

## 区分:哪些 feishu-* 路径**不改**(保留)

| 路径 | 是否 IM 共享 | 处置 |
|---|---|---|
| `~/.opencode/feishu-workspace/` | 共享(架构 home base) | **改 imbot-workspace** |
| `~/.opencode/feishu-config.json` | feishu-specific 账号凭证 | 保留 |
| `~/.opencode/feishu-chat-sessions.json` | feishu-specific per-account chat→session 映射 | 保留 |
| `~/.opencode/feishu-plugin-server.json` | feishu-specific plugin local server | 保留 |
| `~/.opencode/feishu-wss-dedup.json` | feishu-specific WSS dedup cache | 保留 |

→ 未来 telegram plugin 会创建 `telegram-config.json` / `telegram-chat-sessions.json` 等(IM-specific 各自管),但**共用同一个 `imbot-workspace/`** home base。

## 用户视角

### 新装用户(初次安装 DeskFox)

启动 → plugin 自动创建 `~/.opencode/imbot-workspace/` → 0 感知

### 升级用户(本次 ship 升级前已用 feishu-workspace)

启动 → plugin detect 老路径 `~/.opencode/feishu-workspace/` 存在 + 新路径不存在 → **自动 `mv` 迁移**(包含 `.opencode/agent/imbot.md` 等定制文件)→ log "[feishu-plugin] migrated legacy workspace path" → 0 感知

### 已有手动配置的高级用户

如果 user 手动改了 `~/.opencode/feishu-config.json` 里某个字段指向老路径(罕见但可能),user 自己改回新路径或 plugin 不动那个 user 配置。本 feat 不主动改 user JSON。

## 验收标准

### 功能

1. ✅ **常量改名** + 路径默认值改:
   - `plugin.ts`:`FEISHU_WORKSPACE` → `IMBOT_WORKSPACE`,值 `~/.opencode/imbot-workspace`
   - `message-pipeline.ts`:同上
   - `reply-actions.ts`:`FEISHU_WORKSPACE_ROOT` → `IMBOT_WORKSPACE_ROOT`,同路径

2. ✅ **migration helper**(`plugin.ts` 内新加 `migrateLegacyWorkspace()` pure-ish 函数,helper extract):
   - 输入:两个路径字符串(legacy / new)+ logger(可注入)
   - 行为:见下方测试用例
   - 启动时自动调用(`plugin.ts` init 流程)

3. ✅ **回归不破**:
   - 现有 522/522 测试全过(改完后预期 522 + 新加 ~6 case = ~528)
   - typecheck 16/16
   - 既有飞书桥接行为 0 变化(/new / /group / ATTACH 上传 / mention policy 等)

### 数据 / 不回归

4. ✅ user 升级后:
   - 老 `~/.opencode/feishu-workspace/` 不存在了(已被 mv 过去)
   - 新 `~/.opencode/imbot-workspace/` 存在,内含原 home base 所有内容(`.opencode/agent/imbot.md` / user 之前 imbot 创建的文件 / 之前 ATTACH workspace 的图片等)
   - DeskFox 启动日志含 "migrated legacy workspace path"

5. ✅ 其他 feishu-* 路径**0 改动**:`feishu-config.json` / `feishu-chat-sessions.json` 等仍在原位

### 安全

6. ✅ migration 是**单向**(legacy → new),**不双向**;不删 legacy 直到 mv 完成
7. ✅ migration 失败(EACCES / 磁盘满 / 等)→ warn log 不崩 plugin,user 看到日志能自己 mv
8. ✅ 不动 user 手动改的 `.opencode/feishu-config.json` 等配置(避免破坏 user 自定义)

### 测试 / 治理

9. ✅ R5 Medium ≥ 1 e2e ≥ 3 unit:
   - **migration helper**(纯函数,~6 case,详 §测试用例)
   - **常量值正确性**(~2 case)
   - **回归集成**(既有 sniffall pass)
10. ✅ `bun run typecheck` 16/16
11. ✅ 三文档全套 + INDEX + 改动日志 entry

## 测试用例(显式列入 spec,实施后逐一跑过)

### 单元测试:`migrateLegacyWorkspace`(纯函数 helper extract)

签名(预设):

```ts
export function migrateLegacyWorkspace(
  legacyPath: string,
  newPath: string,
  fs: { existsSync(p: string): boolean; renameSync(o: string, n: string): void },
  logger: { info(msg: string): void; warn(msg: string): void },
): "migrated" | "noop-already-new" | "noop-no-legacy" | "skipped-both-exist" | "failed"
```

| # | case | 输入 | 期望 |
|---|---|---|---|
| T1 | **legacy 存在,new 不存在 → mv 成功** | legacy 真目录,new 不存在 | 返 `"migrated"`,renameSync 被调一次(legacy → new),logger.info 含 "migrated legacy workspace" |
| T2 | **legacy 不存在,new 已存在 → no-op** | legacy 不存在,new 真目录 | 返 `"noop-already-new"`,renameSync 0 调用 |
| T3 | **两者都不存在 → no-op**(初次安装)| legacy / new 都不存在 | 返 `"noop-no-legacy"`,renameSync 0 调用 |
| T4 | **两者都存在 → 不动,warn**(罕见,user 自己 mkdir 过 imbot-workspace?)| legacy / new 都真目录 | 返 `"skipped-both-exist"`,renameSync 0 调用,logger.warn 含 "both paths exist" 提示 user 手动检查 |
| T5 | **mv 抛错 → 不崩,warn**(EACCES / disk full)| legacy 真目录,new 不存在,但 renameSync 抛 `EACCES` | 返 `"failed"`,logger.warn 含错误信息,不抛出去 |
| T6 | **legacy 目录含内容也一起 mv**(rename 是 atomic,验证 fs.renameSync 行为)| legacy 真目录,内有子文件 `.opencode/agent/imbot.md` + `test.png` | 返 `"migrated"`,mv 后子文件全部在 new 路径下 |

### 单元测试:常量值

| # | case | 期望 |
|---|---|---|
| T7 | **`IMBOT_WORKSPACE` 值正确** | `IMBOT_WORKSPACE === join(homedir(), ".opencode", "imbot-workspace")` |
| T8 | **`IMBOT_WORKSPACE_ROOT` 值正确(reply-actions)** | 同上 join 路径 |

### 集成测试:既有 message-pipeline 测试更新

| # | case | 改动 |
|---|---|---|
| T9 | 既有 522 测试**全部继续通过** | 测试 fixture 里若用 "feishu-workspace" 字面字符串,改成 tmp dir 命名独立(测试代码用真实 tmp dir 不依赖具体名字)|

### 实测验证(Tier 3 本地)

| # | case | 验证 |
|---|---|---|
| T10 | **fresh install 模拟**(rm 老路径,新路径不存在) | DeskFox 启动 → 创建 `~/.opencode/imbot-workspace/` → 0 报错 |
| T11 | **migration path 模拟**(mkdir 假的老路径 + 内含一个 imbot.md) | DeskFox 启动 → 日志含 "migrated" → 老路径不存在 + 新路径含 imbot.md |
| T12 | **飞书桥接功能不回归** | 启动 + 发飞书消息测 `/new` + `/group <名>` + `[ATTACH:...]` 全套 happy path |

## 非目标(Out of scope)

- ❌ 改其他 `feishu-*` 命名的文件(`feishu-config.json` 等)— 那些是 feishu-specific 真的应该叫 feishu
- ❌ 改历史 changelog 文档里的 `feishu-workspace` 字眼(`docs/features/*/3-changelog.md` 等)— 历史快照保留
- ❌ 实现"per-account workspace"(已经 superseded,见 `im-account-agent-workspace-binding/1-spec.md`)
- ❌ 通用 `~/.opencode/<imname>-config.json` 抽象(每 IM plugin 各管)

## 安全 / 边界

- **跨平台**:`fs.renameSync` 跨 NTFS/APFS 都 atomic(同一文件系统),不需要 cp+rm 兜底
- **`renameSync` 跨文件系统会失败**(罕见,如 `/Users/x/.opencode/` 跟 `/Volumes/External/.opencode/` 不同盘符)→ T5 用例兜底 warn
- **legacy 路径里的 symlink**:如果 user 把 `~/.opencode/feishu-workspace/` 做成 symlink 指向其他位置,`renameSync` 行为是改 symlink 自己的名字(Node fs 默认行为)。不主动 follow,不破坏 user 自定义
- **跨 ship 兼容**:Tier 2 dev ship 一版验证 migration 工作,过了再 Tier 1 prod

## 决策轨迹

- **timing**:user 拍板"现在做"(prod 用户数 ≈ 0,migration 损失最低)
- **命名**:`imbot-workspace`(vs `im-workspace` / `messaging-workspace` / `imbot-home`):跟"single imbot agent"语义一致,跟 `<ws>/.opencode/agent/imbot.md` 视觉呼应
- **migration 范围**:**只迁路径**,user JSON 配置不动
- **failure mode**:**warn + 0 崩溃**,user 看日志自己 mv 兜底
- **不删 legacy**:`renameSync` 是 mv 不是 cp,legacy 自动消失;真要并存(T4 case)就 warn

## 关联

- 上游 ADR:`OPENCODE-PLAN/架构决策/im桥接-imbot单一架构.md`(§一定义 home base 共享,本 feat 实现路径名一致化)
- 配套 user 指南:`docs/governance/imbot-定制指南.md`(改完路径要同步)
- 历史 feat(home base 命名最早出处):`feishu-bridge-light`(2026-05-23,引入 FEISHU_WORKSPACE 常量)
- 触动文件:
  - `packages/adapter-feishu-lark/src/plugin.ts`(常量 + migration init)
  - `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts`(常量 + 9 处引用)
  - `packages/adapter-feishu-lark/src/feishu/reply-actions.ts`(`FEISHU_WORKSPACE_ROOT` 常量 + 2 处)
  - `packages/adapter-feishu-lark/src/core/opencode-client.ts`(注释)
  - 测试:`message-pipeline.test.ts` + `reply-actions.test.ts`
  - active docs:`docs/governance/imbot-定制指南.md` / `CLAUDE.md`(若有引用)/ ADR(OPENCODE-PLAN 仓)
  - active memory:`reference_imbot_agent.md` 等含路径的 memory
- 历史保留:`docs/features/*/` 下的 1-spec/2-plan/3-changelog **不改**(快照)

## 实施后必跑测试清单

实施完成后,以下测试**全部跑过**才能 ship:

| # | 测试 | 命令 |
|---|---|---|
| C1 | typecheck 全 monorepo | `bun run typecheck` → 16/16 |
| C2 | adapter-feishu-lark 全套单元 + 集成 | `cd packages/adapter-feishu-lark && bun test` → 当前 522 + 新加 ~6 = 全 pass 0 fail |
| C3 | T1-T6 migration helper 6 case | 同 C2 包含 |
| C4 | T7-T8 常量值 case | 同 C2 包含 |
| C5 | T9 既有 522 case 不破 | 同 C2 包含 |
| C6 | Tier 3 build 跑通 | `./packages/branding/scripts/build-deskfox.sh -Env dev` 出 .app |
| C7 | T10 fresh install 实测 | `rm -rf ~/.opencode/feishu-workspace ~/.opencode/imbot-workspace` 然后启动 → 验证新路径建出来 |
| C8 | T11 migration 实测 | `mkdir -p ~/.opencode/feishu-workspace/.opencode/agent && echo "test" > ~/.opencode/feishu-workspace/.opencode/agent/imbot.md` 然后启动 → 验证 mv |
| C9 | T12 飞书桥接 happy path 实测 | 启动 + 发飞书消息测 /new + /group + ATTACH(user 操作)|
| C10 | Rust cargo check(改了 Tauri 引用没?预期 0)| `cd packages/desktop/src-tauri && cargo check --release` |

C1-C5 + C10 必须 100% 绿;C6 必须出 .app 不报错;C7-C9 实测让 user 看结果验证。
