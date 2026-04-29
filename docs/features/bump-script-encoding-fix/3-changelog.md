---
feat-id: bump-script-encoding-fix
status: done
related: ./3-changelog.md
---

# bump-script-encoding-fix — changelog

**关联 commit**: 待回填
**所在分支**: `feat/editable-file-viewer`
**baseline tag**: 沿用线(无新 baseline)
**触发原因**: ship `[Windows] 2026.4.29.2` installer 时发现 `bump-installer-version.ps1` 写入 `docs/installer-versions.md` 的 placeholder 段落出现中文乱码:`(寰呭～: ship 鍚庡洖濉湰鏉?鈥?鍖呭惈 commits / 閰嶅 plugin / installer 璺緞绛?` ← 期望是 `(待填: ship 后回填本条 — 包含 commits / 配套 plugin / installer 路径等)`。当时手动重写 md 文件修掉了表象,但**根因在脚本**,下次打 installer 还会再坑一次,故立此 feat 单独修。

## 规模分级

**Tiny**(纯流程修复 / 1 个文件 / 3 字节 binary 改动 / 无逻辑改动)— 按规范 v2 仅产出 3-changelog.md。

## 根因分析

PowerShell 5.1 的源文件解析陷阱:

1. `bump-installer-version.ps1` 源文件**保存为 UTF-8 无 BOM**(首字节 `# [` = `35,32,91`)
2. PS 5.1 读 .ps1 文件时,**没 BOM 就按系统 ANSI 解析**(中文 Windows = GBK)
3. 脚本里的中文字面量 here-string `"(待填: ship 后回填本条 — 包含 commits ...)"` 在 UTF-8 字节序列下被 GBK 误读 → 内部 PowerShell 字符串持有的就是错误码点
4. 然后 `Set-Content -Path $logFile -Value $placeholder -Encoding UTF8 -NoNewline` 把这些错误码点按 UTF-8 写出去 → 双重编码乱码

脚本里 `-Encoding UTF8` 写文件**是对的**,问题不在写,在**读源**。

## 实际改动

### `packages/branding/scripts/bump-installer-version.ps1`(+3 字节 / 0 文本行变化)

文件头加 UTF-8 BOM 前缀(`EF BB BF`),文本内容**一行不动**。改动方式:

```powershell
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$content = [System.IO.File]::ReadAllText($path, $utf8NoBom)
$utf8WithBom = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText($path, $content, $utf8WithBom)
```

文件大小:3369 → 3372 字节(+3,即 BOM)。

加 BOM 后 PS 5.1 看到首三字节 `EF BB BF` 就会按 UTF-8 而不是 ANSI 解析源文件,中文字面量从此被正确读入,后续 `Set-Content -Encoding UTF8` 写出去也就正确。

## 行数

| 项 | 行数 |
|---|---|
| 修改 fork-only 代码 | 0 行(纯 binary BOM 前缀,文本无变化) |
| 文档(新文件,不计阈值) | ~80 行 |

git diff 看不到内容差异,只 `Binary files differ`,无 large-diff 标。

## 影响范围

- ✅ **bump-installer-version.ps1 的中文 here-string 输出**:正确写入 UTF-8 中文
- ✅ **PS 7+ 用户**:无影响(PS 7+ 默认按 UTF-8 读源,有无 BOM 都能正确解析)
- ✅ **macOS 端 build-deskfox.sh / pack-installer.sh**:本笔不涉(.sh 不是 .ps1,无 PS 5.1 源解析问题)
- ⚠️ **同目录其他 .ps1 脚本可能有同类问题**:本笔严格只修 bump 脚本,按 R7.5 不顺手批量改。后续若发现 `apply-icons.ps1` / `pack-installer.ps1` / `build-deskfox.ps1` / `restore-icons.ps1` 等有中文输出乱码,再单独立 fix。
- ✅ 上游 0 侵入(纯 fork-only 文件)

## 回归测试点

- **R1** 加 BOM 后跑 `bump-installer-version.ps1 -Platform Windows`,placeholder 段写入 `docs/installer-versions.md` line 13 内容是 `(待填: ship 后回填本条 — 包含 commits / 配套 plugin / installer 路径等)`(中文正确,无乱码)→ ✅ 实测通过(2026-04-29 22:31 本会话内,临时 bump 出 .3 验证后 git checkout 撤回测试痕迹)
- **R2** 历史已写入的 `[Windows] 2026.4.29.1` / `[Windows] 2026.4.29.2` entries 不受影响(已是正确 UTF-8) → ✅
- **R3** 下次真打 installer(.3 或之后)placeholder 自动正确,无需再手动重写 md 文件 → ⏳ 留待下次 ship 时观察

## review 自检

- [x] FORK marker 不需要(fork-only 文件,非上游)
- [x] 0 黑名单触动(`packages/branding/scripts/` 是 fork 自建)
- [x] 0 上游侵入
- [x] 仅 1 文件 binary 级 3 字节改动,无逻辑分支
- [x] 实测验证(R1)+ 测试副作用清理(git checkout `.iss` + `installer-versions.md` 撤回 .3 痕迹)
- [x] 无"顺手改"未记录
- [x] 无新依赖

## 已知遗留

- 其他 .ps1 脚本若也有中文 here-string,理论上有同样问题。本笔**故意不批量修**,等真出问题再立独立 feat(R7.5)。
- BOM 是 PS 5.1 时代的兼容性标记;若将来 fork 全面切到 PS 7+ + Windows Terminal 标准化,可批量去 BOM。届时单独立 feat。

## 回退方法

```
git revert <commit hash>
```

回退后 BOM 移除,脚本回到首字节 `# [` 状态,bump 脚本输出 placeholder 又会乱码 — 等于回到本 fix 之前。无 schema / 无依赖,纯 binary 级。
