---
feat-id: readme-deskfox-自家版
status: done
related: ./1-spec.md ./3-changelog.md
---

# readme-deskfox-自家版 — spec

## 目标

把 GitHub 主仓 `zoulukuang/deskfox` 的 README 从上游 OpenCode 原样改成 DeskFox 自家版,匹配:

- 产品定位:**面向办公人群的桌面 AI 助理**(不是给程序员的编码工具)
- 视觉品牌:DeskFox.Ai logo + slogan(`CLEVER · CALM · ALWAYS ON YOUR DESK`)
- 文案口径:跟 [deskfox.ai 官网](https://deskfox.ai/) + `D:\project\deskfox-site` 站点稿件保持一致
- 国际曝光:中英双版,国内为主受众

## 现状(改前)

- `README.md` 是上游 OpenCode 完整 README(英文,程序员定位 "open source AI coding agent")
- 22 个 locale 翻译文件(`README.{ar,bn,br,bs,da,de,es,fr,gr,it,ja,ko,no,pl,ru,th,tr,uk,vi,zh,zht}.md` 共 21 个 + 主 README.md = 22 个)— 全部上游内容
- 没有 DeskFox 自家品牌资产(logo / 截图)在 repo 内

## 范围

### 必须

- 重写 `README.md`(中文为主版,GitHub 默认显示)
- 新增 `README.en.md`(英文版,给国际访客)
- 复制 4 张产品截图 + 1 个 logo SVG 到 `docs/assets/`
- 删除 21 个上游 locale 翻译文件(漂移成本不可接受)
- README 文案 / URL 跟 `D:\project\deskfox-site` 站点稿一致(GitHub 用 `zoulukuang/deskfox`,Gitee 用 `zoulukuang/deskfox`,上游叙事写 `sst/opencode`)

### 不在本笔

- 22 种语言的小语种翻译版(过度工程,维护成本爆炸)
- README 中的产品截图后续迭代(本笔只放当前 4 张)
- 给上游 sst/opencode 的 PR(本笔 fork 自家品牌门面,跟上游无关)

## 决策(2026-05-04)

### 多语言策略

走 **A 方案**:中文 README.md 主版 + 英文 README.en.md,**删 22 个 locale**。
- 维护极简,跟随上游 0 冲突
- 主受众国内 → 中文优先;国际访客 → 英文兜底
- 小语种用户极少且 GitHub repo 受众主要是技术 / 创作者,英文够用

### 主版语言

`README.md` 走 **中文主**(GitHub 默认渲染这个文件)。
- 产品定位是"面向中国办公人群"
- 跟随 deskfox.ai 站点(中文优先 / 中英双语切换)

### 资产位置

`docs/assets/branding/` + `docs/assets/screenshots/`(在 fork repo 内,绝对路径稳定;clone / fork 后离线可见;avoids 外链 CDN 风险)。

资产清单(实际进 repo):

| 文件 | 用途 | 大小 |
|---|---|---|
| `docs/assets/branding/logo-horizontal.svg` | README 顶部 logo | ~2.4 KB |
| `docs/assets/screenshots/hero.png` | README hero(主界面 3 栏布局)| ~87 KB |
| `docs/assets/screenshots/preview-pdf.png` | "文件预览能力"段 1/3 | ~300 KB |
| `docs/assets/screenshots/preview-pptx.png` | "文件预览能力"段 2/3 | ~890 KB |
| `docs/assets/screenshots/preview-video.png` | "文件预览能力"段 3/3 | ~525 KB |

合计 ~1.8 MB,在 git history 里可接受(README 主门面值这个空间开销)。

### 截图选片(2026-05-04)

user 给了 7 张候选截图(`OPENCODE-PLAN/readme-draft/截图/`),挑 4 张:

| 截图 | 用 / 不用 | 理由 |
|---|---|---|
| 初始界面 | ✅ Hero | 完美 3 栏布局 + DeskFox logo + 模型选择器,门面足 |
| PDF 预览 | ✅ 矩阵 1 | 内容是 Claude Code 教程,公开技术文档,0 隐私 |
| PPT 预览 | ✅ 矩阵 2 | 行业公开数据(养老行业 PPT),0 隐私 |
| 视频预览 | ✅ 矩阵 3 | "DeskFox 还能预览视频"超出 Office 范围,产品力差异点 |
| Excel 预览 | ❌ | **真实员工姓名,隐私不能公开** |
| md 预览 | ❌ | 替代价值低,PDF 已覆盖文档预览 |
| 音频预览 | ❌ | 视频已展示多媒体,二选一更聚焦 |

### README 结构骨架

```
[logo + slogan + tagline 顶部居中]
[3 个 badge: latest release / MIT / forked from sst/opencode]
[一句话引用]
[Hero 主截图]
✨ 为什么选 DeskFox(4 卖点)
🎯 适合场景(4 行表格)
🖼️ 文件预览能力(3 列截图 grid)
📥 下载安装(Win + Mac + Gitee 镜像)
🌱 项目透明(fork 自 sst/opencode + 我们做了什么 + 链接到改动日志/治理/upstream merge SOP)
🌐 相关链接(官网 / Release / Gitee / Issues / 隐私协议 / 上游)
📄 协议(MIT)
```

英文版结构对应,文案借鉴 deskfox.ai 英文版。

## 验收

- [x] `README.md` 中文版,DeskFox.Ai 定位
- [x] `README.en.md` 英文版
- [x] 21 个 locale README 删除(README.{ar,bn,...,zht}.md)
- [x] 4 张截图 + 1 个 logo SVG 复制到 fork repo `docs/assets/`
- [x] feat 分支 `feat/readme-deskfox-自家版` push
- [x] GitHub 上预览渲染正确(图片 / 表格 / 链接 / emoji 全 OK)
- [x] merge feat → dev,删 feat 分支
- [ ] (follow-up,不阻塞)新仓 GitHub 上 social preview 图、topics、description 也对齐 DeskFox

## R4 override

无 — 全在 fork 治理白名单(`README.md` / `README.en.md` / `docs/` 都是 fork 拥有,不动上游路径下的文件;删的 21 个 locale 是上游路径但**整体删除而非编辑**,且全在 fork-only README 体系内,不影响代码 / 不破坏上游升级流程 — 只要每次上游同步时把这 21 个文件继续删除即可)。

注:`README.md` 文件本身**算上游文件**(上游有同名),严格说改它属于"改上游",但我们重写整个内容(从头到脚),跟上游 README 0 重叠;每次跟随上游升级时这是 conflict 必现的文件,take ours 即可。

## 关联

- 前置:`repo-migration-deskfox`(主仓在 zoulukuang/deskfox 真 fork)
- 前置:`user-rename-zoulukuang`(URL 收敛到 zoulukuang)
- 前置:`gitee-release-mirror`(Gitee 镜像入口可用)
- 资源出处:`D:\project\OPENCODE-PLAN\品牌设计\`(品牌资产)、`D:\project\OPENCODE-PLAN\readme-draft\截图\`(产品截图)、`D:\project\deskfox-site\`(canonical URL/文案)
