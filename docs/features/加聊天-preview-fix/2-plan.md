---
feat-id: 加聊天-preview-fix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 加聊天-preview-fix — plan

## 实施步骤

### 1. `packages/app/src/utils/comment-note.ts`

- `formatCommentNote` 签名加可选 `preview?: string`
- 文本结构改为(preview 缺省则不附):

  ```
  The user made the following comment regarding lines 1 through 3 of foo.md: <comment>

  Selected text:
  """
  <preview>
  """
  ```

- `parseCommentNote` regex 改成"非贪婪 comment + 可选尾部 Selected text 块",兼容新旧消息:

  ```
  /^The user made the following comment regarding (this file|line (\d+)|lines (\d+) through (\d+)) of (.+?): ([\s\S]+?)(?:\n\nSelected text:\n"""\n[\s\S]*?\n""")?$/
  ```

  注:这里只让 regex 不被尾块吞掉就够了,`parseCommentNote` 的返回类型保持原样(`path / selection / comment`),不返 preview — preview 已在 metadata 里,UI 走 `readCommentMetadata` 取。

### 2. `packages/app/src/components/prompt-input/build-request-parts.ts:170`

- `formatCommentNote({...})` 调用处加 `preview: item.preview`,一行改动

### 3. 同笔 commit

2 文件强耦合,中间态(只改其一)无法联调,合 1 笔走完。tiny 级,不需要 baseline tag,不需要 large-diff override。

## 决策轨迹

| 决策点 | 选项 | 取舍 | 理由 |
|---|---|---|---|
| preview 放在哪 | A. 改 server 让 file part 嵌入选区 / B. 前端 synthetic text 里带 | B | A 要动 server `prompt.ts` 还要新增协议字段(client/server 双侧改动);B 局限在前端 2 文件,立即 work,且与现有 metadata 通道并行不冲突 |
| 文本结构 | A. 一行尾巴拼接 / B. 换行三引号块 | B | 三引号块边界对模型清晰,不会把 preview 误当 comment 一部分;regex 也好兼容 |
| `parseCommentNote` 兼容策略 | A. 双 regex / B. 单 regex 非贪婪 + 可选尾块 | B | 一条 regex 走两种格式,代码量少;metadata 优先时 regex 是兜底,容错足够 |
| `findLineRange` 是否一并增强 | A. 同笔修 / B. 单独留挂 | B | 反对 scope 蔓延;preview 进文本后此处不再是用户痛点,后续真踩坑再单开 feat |
| 加 `truncatePreview` 上限 500→? | A. 同笔放宽 / B. 不动 | B | 当前 500 字符未见实际投诉;放宽要权衡 prompt 体积,不与本 bug fix 同笔 |

## 风险

- **prompt 体积**:每条加聊天最多多 `<= 500 + 20`(三引号 + 标题)字符。typical session 几条评论可控,极端用户大量加评论时累积量需观察(R6 验证项)。
- **regex 误匹**:用户 comment 内容如恰好含 `\n\nSelected text:\n"""` 字面会被新 regex 吞掉。自然语言概率极低;且 metadata 优先时 UI 走 metadata,regex 误匹只影响"无 metadata 老消息 UI 渲染",影响面小。
- **回退**:`git revert <hash>` 一次到位,2 文件无 schema 变更,server 完全不感知。
- **不引入新依赖 / 不动 husky pre-commit / 不动黑名单**:无 R3 三禁令风险。

## 预算

| 项 | 行数 |
|---|---|
| `comment-note.ts` 修改 | ~15 行(签名 + 文本结构 + regex) |
| `build-request-parts.ts` 修改 | ~1 行(调用处加字段) |
| **代码 staged** | **~16 行** |
| 文档 fork-only(本目录三件) | ~250 行(spec + plan + changelog) |
| **总 staged** | **~266 行**,远低于规范 v2 的 500 阈值 |

无 large-diff 标,无 override 配额消耗。

## 验证脚本

build 走 `D:\project\opencode-fork\scripts\build-deskfox.ps1`(memory:`opencode-fork(DeskFox)验证走 desktop release exe`),build 前自动杀进程,产出 `DeskFox.exe`,user 双击验 R1-R6。

## 走过的弯路 / 中途调整

- **设计 / 实施层零弯路**:spec 出来后一次过。代码 13 行,typecheck 一次过,user 双击 R1-R6 一次全绿。
- **操作层一个坑(非设计问题,记下避免重蹈)**:首次跑 `build-deskfox.ps1` 时我外层套了 `2>&1 | Tee-Object` 截日志,触发 PowerShell 5.1 的"native exe stderr → NativeCommandError"陷阱,exit code 1 假阳性(实际 build 还没走到 tauri 真编译就被 PS 打断)。系统提示明确警告过。直接调脚本不带重定向即正常,2m10s 出 `DeskFox.exe`。**结论**:Windows + PowerShell 调 bun/cargo/tauri 这类原生命令时,**绝不**手动重定向 stderr,让 PS 工具内置捕获即可。
- **INDEX.md 状态升级两步走**:planning(开干前)→ in-progress(改代码时)→ done(测过 + 写完 changelog 时)。三个状态分别对应"已立项 / 进行中 / 收口",自然映射规范 v2 三文档的时序。
