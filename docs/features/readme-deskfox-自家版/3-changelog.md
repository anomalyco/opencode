---
feat-id: readme-deskfox-自家版
status: done
related: ./1-spec.md ./3-changelog.md
---

# readme-deskfox-自家版 — changelog

## 触发

`repo-migration-deskfox` 把主仓迁到 `zoulukuang/deskfox` 后,GitHub 主仓 README **还是上游 OpenCode 完整原样**(英文 + "open source AI coding agent" 程序员定位 + 22 种 locale 翻译)。点开 zoulukuang/deskfox 的人看到的还是上游门面,跟 deskfox.ai 官网定位 / 实际产品(办公人 AI 助理)不匹配。

属于品牌门面 backlog 的最后一块拼图。

## 操作执行

### Phase 1 — 调研 + 草稿(在 OPENCODE-PLAN)

走"草稿/产品分离"模式:草稿在 `D:\project\OPENCODE-PLAN\readme-draft\`,正式版才进 fork repo。

1. WebFetch `https://deskfox.ai/` + 看 `D:\project\deskfox-site\index.html` 抓 canonical URL / 文案
2. 看 `D:\project\OPENCODE-PLAN\品牌设计\` 选品牌资产(走最小集 1 个 logo,后续看需要再加)
3. user 提供 7 张产品截图 → Claude 多模态 Read 评估 → 选 4 张(隐私 / 重复 / 视觉效果三维度)
4. 写 `README.md.draft` + `README.en.md.draft`,先在草稿目录里 user 用 DeskFox 自带 markdown preview 看
5. **DeskFox markdown preview 不渲染本地相对路径图片**(见 [`docs/governance/`](#) backlog)→ 决定走 GitHub feat 分支预览

### Phase 2 — 落 fork repo + push feat 分支

```
[opencode-fork on feat/readme-deskfox-自家版]
├─ docs/assets/branding/logo-horizontal.svg   (新)
├─ docs/assets/screenshots/{hero,preview-pdf,preview-pptx,preview-video}.png  (新)
├─ README.md                                   (重写,中文主版)
├─ README.en.md                                (新增,英文版)
├─ 删 21 个 locale: README.{ar,bn,br,bs,da,de,es,fr,gr,it,ja,ko,no,pl,ru,th,tr,uk,vi,zh,zht}.md
└─ docs/features/readme-deskfox-自家版/{1-spec.md, 3-changelog.md}  (新)
```

### Phase 3 — merge feat → dev + 删 feat 分支

按 [`docs/governance/双端协作-SOP.md`](../../governance/双端协作-SOP.md) feat 分支生命周期:**合 dev 即销毁**。

- `git checkout dev`
- `git merge --no-ff feat/readme-deskfox-自家版`(--no-ff 保留 feat 分支历史标记)
- `git push origin dev`
- `git branch -D feat/readme-deskfox-自家版`(本地删)
- `git push origin --delete feat/readme-deskfox-自家版`(远端删)

## 验证

| 项 | 状态 |
|---|---|
| `README.md` 中文版渲染正确(GitHub) | ✅ feat 分支 push 后 user 预览过 |
| `README.en.md` 英文版渲染正确 | ✅ |
| 21 个 locale 删除 | ✅(`git status` 显示 D × 21)|
| 4 张截图 + logo 显示正常 | ✅ |
| GitHub repo 主页第一屏视觉 vs OpenCode 时代 | ✅ 完全 DeskFox 品牌 |
| merge feat → dev | ✅ |
| feat 分支删除(local + remote) | ✅ |

## 影响范围

### 直接收益

- GitHub repo 主页跟 deskfox.ai 站点定位完全对齐
- 删 21 个 locale → 上游升级时 0 翻译漂移负担
- 截图直观传达"文档预览 + 多媒体预览 + 三栏布局"差异点
- 中英双版覆盖国内主受众 + 国际曝光

### 长期

- 上游 sst/opencode 每次 sync,README 是 conflict 必现文件;solution:take ours,每次保留 fork 自家版
- 类似 21 个 locale 文件,每次 sync 都会被上游"重新加上",reconcile 时逐个 git rm(可写到 UPSTREAM-MERGE-GUIDE 里作 SOP)

### 风险 / 已缓解

- DeskFox 自家 markdown preview 不渲染本地图(开发期审稿 broken)→ 已在 spec 注明,审稿走 GitHub feat 分支预览
- 主受众 README 改中文,可能国际开发者首屏看不懂中文 → 已在文件顶部做 [English](README.en.md) 显式跳转链接

## R4 override

无(详见 1-spec.md "R4 override" 段)。

## 修订记录

### 2026-05-04 — 默认语言英文化

merge dev 之后 user 反馈:**国外申请数字签名期间**(SignPath / Apple notarization / 等),GitHub 主仓门面会被国外审核方看到,英文为默认更合适。

改动(直接 dev,无新 feat 分支,小动作):
- `git mv README.md README.zh.md`(中文版降为辅版)
- `git mv README.en.md README.md`(英文版升为主版,GitHub 默认渲染)
- 两个 README 顶部"语言切换"链接互换:
  * 新主 `README.md`(英文):"🇨🇳 中文" → `README.zh.md`
  * `README.zh.md`(中文):"🌐 English" → `README.md`
- spec.md "主版语言" 段加修订决策记录

未来如果数字签名拿到 / 主战场转回国内,可再次 swap 回中文主(成本同样几分钟)。

---

## 关联

- 前置:`repo-migration-deskfox` / `user-rename-zoulukuang` / `gitee-release-mirror`
- 资源出处:
  - `D:\project\OPENCODE-PLAN\品牌设计\` → logo SVG
  - `D:\project\OPENCODE-PLAN\readme-draft\截图\` → 4 张产品截图(user 提供)
  - `D:\project\deskfox-site\index.html` → canonical URL / 文案
- follow-up backlog:
  - GitHub repo 设置:Description / Topics / Social preview 图,跟 README 对齐(web UI 配,不在 repo 内)
  - DeskFox 自家 markdown preview 渲染本地图问题(单独 feat,fork-only 改 markdown renderer image src 解析)
  - 草稿目录 `OPENCODE-PLAN/readme-draft/` 保留 / 归档(user 决策)
  - 截图后续迭代:产品 UI 改了,README 截图也要更新
