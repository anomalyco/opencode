# 与上游 anomalyco/opencode 合并 SOP

> **目的**:让 fork(DeskFox)能持续吃 anomalyco/opencode 的更新,且每次合并风险可控、自动化护栏到位、回退路径明确。
> **配套文档**:
> - [改动规则.md](./改动规则.md) — 白黑名单 / hook / FORK marker 体系
> - [fork-跟随升级与协作规范.md](./fork-跟随升级与协作规范.md) — R1-R4 / P1-P5 / 健康指标(治理总纲)
> - [跨平台协作.md](./跨平台协作.md) — 三端环境(目前已收口 Windows)

---

## 1. fork-only 路径白名单(merge 0 冲突区)

这些路径 **上游不存在**,fork 怎么改怎么加,与 upstream merge 时**永远不会冲突**:

| 路径 | 用途 | 维护原则 |
|---|---|---|
| `docs/` | 所有 fork 文档(本文档所在) | 自由加,但分类清晰(features / governance / history) |
| `packages/branding/` | DeskFox 品牌注入(icon / 主题色 / installer) | 全 fork-only,改了不需要 FORK marker |
| `改动日志.md`(根) | feature commit 索引 | 每 feature 一行,详细在 docs/features/ |
| `.husky/`(部分钩子)+ `scripts/install-hooks.sh` | fork-only pre-commit 护栏 | 注意上游也用 husky,要 review 是否有冲突 |
| `.gitattributes` / `.editorconfig`(自加部分)| 跨平台一致性 | 上游也有这些文件,merge 时 review diff |

**规则**:新功能优先放 fork-only 路径(R1 三级跳第 1 级)。

## 2. 上游路径上的 fork 改动 — 必有 FORK marker

任何动了 anomalyco/opencode 既有文件的 commit,必须遵循:

- **R2** — 单点改 `// FORK: <reason> <YYYY-MM-DD>`,多行改 `// FORK-BEGIN: <reason>` ... `// FORK-END`
- **R3** — 三类 hardcode 禁令(品牌字符串 / 主题色 / icon 资源)走 fork 路径,不直接改上游
- **R4** — 黑名单文件改动需 override 流程(见 改动规则.md)

**为什么重要**:merge 上游时,如果 conflict 出现在带 FORK marker 的位置,你能立刻识别"这是我们的 fork 改动,需要保留";没 marker 的话,人脑很难分辨上游新引入和我们改动。

## 3. Merge 前 — checklist

```bash
# 在 D:\project\opencode-fork
cd D:\project\opencode-fork

# 3.1 确保工作树干净
git status   # 应为 clean

# 3.2 确保所有 fork commit 已 push 到 origin(双端备份)
git fetch origin
git log origin/$(git rev-parse --abbrev-ref HEAD)..HEAD   # 应为空

# 3.3 打 baseline tag(出问题能 reset --hard 回这里)
git tag pre-rebase-$(Get-Date -Format yyyy-MM-dd)
git push origin --tags

# 3.4 看上游有多少新 commit
git fetch upstream
git log --oneline upstream/dev ^HEAD | wc -l   # 漂移指标:这数字代表要吃多少改动

# 3.5 列改动文件,提前看哪些会 conflict
git diff --name-only HEAD...upstream/dev | grep -v "^docs/\|^packages/branding/\|^改动日志.md"
# 上面这些路径 fork-only 不会冲突,只看其余的
```

**红线**:如果 3.5 列出的文件包含本仓有 FORK marker 的(grep `// FORK:` / `// FORK-BEGIN:`),提前知道这些是高风险冲突点,merge 时重点关注。

## 4. Merge 操作 — rebase vs merge

| 场景 | 选 | 理由 |
|---|---|---|
| dev 跟 upstream/dev 漂移 < 50 commit,fork 改动小 | **rebase** | 保线性历史,fork commit 在最上层一目了然 |
| 漂移 ≥ 100 commit 或 fork 改动深(改了 ≥10 个上游文件)| **merge** | rebase 会把每个 fork commit 重新 apply,冲突放大;merge 一次性解决 |
| 紧急安全更新,只想抓特定 commit | **cherry-pick** | 不全量同步,只挑这 1-2 个 |

### 4.1 rebase 流程(默认)

```bash
git fetch upstream
git checkout main
git rebase upstream/dev    # 注:本仓主分支是 main,上游 anomalyco/opencode 主分支仍是 dev

# 冲突时:
#   优先级:① 上游新增的 → 接收 ② fork 改动(带 FORK marker)→ 保留 ③ 都改了同一行 → 手解
#   解决后:git add . && git rebase --continue
#   实在解不动:git rebase --abort,退回原点重新规划
```

### 4.2 merge 流程

```bash
git fetch upstream
git checkout main
git merge upstream/dev --no-ff    # 注:本仓主分支是 main,上游主分支是 dev
# 冲突解法同上,但是一次性面对所有冲突
git commit
```

### 4.3 conflict 解决三原则

1. **不要为了消除 conflict 删 FORK marker** — 那等于丢 fork 功能
2. **不要把 fork 改动当上游覆盖掉** — `git checkout --theirs` 慎用,会把 fork commit 全干掉
3. **拿不准的 conflict 留着,跑测试再判断** — `bun run typecheck` + DeskFox release build 测试一遍

### 4.4 现场冲突分类 playbook(2026-05-03 实战补充)

> 2026-05-02 上游 sync 实战(尝试 merge upstream/dev 417 commit,5 个冲突文件)摸到的 5 类典型冲突,各配解法。
> 这一节的目的:下次 merge 不需要从头摸索,按类型对号入座。

#### 类型 1:`bun.lock`(机械,几乎每次 merge 都有)

- 直接重生成:`bun install`,push 前比对 catalog 版本
- **不要手解** — lockfile 几千行,手解必错

#### 类型 2:`package.json` 双 dep 加(机械)

- 两侧各加了不同 dep,撞在同一 alphabet 位置
- **解法**:两个都保留,按字母序排好(或照原文件实际顺序;有的 package.json 不严格 alpha)
- ⚠️ 副作用警示:**接受 upstream 新 dep 等于接受其代码引用进树**,如果上游是引入像 `@sentry/solid` 这种 telemetry 性质的依赖,merge 落地后 grep 一下 import 出现位置,决定是用还是 stub 掉(可能产出 follow-up feature 修)

#### 类型 3:import path 改(机械,但要看上游意图)

- 例:`@opencode-ai/shared/util/path` → `@opencode-ai/core/util/path`(2026-05 上游把 `packages/shared` 整个改名为 `packages/core`)
- **解法**:**跟上游 rename**(原 path 已不存在,坚持等于 build 立即挂)
- **例外**:fork-only import(像 `@opencode-ai/branding/logo`,DeskFox 自家品牌)保留我们的写法

#### 类型 4:策略路线分歧(语义,最常见的"要决策")

上游和我们对**同一功能**采用不同实现路线。需要评估"上游路线是否更通用",通用就接上游 + 改 fork callers 适配;不通用则坚持我们的并加 / 更新 FORK marker。

| 已知典型 | fork 路线 | 上游路线 | 默认建议 |
|---|---|---|---|
| 禁升级(`UPDATER_ENABLED` flag)| 方法**不暴露**(`...(UPDATER_ENABLED ? { checkUpdate } : {})`),callers 用 `if (!platform.checkUpdate) return` 短路 + UI 用 `disabled={!platform.checkUpdate}` 灰显 | 方法**始终暴露**,内部 `if (!UPDATER_ENABLED) return early`,update 改名 `updateAndRestart` | **保留 fork**(2026-05-03 试过接上游 sentinel pattern 撞 UX bug,见下方 ⚠️;rename 是 one-time 留给 merge 自然 take) |
| 品牌 logo(`Mark` 组件)| `import { Mark } from "@opencode-ai/branding/logo"`(fork-only branding 包) | `import { Mark } from "@opencode-ai/ui/logo"` | **保留 fork**(DeskFox 品牌,不能跟上游) |
| claude-code plugin prompt loop | fork 改了 step-finish part 兜底(R4 override case 1) | 上游可能后续也动这块 | **看上游是否真解决了 root cause**,是则可以接上游退掉我们的 override;否则保留 |

⚠️ 不要"两边都保留" — 同一功能两套实现 = 死代码 + 行为不一致 + 后续 merge 还冲突。

⚠️ **教训(2026-05-03 updater-disable-adapter 翻车)**:不要把"backend 短路"和"frontend disable signal"当成两个独立轴去解耦。fork 原 `禁自动升级` 设计用 `platform.checkUpdate=undefined` 同时表达 ① backend 不工作 ② frontend 控件应 disable —— 两个意思耦合在 method 存在性上。试图换 sentinel pattern(method 永远存在 + 内部短路)= 切断 frontend signal,导致 controls 全部变可点 + "立即检查" 按钮发"已是最新版本" 假 toast。**判断准则**:任何"adapter prep" 改动前,先 grep 是否有 `disabled={!platform.<method>}` / `if (!platform.<method>)` 之类依赖 method 存在性的 callsite —— 有的话,改 method 暴露策略就会破坏 UI 信号。原结构如果**同时承担多重信号**,不要轻率"对齐上游 pattern"。

#### 类型 5:同 schema 双改(语义,最棘手)

上游迁了底层(如 Zod → Effect Schema),我们又给 schema 加了字段,撞死。

- **典型**:`packages/opencode/src/file/index.ts` 的 `Content.encoding` enum
  - 上游:`Schema.optional(Schema.Literal("base64"))`(Effect Schema 改写)
  - 我们:`z.enum(["base64", "office-pdf-ref"]).optional()`(office-installer-macos feature)

- **解法 — 接受上游骨架 + fork 字段补回 + FORK marker**:
  ```ts
  // 解后:
  encoding: Schema.optional(Schema.Literals(["base64", "office-pdf-ref"])),
  // FORK: office-installer-macos 增 PDF-ref encoding,fetch 走专用 endpoint 2026-05-XX
  ```

- **长期治理(R1 三级跳第 1 步)**:把 fork 对上游 schema 的字段补充外移到 fork-only 文件,用 **TS module augmentation** 或 **runtime 约定**(类型层面 `Content & { encoding?: "office-pdf-ref" }`,schema 检验在 fork-only 包装函数里),消除这类冲突永不复发。当某个字段补充开始**反复 merge 冲突**(如 `office-pdf-ref` 两次以上 merge 都冲突),就开 single-feature 把它外移。

### 4.5 关键工具:`effect-zod` adapter

上游 2026-04 起把核心 schema(`Content` / `Info` / `Auth.Info` / `message-v2.*` 等)从 Zod 迁到 Effect Schema,**但同时保留了 Zod 接口**,通过 `packages/opencode/src/util/effect-zod.ts`(329 行)的 `zod()` 转换器:

```ts
// 上游模式:
const _Content = Schema.Struct({...})
export const Content = Object.assign(_Content, { zod: zod(_Content) })
// 或更新模式(用 withStatics):
export const Content = Schema.Struct({...}).pipe(withStatics((s) => ({ zod: zod(s) })))
```

**对 fork 的意义**:
- fork 老 callers 写 `Content.parse(x)` 不再有效(Effect Schema 没 `.parse`),改 `Content.zod.parse(x)` 即可
- `Content.zod.safeParse(x)` / `Content.zod.shape` 同理
- merge 落地后 grep 一遍 `Content\.parse|Content\.safeParse|Content\.shape` 找出全部点,统一改 `.zod` 访问
- **fork 自己的 Zod schema 一行不用动** — adapter 已让两套语法共存,fork 内部 Zod 写法完全合法

### 4.6 整体推进顺序(实战 SOP)

```
1. fetch upstream + 打 pre-rebase tag(必做,见 §3)
2. checkout dev + git merge upstream/dev --no-commit  ← 不要立即 commit,先看 conflict
3. 解类型 1(bun.lock)— **不要删 lock 重 install**,见 §4.7
4. 解类型 2/3(机械)— 几分钟内搞定
5. 类型 4 一个个评估 — 拿不准就停下问 user(典型对照表见 §4.4)
6. 类型 5 一个个解 — 接受上游骨架 + fork 字段补回 + 加/更新 FORK marker
7. 检查 .zod 访问改写(类型 5 之后必跟):grep `Content.parse` 等改 `.zod.parse`
8. typecheck:bun run typecheck(必清 *.tsbuildinfo + .ts-dist + .turbo/cache 后重跑,避免增量缓存假装通过 — 详见 features/post-sync-build-fix/3-changelog.md)
9. release build:.\packages\branding\scripts\build-deskfox.ps1 -Env dev -NoBundle 端到端通
10. 8 + 9 全过 → git commit merge → §5 后续 checklist
11. 任何一步炸 → git reset --hard pre-rebase-<日期>(或 merge 阶段炸用 git merge --abort),退回出发点重新规划
```

### 4.7 bun.lock 处理方法学(2026-05-03 实战补充)

**别删 lock 重 install** —— 删了之后 `bun install` 会让所有 `*` / `^x.y.z` 风格的版本约束自由 resolve 到最新,可能撞坏依赖(2026-05-03 sync 在 `poe-oauth: *` 上踩到 → 自动升 `0.0.7` → 带坏的 `mcp-oauth@1.0.0` → bun module 加载 SyntaxError 阻断 SDK regen)。

**正确做法**:

```bash
# 选 A:take 上游 bun.lock 当起点(推荐 — 跟上游对齐最稳)
git checkout --theirs bun.lock
bun install                     # 增量 reconcile,只对齐 fork 私有 deps

# 选 B:take fork bun.lock,只增量上游新加的 deps
git checkout --ours bun.lock
bun install                     # 增量

# 选 C(慎用):删 lock 全 reresolve
rm bun.lock && bun install      # 仅在 A/B 都炸时退而求其次
```

**判定**:choose A 当上游版本没动太多关键 deps;choose B 当 fork 自己锁了关键版本(rare);choose C 当 lock 文件本身坏掉 / format 不兼容。

> ⚠️ 推荐顺序 A > B > C。**永远不要 C 后不验证 module 加载**(像 mcp-oauth 这种没 export 的 bug 静默无声,直到 SDK regen 才爆)。

## 5. Merge 后 — checklist

> **同样适用于 `git merge --abort` 之后**:任何动过 catalog 依赖版本的 sync 操作,abort 回 main 时**必跑** 5.0,否则 node_modules 跟 lock 不对齐导致 typecheck 假错(详见 §7 第 3 行)。

```bash
# 5.0 reconcile node_modules 跟 lock(merge 完成 OR abort 后都要)
bun install

# 5.1 typecheck 全量过
bun run typecheck

# 5.2 build 一个 release exe 看能不能起
.\packages\branding\scripts\build-deskfox.ps1 -Env prod -NoBundle
# DeskFox.exe 起得来,核心功能(file viewer / chat)能用

# 5.3 重打 installer 看 icon 是否正确
& "C:\ProgramData\chocolatey\bin\ISCC.exe" "D:\project\opencode-fork\packages\branding\installer\DeskFox.iss"
# 装一次看快捷方式 icon 对不对(详见 features/installer-打包/3-changelog.md 的 Windows iconcache 处理)

# 5.4 打新 baseline tag
git tag upstream-baseline-$(Get-Date -Format yyyy-MM-dd)
git push origin --tags

# 5.5 算健康指标(详见 fork-跟随升级与协作规范.md "健康指标")
#   - 上游侵入率:< 5%(改上游文件数 / 总文件数)
#   - 漂移 commit 数:dev..upstream/dev,目标 ≤ 100
#   - override 累计:每季 ≤ 2 笔
```

**全过 → push**:

```bash
git push origin main
```

**有问题** → reset 到 pre-rebase tag,排查后重来:

```bash
git reset --hard pre-rebase-<日期>
```

## 6. 自动化辅助(待实现 / 部分实现)

| 工具 | 状态 | 用途 |
|---|---|---|
| `scripts/install-hooks.sh` | ✅ 已实现 | 装 pre-commit 护栏(白名单 + diff 阈值 + 大小写) |
| FORK marker 检测 hook | 待加 | pre-commit 时若改了上游文件且没 FORK marker 报警 |
| `scripts/fork-health.sh` | 待加 | 一键算上游侵入率 / 漂移 / override 三项指标 |
| `scripts/check-merge-readiness.sh` | 待加 | 跑本文档第 3 节的 checklist |

写到上面 governance/ 文档就是为了**这些脚本 future 实现时,行为契约已经定好**。

## 7. 常见踩坑

| 现象 | 根因 | 解 |
|---|---|---|
| rebase 中途退出导致工作树半残 | rebase 冲突没解完 / `git stash` 忘 pop | `git rebase --abort` 回到 rebase 前;若已 commit,reset 到 pre-rebase-tag |
| merge 后 typecheck 大量错 | 上游重构了 API,fork 引用过时 | 不要硬删 fork 代码;按上游新 API 适配,保留 fork 行为(可能要更新 FORK marker 的 reason) |
| **`merge --abort` 后 typecheck 突然几百错** | **sync 分支 install 升过依赖版本(catalog),abort 后 git checkout 回 lock,但 node_modules symlinks 物理状态没 rollback,同一个 codebase 看到两份不同版本的 effect/library** | **`bun install` 一次,bun 检测到 symlinks 跟 lock 不一致会重新对齐;再跑 typecheck 验证 0 错。2026-05-03 dev-typecheck-fix 验证过(555 错 → 0 错,无代码改动)** |
| **删 bun.lock 重 install 后 SDK regen 神秘报 module 加载错** | **`*` / `^x.y.z` 风格的依赖约束自由 resolve 到最新,可能拉到带 bug 的 transitive dep(2026-05-03 `poe-oauth: *` 自动升到 0.0.7 → 带坏的 `mcp-oauth@1.0.0` → "Export named 'X' not found"阻断 SDK 生成)** | **不要删 lock,take 任一边 lock 再 `bun install` 增量更新。详 §4.7。已踩坑必看** |
| **`OPENCODE_SDK_OPENAPI=httpapi`(默认)生成的 SDK 缺 fork 的 Hono routes** | **上游 `--httpapi` 走 Effect HttpApi 的 PublicApi,fork 用 Hono 加的 routes(/file/office-pdf 等)不在 PublicApi 里 → SDK 缺这些 method** | **要么把 fork routes 迁到 PublicApi(参 features/office-routes-effect-httpapi/),要么 fork build 改用 `OPENCODE_SDK_OPENAPI=hono`(但会丢上游 Effect-only 的新 type 如 SessionMessageData) → 双轨互斥,只能选一边** |
| installer build 失败 | 上游改了 tauri 配置 / 依赖,品牌注入路径漂了 | 看 packages/branding/scripts/build-deskfox.ps1 + tauri-overrides;必要时同步更新 override |
| 桌面快捷方式 icon 还是老的 | Windows iconcache 卡 | 见 features/installer-打包/3-changelog.md 弯路 5(也存为 memory) |
| main 分支 push 拒收(non-fast-forward)| 双端 origin 一端有 force push 历史不一致 | `git push origin main --force-with-lease`(谨慎);先 ls-remote 对比两端 HEAD |

## 8. 何时 NOT 合并上游

不是每次都要追:

- **上游正在大重构**(refactor 多个核心模块):等他们落地稳定再吃,避免追上一半要回滚
- **本 fork 在 active feature 开发中**(有未完成 feature 分支):先收口现有 feature,merge 的 conflict 风险小
- **上游引入 breaking change**(API / 配置):评估对 fork 改动的级联影响,可能要先适配 fork 再吃

**判断标准**:`git log upstream/dev ^HEAD --oneline` 看新 commit 描述,若全是修补类(fix / chore / docs)且不动核心,放心吃;若大量 feat / refactor 且涉及 packages/desktop 等核心,先 review 再决定。

---

## TL;DR(给自己 / future agent)

1. 把 fork-only 内容**全放** `docs/` + `packages/branding/` + 改动日志.md(0 冲突)
2. 改上游文件**必有** FORK marker(冲突时一眼能辨)
3. Merge 前**必打** `pre-rebase-<日期>` tag(出问题能回)
4. Merge 操作时**先 `--no-commit`**,按 §4.4 五类对号入座解冲突,§4.6 顺序推进
5. Merge 后(**或 abort 后**)**必跑** `bun install` reconcile node_modules → typecheck(清缓存,避免增量假通过)→ release build → installer 重打验证
6. 漂移 / 侵入 / override 三指标定期算,异常先治后吃
7. **bun.lock 别删!** 解 lock 冲突走 `git checkout --theirs/--ours bun.lock && bun install`,详 §4.7。直接 `rm bun.lock` 会让 `*` deps 自由乱升撞坑
8. **fork 加 Hono route 是技术债** —— 上游 SDK 默认走 `--httpapi`,Hono routes 不进 PublicApi → SDK 缺 method。新 fork 后端 route **必须**进 PublicApi(参 features/office-routes-effect-httpapi/)
