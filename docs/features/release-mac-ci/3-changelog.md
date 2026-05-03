---
feat-id: release-mac-ci
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# release-mac-ci — Changelog

> 实施日期:2026-05-02 起 → 2026-05-03 rebase 到新 dev 完成
> 本笔特点:**纯新增 fork-only 文件**(不改任何上游),Medium 规模。

---

## 一、commit / tag 一览

| # | commit | 主题 | 行数 | 状态 |
|---|---|---|---|---|
| 1 | `3c7877225` | docs(release-mac-ci): 三文档 + INDEX + 改动日志索引(顺带清 docs/installer-versions.md 老 CRLF 漂移)| 357 | ✅ |
| 2 | `9a80c7dc9` | feat(release): macOS .dmg CI workflow — release-mac-deskfox.yml | 215 | ✅ |
| 3 | (本笔补全)| 回填 commit hash + status: done + 验证清单状态更新 | ~30 | ⏳ |

> 注:第 1 笔起源于 `9f6c4ac11`(原 commit),rebase 到新 dev 时把"chore(crlf)"那一笔(`33b772582`,1 行 CRLF fix)被 git auto-drop("patch contents already upstream"),CRLF 改动并入此笔,故 +357 含 1 行 CRLF fix。

---

## 二、影响范围

### 新增文件

| 文件 | 行数 | 说明 |
|---|---|---|
| `.github/workflows/release-mac-deskfox.yml` | ~190 | mac CI 主体(对照 release-deskfox.yml) |
| `docs/features/release-mac-ci/1-spec.md` | ~135 | spec(决策表 + 改动范围 + 风险) |
| `docs/features/release-mac-ci/2-plan.md` | ~75 | 实施计划 + 决策轨迹 |
| `docs/features/release-mac-ci/3-changelog.md` | ~80 | 本文档 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `docs/features/INDEX.md` | 加一行 `release-mac-ci` |
| `改动日志.md` | 加索引行 |
| `docs/installer-versions.md` | 1 行去孤立 CR — Win 端 bump 脚本未走 .gitattributes eol=lf 留下的历史漂移,顺手清掉(rebase 时 git auto-drop 那笔 chore commit 后并入此笔)|

### 不改的(明确)

- `release-deskfox.yml`(Win)— 不动,新文件独立
- `bump-installer-version.sh` / `build-deskfox.sh` / `pack-installer.sh` — 已 work,不改
- 任何 `packages/desktop/` / `packages/branding/src/` 资源 — 0 改

### 上游侵入率影响

- 新增 fork-only 文件:4 个(workflow yml + 三文档)
- 修改 fork-only 文件:3 个(2 个索引 + CRLF 顺手清)
- 改上游文件:**0 个**
- → 上游侵入率不变,健康

---

## 三、回归测试

### 本地已验

| 测试项 | 命令 / 操作 | 结果 |
|---|---|---|
| 本地 build dev 跑通 | `bash packages/branding/scripts/build-deskfox.sh -Env dev` | ✅ 23.55s(cache 命中),产物 .app + .dmg + raw binary 全到位 |
| .dmg 产物路径 | `target/release/bundle/dmg/DeskFox Dev_1.14.21_aarch64.dmg` | ✅ 存在,workflow 内 rename 步骤会再处理成 `DeskFox Dev-<version>_aarch64.dmg` |
| pre-commit hook | 两笔 commit 时跑 | ✅ 白名单 / diff 阈值 / 大小写 三项全过 |
| rebase 到新 dev | `git rebase dev`(dev 推进 474 笔 / upstream merge)| ✅ resolve 2 文件冲突(INDEX / 改动日志),chore-crlf 自动 dropped |
| user 实测 .dmg | open .dmg → 拖 Applications → 右键打开 | ✅ |

### 待 push 后 GitHub Actions 上验

| 测试项 | 操作 | 结果 |
|---|---|---|
| yaml 语法 | push 后 GitHub Actions 拉 workflow 时自动校验 | ⏳ |
| dispatch dev 模式 | Actions UI → Run workflow → env=dev | ⏳ |
| dispatch artifact | 30 天保留期内有 `deskfox-mac-dev-<v>_aarch64.dmg` | ⏳ |
| .dmg 文件名 rename 正确 | workflow 内 rename step log:`<old> → DeskFox Dev-<v>_aarch64.dmg` | ⏳ |
| dispatch 不发 Release | Releases 页面无新 entry | ⏳ |
| tag 模式发 draft Release | push `ship-mac-prod-<v>` → 自动出 draft | ⏳ |

**结论**:本地保证 build 链路通,workflow yml 是对照已落地的 win 版抄的,CI 端跑通信心高;`⏳` 项要等 push + dispatch 才能正式打勾。

---

## 四、回退方法

### 整笔回滚

```bash
git revert <commit-hash>   # 撤本笔主体 commit
```

revert 后:workflow 文件没了,push tag `ship-mac-*` 也不会触发任何东西(workflow 已删)— 安全无副作用,Win workflow 不受影响。

### 单次 release 失败

- workflow 跑挂 → 看 Actions log 排查,修后重新触发
- draft Release 出错 → GitHub UI 删 draft + 删对应 tag,本地修后重发 tag

### 不需要回退的场景

- dispatch 模式产物不满意 → 直接重跑,artifact 30 天保留期内自动覆盖

---

## 五、未结尾巴(转交后续)

| 事项 | 性质 | 状态 |
|---|---|---|
| push origin → GitHub Actions 自跑 dispatch dev 测试 | 验证 | ⏳(user 决定 push 时机)|
| 首发 `ship-mac-prod-<v>` 出第一个 mac dmg | 真实 ship | ⏳ |
| universal binary(arm64 + x86_64)| 未来扩展 | 延后(spec 第六节)|
| 签名 / notarize | 未来扩展 | 延后(spec 第六节)|
| 统一 `ship-prod-*` 同时出 win + mac | 未来扩展 | 延后(spec 第六节)|

---

## 六、重大经验

1. **rebase 时 git 自动 drop "patch contents already upstream" 很省事**:CRLF chore commit 单独立笔后,rebase 第一笔冲突 resolve 时把 dirty add 进 cherry-pick,后续 chore commit 自动检测为重复改动 dropped。无需 `--skip` 手动操作,无需 `-i` 交互。
2. **`.gitattributes eol=lf` 不强制 checkout 时转换工作区行尾**:macOS git 默认 `core.autocrlf` 不设时,index 里有 CRLF 的 blob 会原样 checkout 出来到工作树。结果工作树永久 dirty,直到显式 `add --renormalize`。**Win 端 PowerShell 写文件应显式 `-Encoding utf8NoBOM` 配 `[System.Text.Encoding]::UTF8` LF + 配套 git 端 `core.autocrlf=input`** — 本笔顺手修了 1 行,但 Win 端 bump 脚本根治留作 backlog(未来再引入新 CRLF 漂移时单独立 chore feature)。
3. **workflow 文件命名要先 grep hook 豁免规则再下笔**:本笔起初命名 `release-deskfox-mac.yml`,与 hook 豁免 `^\.github/workflows/.*-deskfox\.yml$` 不匹配(末尾不是 `-deskfox.yml`),要 commit 时才发现得改名 `release-mac-deskfox.yml`(把 `-deskfox` 后缀放最后)。一开始就核对豁免规则能省一轮重命名 + 文档同步。
