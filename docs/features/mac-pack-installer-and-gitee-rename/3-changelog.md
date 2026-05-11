---
feat-id: mac-pack-installer-and-gitee-rename
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# mac-pack-installer-and-gitee-rename — changelog

## 一句话

修补 5.11.1 Mac ship .dmg 文件名(对齐 Win 命名规范)+ Gitee 镜像仓改名 `opencode-for-office-deskfox` → `deskfox` 切换 + `pack-installer.sh` 作为 Mac ship 唯一入口收口。

## commit 列表

| commit | 简述 |
|---|---|
| `72b0325ed` | docs(mac-pack-installer-and-gitee-rename): legal docs Gitee URL 改名 + 三文档落盘 + INDEX + 改动日志 |

## 远端动作(无 commit)

| 动作 | 状态 |
|---|---|
| GitHub release `ship-mac-prod-2026.5.11.1` asset 重命名 | ✅ `DeskFox_1.14.33_aarch64.dmg` 删 → `DeskFox-2026.5.11.1_aarch64.dmg` 重传(64.65 MB) |
| Gitee 老仓 `opencode-for-office-deskfox` release(id=680256)删除 | ✅ HTTP 204 |
| Gitee 新仓 `deskfox` release(id=680262)创建 + asset 上传 | ✅ 9s / 54.81 Mbps |
| 本机 `git remote set-url gitee` → 新仓 | ✅ `git@gitee.com:zoulukuang/deskfox.git` |

## 本地操作

```sh
# Phase 1 rename
mv packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox_1.14.33_aarch64.dmg \
   packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox-2026.5.11.1_aarch64.dmg

# Phase 4 remote 切换
git remote set-url gitee git@gitee.com:zoulukuang/deskfox.git
```

## 改动文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `docs/legal/隐私协议.md` | 3 处 Gitee URL 改名 | 用户可见 — 顶部仓库链接 / 附录链接表 / 反馈 issues |
| `docs/legal/PRIVACY.md` | 3 处 | 同上(英文版)|
| `docs/features/mac-pack-installer-and-gitee-rename/{1-spec,2-plan,3-changelog}.md` | 新 | 三文档 |
| `docs/features/INDEX.md` | 新行 | 索引 |
| `改动日志.md` | 新行 | 改动日志索引表 |

## memory 改动(项目外,不入 git)

| 文件 | 改动 |
|---|---|
| `reference_push_remotes.md` | gitee remote URL 表行 + remote add 示例 → 新仓 `deskfox` |
| `MEMORY.md` | 项目信息一行 fork-from URL → 新仓 `deskfox` |

## pack-installer.sh SOP 收口

发现 `packages/branding/scripts/pack-installer.sh` 早已存在且 rename 逻辑正确(line 73-94):

```sh
# Tauri 出的 .dmg 文件名取自 package.json 的 version(上游 contract,不能改)
# 这里把它 mv 成 installer 版本号命名,与 Win 的 DeskFox-YYYY.M.D.N-setup.exe 对齐
for dmg in "$DMG_DIR"/*.dmg; do
    ...
    new_name="${product_part}-${NEW_VERSION}_${arch_part}.dmg"
    mv "$dmg" "$DMG_DIR/$new_name"
done
```

5.11.1 ship 我直接调 `build-deskfox.sh -Env prod` **绕过了** rename 步骤,导致出错文件名上传 GitHub + Gitee。修补已完成(见上方"远端动作")。

**SOP 固化**:

```sh
# Mac ship 唯一入口(以后再 ship 必走这个,不能直接 build-deskfox.sh -Env prod)
bash packages/branding/scripts/pack-installer.sh -Env prod
# 输出 .dmg:packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox-<VERSION>_aarch64.dmg

# 然后:
gh release create ship-mac-prod-<VERSION> <dmg-path> --repo zoulukuang/deskfox --title "..." --notes-file <body>
bash packages/branding/scripts/mirror-asset-to-gitee.sh ship-mac-prod-<VERSION>  # 默认走新 Gitee 仓 zoulukuang/deskfox
```

## 验证

- ✅ GitHub release asset = `DeskFox-2026.5.11.1_aarch64.dmg`(单一名,64.65 MB)
- ✅ Gitee 新仓 `zoulukuang/deskfox` 有 5.11.1 release + asset
- ✅ Gitee 老仓 5.11.1 release 已删,Gitee 端干净
- ✅ `git remote -v` gitee 指向新仓
- ✅ legal docs 全部 Gitee URL 改名(6 处:zh/en 各 3 处)
- ✅ memory(reference_push_remotes + MEMORY.md)同步改

## 不改的(历史叙述保留)

- `改动日志.md` 老 entry / `docs/features/{repo-migration-deskfox,user-rename-zoulukuang,release-自动化,macos-打包}/` 内的 `opencode-for-office-deskfox` 引用 — 当时事实保留不改
- `reference_push_remotes.md` 内"2026-05-04 老仓归档"段历史叙述也保留

## 影响范围

- 净改动行数:legal docs ~12 行(2 文件 × 6 处)+ 三文档 ~150 行 + memory 2 处
- R4 override:0
- 上游侵入:0
- 远端动作:GitHub asset 重传 1 笔 / Gitee 2 笔(删老 + 创新)

## 关联

- 起源:[macOS] 2026.5.11.1 ship 实操中 user 反馈 .dmg 文件名不符规范
- 关联 feat:`feishu-bridge-imbot-agent`(5.11.1 主题)+ `win-ship-local-pack-switch`(列出 Mac ship 补全 backlog)
- 后续 ship 验证:下次 Mac ship 用 `pack-installer.sh` 完整走流程

## 已知风险 / FUTURE

- **`pack-installer.sh` 没单测**:本次 5.11.1 ship 暴露的 "ship 流程偏离 SOP" 问题靠 SOP 文档化解决,但下次仍可能 user / agent 偷懒直接调 `build-deskfox.sh`。FUTURE 可以在 `build-deskfox.sh -Env prod` 时打 warning "推荐用 pack-installer.sh 走完整 ship 流程",或者 release pre-push hook 检测 .dmg 文件名规范。
- **mirror-asset-to-gitee.sh 已对齐新仓默认**(`--gitee-repo deskfox`),5.11.1 修补用默认参数验证通过。
