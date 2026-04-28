# 与上游 sst/opencode 合并 SOP

> **目的**:让 fork(DeskFox)能持续吃 sst/opencode 的更新,且每次合并风险可控、自动化护栏到位、回退路径明确。
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

任何动了 sst/opencode 既有文件的 commit,必须遵循:

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
git checkout dev
git rebase upstream/dev

# 冲突时:
#   优先级:① 上游新增的 → 接收 ② fork 改动(带 FORK marker)→ 保留 ③ 都改了同一行 → 手解
#   解决后:git add . && git rebase --continue
#   实在解不动:git rebase --abort,退回原点重新规划
```

### 4.2 merge 流程

```bash
git fetch upstream
git checkout dev
git merge upstream/dev --no-ff
# 冲突解法同上,但是一次性面对所有冲突
git commit
```

### 4.3 conflict 解决三原则

1. **不要为了消除 conflict 删 FORK marker** — 那等于丢 fork 功能
2. **不要把 fork 改动当上游覆盖掉** — `git checkout --theirs` 慎用,会把 fork commit 全干掉
3. **拿不准的 conflict 留着,跑测试再判断** — `bun run typecheck` + DeskFox release build 测试一遍

## 5. Merge 后 — checklist

```bash
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
git push origin dev
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
| installer build 失败 | 上游改了 tauri 配置 / 依赖,品牌注入路径漂了 | 看 packages/branding/scripts/build-deskfox.ps1 + tauri-overrides;必要时同步更新 override |
| 桌面快捷方式 icon 还是老的 | Windows iconcache 卡 | 见 features/installer-打包/3-changelog.md 弯路 5(也存为 memory) |
| dev 分支 push 拒收(non-fast-forward)| 双端 origin 一端有 force push 历史不一致 | `git push origin dev --force-with-lease`(谨慎);先 ls-remote 对比两端 HEAD |

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
4. Merge 后**必跑** typecheck + release build + installer 重打验证
5. 漂移 / 侵入 / override 三指标定期算,异常先治后吃
