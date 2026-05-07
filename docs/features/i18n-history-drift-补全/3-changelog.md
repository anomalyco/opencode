---
feat-id: i18n-history-drift-补全
status: done
related: ./3-changelog.md
---

# 3-changelog — zh/zht 历史 i18n 漂移补全 + 守门升级到全字典

## 起源

`tests-mac-recent-feats` feat 跑 `i18n-completeness.test.ts` 时**揭露真实 bug**:zh / zht 缺 en 上游同步过来的 23 个 key(中文 locale 用户在某些位置看到英文混在中文里)。

那次范围限定为"最近 feat",将历史漂移转 backlog。本笔 feat 修这个 backlog。

## 缺失 key 分析(zh / zht 缺一致,各 23 key)

| namespace | 缺失数 | 例 |
|---|---|---|
| `command.project.*` | 2 | 上一个 / 下一个项目命令面板项 |
| `session.child.*` | 2 | 子代理会话提示 + 返回主会话 |
| `session.review.*` | 2 | 暂无变更 / 暂无未提交 |
| `settings.general.section.advanced` | 1 | "高级"分组标题 |
| `settings.general.row.shell.*` | 4 | 终端 Shell 设置(title / desc / autoDefault / terminalOnly)|
| `settings.general.row.show{FileTree,Navigation,Search,Status,Terminal}.*` | 10 | 5 个面板开关各 2 行(title + desc)|
| `sidebar.empty.*` | 2 | 侧边栏空状态 |

均为**上游 sst/opencode 历次 sync 时**加 en 但 zh/zht 漏跟的累积。

## 改动清单

### 修改

- `packages/app/src/i18n/zh.ts`:
  - 末尾新加 `// upstream-sync drift backfill — 上游 sync 累积漏补的翻译,2026-05-07 一次性补齐(23 key)` 块
  - 跟随相邻 key 风格(`项目` / `会话` / `更改` / `OpenCode` 保留英文 / 全角逗号)

- `packages/app/src/i18n/zht.ts`:
  - 同样位置加 23 个繁中翻译
  - 严格遵循已有繁中风格:`專案` / `工作階段`(zh 的"会话"对应)/ `變更` / `檔案` / `預設` / `搜尋` / `導覽` / `伺服器` / `終端機` / `智慧體`

- `packages/app/src/i18n/i18n-completeness.test.ts`:
  - 守门范围从"关键 namespace(`fileViewer.*` / `common.*`)"升级到**全字典 100% 覆盖**
  - 加一个 "不含 en 没有的 key(无遗留 dead key)" 测试 — 防止 zh/zht 残留过期 key
  - 注释明确:每次 sync 上游后必跑

## 翻译质量保证

参考相邻 key 已有翻译风格,不机械直译。例:

| en | zh | zht |
|---|---|---|
| `Subagent sessions cannot be prompted.` | 子代理会话无法发送消息。 | 子代理工作階段無法傳送訊息。 |
| `Show the file tree toggle and panel in desktop sessions` | 在桌面会话中显示文件树切换按钮和面板 | 在桌面工作階段中顯示檔案樹切換按鈕和面板 |
| `Auto (Default)` | 自动(默认) | 自動(預設) |
| `terminal only` | 仅终端 | 僅終端機 |

注:技术词跟随上下文已有惯例(`OpenCode` / `shell` 保留英文,与 `language.title` / `appearance.title` 段一致)。

## 测试结果

```
8 pass / 0 fail  (i18n-completeness 全字典守门)
347 pass / 1 fail  (全套 packages/app unit,1 fail = kobalte SSR 老坑)
```

测试增量 346 → 347(+1 个 "不含 dead key" 测试)。

## 守门升级前后对比

```
升级前(临时方案):                   升级后(终态):
─────────────────────────────       ─────────────────────────────
关键 namespace 必须覆盖              全字典必须覆盖
  fileViewer.*                       任何 namespace
  common.*                           任何 key
其他 namespace 可缺                 0 容忍
                                    + dead key 检查
                                    + 空字符串检查
```

## 影响

- **从此刻起**:任何 fork feat / 上游 sync 在 en 加新 key 但忘补 zh/zht → CI 立即 fail
- **零漂移基线**:漂移清除后,后续维护成本反而下降 — 改 1 个 key 就要补 1 个,不让积累
- **用户可见**:简中 / 繁中 locale 用户在 23 个之前显示英文的位置,现在看到正常中文
- **上游 sync 流程更新**:`docs/governance/UPSTREAM-MERGE-GUIDE.md` 应加一条 — sync 后必跑 i18n-completeness,失败立刻补(独立 backlog,不在本 feat)

## 规模 / R 标记

- 规模:Medium(~100 行 / 3 文件 / 0 R4 / 0 上游侵入)
- R2 FORK marker:zh.ts / zht.ts 都有 `// upstream-sync drift backfill` 注释段说明
- R3 黑名单:无
- R4 override:无
- R5 测试纪律:本 feat 是"修 bug"性质,但 bug 复现测试已在前一笔 `tests-mac-recent-feats` 写好(`i18n-completeness.test.ts` 已能检测 missing key);本笔升级测试守门范围属"测试本身的扩展"
