---
feat-id: mac-pack-installer-and-gitee-rename
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# mac-pack-installer-and-gitee-rename — spec

## 一句话

Mac 端 ship 流程文档化收口 `pack-installer.sh` 唯一入口(已存在,但 5.11.1 首发误绕过)+ Gitee 镜像仓 2026-05-11 改名 `opencode-for-office-deskfox` → `deskfox` 对齐 GitHub。补传新名 .dmg + 切换 git remote + 改 legal docs URL 引用 + 5.11.1 release 迁移到新 Gitee 仓。

## 起源

### 1. Mac 5.11.1 ship .dmg 文件名不符规范

[`[macOS] 2026.5.11.1`](../../installer-versions.md#macos-2026511) 首发时,我**直接调 `build-deskfox.sh -Env prod`**,绕过了 `pack-installer.sh`,导致 Tauri 默认出的 `DeskFox_1.14.33_aarch64.dmg`(下划线 + Tauri 内部版本)上传到 GitHub + Gitee,**跟 Win 端 `DeskFox-2026.5.11.1-setup.exe`(横线 + ship 版本)命名约定不一致**。

实际**`pack-installer.sh` 已经存在**且 rename 逻辑正确(line 73-94),只是没作为 ship 流程必走入口收口。

### 2. Gitee 仓改名

`gitee.com/zoulukuang/opencode-for-office-deskfox` → `gitee.com/zoulukuang/deskfox`(对齐 GitHub `zoulukuang/deskfox`,2026-05-03 GitHub 改名 / 2026-05-11 Gitee 跟上)。`mirror-asset-to-gitee.sh` 默认 `--gitee-repo deskfox` 已对齐新名,只需后续 ship 用默认参数即可(本次 5.11.1 ship 误用 `--gitee-repo opencode-for-office-deskfox` override,带来后续重传修补)。

## 范围

### A. 修补 5.11.1 ship

1. 本地 rename `DeskFox_1.14.33_aarch64.dmg` → `DeskFox-2026.5.11.1_aarch64.dmg`(对齐 Win 命名)
2. GitHub:删旧 asset → 上传新名 asset(同一 release)
3. Gitee 老仓:删 release(id=680256)
4. Gitee 新仓:创 release(id=680262)+ 上传新名 .dmg
5. 本机 `git remote set-url gitee git@gitee.com:zoulukuang/deskfox.git`

### B. 文档化 Mac ship 流程 SOP

`pack-installer.sh` 是 Mac ship 的**唯一入口**,以后再 ship 必须走这个脚本(不能直接调 `build-deskfox.sh -Env prod`),理由:
- 自动 bump installer-versions.json
- 自动 build .app + .dmg
- 自动 cp raw → .app/Contents/MacOS/(memory pitfall 兜底)
- **自动 rename .dmg 对齐 Win 命名**

类似 Win 端 `pack-installer.ps1` 是 Win ship 唯一入口。

### C. 更新文档引用 Gitee URL

| 文件 | 改动 |
|---|---|
| `docs/legal/隐私协议.md` | 3 处 Gitee URL(顶部仓库 / 附录链接表 / 反馈 issues) |
| `docs/legal/PRIVACY.md` | 同上(英文版)|
| memory `reference_push_remotes.md` | gitee remote URL + remote add 示例 |
| memory `MEMORY.md` | 项目信息一行 |

历史 changelog / feat 三文档(`改动日志.md` / `docs/features/{repo-migration,user-rename,release-自动化,macos-打包}/`)**不动** — 那些是当时事实,改了反而失真。

## 验收

- ✅ GitHub release asset = `DeskFox-2026.5.11.1_aarch64.dmg`(单一名)
- ✅ Gitee 新仓 `zoulukuang/deskfox` 有 5.11.1 release + asset
- ✅ Gitee 老仓 `opencode-for-office-deskfox` 没有 5.11.1 release(已删)
- ✅ `git remote -v` gitee 指向新仓
- ✅ legal docs 用户可见的 Gitee URL 全改新名
- ✅ 下次 ship 用默认参数 `mirror-asset-to-gitee.sh ship-mac-prod-<VER>` 直接走新仓

## 不做

- 历史 feat docs / changelog 里的老仓名引用 — 保留不改(历史事实)
- Win 端 ps1 mirror 脚本不动(默认已是 `deskfox`)
- 老仓 `opencode-for-office-deskfox` 是否 archive — user 后续自己决定(Gitee 后台动作)

## 规模

Medium — 1 个 SOP 文档化(`pack-installer.sh` 已存在不动)+ 3 个本机 ship 操作(rename + 重传 GitHub + 重传 Gitee)+ Gitee 改名 docs URL 同步(legal docs + memory)+ 三文档落盘。
