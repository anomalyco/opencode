---
feat-id: macos-docx-viewer-fix
status: done
related: ./3-changelog.md
---

# macos-docx-viewer-fix — changelog

## 一句话

修复 Mac 端文件查看器打不开 .docx 等 office 文档的伪 regression — 根因是 `build-deskfox.sh` 第 0 步只在 sidecar 文件**不存在**时 build,导致 `packages/opencode/src` 改动**3 周不进 sidecar binary**,frontend 拿到的还是改协议前的 response 格式。Win 端 commit `b9581b76e` 修过同病(时间戳判断),Mac 端漏补,本笔补上。

> Tiny 规模:`build-deskfox.sh` 净 +20 行 / 1 文件 / 0 R4 / 0 上游侵入;无 1-spec / 2-plan,见本文。

## commit 列表

| commit | 简述 |
|---|---|
| (本笔 commit) | `fix(branding): build-deskfox.sh 加 sidecar 时间戳判断 — 跟 Win .ps1 commit b9581b76e 同等修法 [feat: macos-docx-viewer-fix] [bug-repro: Mac 端 .docx 文件查看器打不开,backend 返改协议前的 encoding 字段格式]` |

## 改动文件

| 文件 | 变更 | 备注 |
|---|---|---|
| `packages/branding/scripts/build-deskfox.sh` | +20/-3 行 | sidecar build 触发条件:`! -f $SIDECAR_PATH` → `! -f $SIDECAR_PATH \|\| latest src .ts mtime > sidecar mtime`(跟 Win .ps1 b9581b76e 同结构) |

## 排查路径(实战路径,记录给后续)

1. **GUI 表象**:Mac 端打开 .docx → 显示"LibreOffice 已就绪 / 重新加载文件"引导页(不是 PDF 预览)
2. **第一轮怀疑(白忙)**:LibreOffice 路径检测 / cache PDF / SDK call → 都 OK,不是这些问题
3. **关键提示**:user 提示"查历史看之前怎么解决的",拉回 git log 看 office-pdf-ref 协议改动
4. **决定性一步**:**直接 curl backend `/file/content`** 看 response → 返 `encoding: "office-pdf-ref"`(老协议) — 但当前源码已 5月3日 改成 `mimeType: OFFICE_PDF_REF_MIME`,**字段对不上 = sidecar 没更新源码**
5. **`ls -la sidecars/opencode-cli-aarch64-apple-darwin`** → **2026-04-29 build**(3 周前!)
6. **手动 `bun run build --single`** in packages/opencode → cp 新 sidecar → 重启 → 修了
7. fix 落地:把 Win `b9581b76e` 的时间戳判断同步到 Mac `build-deskfox.sh`

## 修法对比

```diff
-if [[ ! -f "$SIDECAR_PATH" ]]; then
-    echo "[deskfox] sidecar not found, building..."
+if need_rebuild_sidecar; then
+    if [[ ! -f "$SIDECAR_PATH" ]]; then
+        echo "[deskfox] sidecar not found, building..."
+    else
+        echo "[deskfox] sidecar stale(packages/opencode/src 内有新于 sidecar 的 .ts), rebuilding..."
+    fi
```

`need_rebuild_sidecar` 函数:`find packages/opencode/src -name "*.ts" -exec stat -f%m {} + | sort -rn | head -1` 拿最新 src mtime,跟 sidecar mtime 比,大就 rebuild。

## 验证

- ✅ build-deskfox.sh 单独跑:sidecar 已是最新 → 输出 `sidecar up-to-date`(不重 build,turbo cache 行为)
- ✅ user GUI 实测:.docx 在文件查看器内 PDF 预览正常
- ✅ backend `curl /file/content?path=markdown-test.docx` 返新格式 `{"type":"text","content":"","mimeType":"application/x-deskfox-pdf-ref"}` — 跟当前源码一致

## 关联

- Win 端同病已修:commit `b9581b76e` 在 [`build-pipeline-sidecar-fix`](../build-pipeline-sidecar-fix/3-changelog.md)
- 经验落 memory:[`reference_sidecar_staleness_trap.md`](file:///Users/openclaw/.claude/projects/-Volumes-ExtSSD-opencode-fork/memory/reference_sidecar_staleness_trap.md) — 后续 backend API 行为反直觉先 ls sidecar 时间戳

## 影响范围

- 0 行代码改 packages/opencode/(根因不在那)
- 0 行代码改 ui pkg / app pkg(用户感知到的 bug 修了 = 把 sidecar 真带新代码进 binary)
- 仅改 1 行 build script,所有未来 packages/opencode/src 改动都自动同步进 sidecar
- 没影响打包(build script 反而更鲁棒)
- 没影响 CI(test.yml 不跑 build-deskfox.sh)

## 回退

```sh
git revert <本笔 commit>
```

回退 = 回到老 build-deskfox.sh,sidecar 老 logic(不存在才 build);已 build 出来的 sidecar binary 不变。
