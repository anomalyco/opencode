---
feat-id: 分支策略-v2
status: draft(讨论稿,等笑南审定后锁版)
related: ./1-spec.md
---

# 分支策略 v2:dev 稳定主干 + 上游同步分离

> 状态:**讨论稿**,2026-04-30 起草。
> 用途:对齐"opencode / deskfox / feat 三者关系"以及"如何处理上游漂移"的工作模型。
> 后续:笑南审过 → 锁版 → 加 2-plan.md 实施 → 加 3-changelog.md 落账。

---

## 讨论引导(给笑南 — 先看这两个)

### 关注点 1:第七节 风险 4(hook 与 dev push 冲突)

- `docs/governance/改动规则.md` 节 4.3 写过"禁止直 push 到 main/master/dev"
- 切换到"dev 稳定主干"模型后,笑南要直 push dev,会被 hook 拦
- 决策:① 改 hook(允许笑南本人推 dev) ② 或者全走 PR-based
- **这个不解决,切换那一步执行不了**
- 📌 这条 hook 拦的是"笑南自己手滑直 push",不是"防陌生人"。陌生人进不来的原理见 **附录 C**。所以放开 hook 不会因此对陌生人开门。

### 关注点 2:第四节 5 个决策点

- 切换时机(4.1)/ 合上游时机(4.2)/ 安全告警时机(4.3)/ 老 feat 处置(4.4)/ 协作流程(4.5)
- 都是清单选择题,笑南勾一遍,就有完整实施 checklist 了

### 接下来怎么走

笑南扫一遍文档(尤其第 1-4 节核心 + 第 7 节风险),我们对着商量:

- 方案本身有没有调整
- 5 个决策点笑南怎么勾
- hook 与 dev push 怎么处理

---

## 一、为什么要改(触发原因)

### 1.1 当前实际状态(实测数据,2026-04-30)

| 分支 | HEAD | 状态 |
|---|---|---|
| `upstream/dev`(sst/opencode) | `aa07f38b0`(往后还在涨)| 持续在跑 |
| `dev`(deskfox 本地 + origin)| `623579217` | **停在 bootstrap 那一笔从未变过** |
| `feat/editable-file-viewer`(双端协作主分支)| `45e37c02f` | **领先 dev 66 笔**(所有 fork 工作都堆在这) |

关键事实:
- **dev 与 upstream/dev 的漂移 = 282 笔**(CLAUDE.md 健康指标"≤ 100"早就超了)
- **dev 不"代表"任何实际产品** — ship 出去的 installer 全部基于 feat/editable-file-viewer
- **feat 已经 66 笔 + 6 个 ship 版本**,本质是"DeskFox 工作主线",但名字写着"editable-file-viewer"已经盖不住实际范围

### 1.2 这套现状的问题

- ❌ **ship 不可追溯**:你 ship 了 `2026.4.29.2`,但回头要看那个版本的源码状态,只能 `git log --grep` 找,没有 tag
- ❌ **协作风险**:你和 mac 端两人都直接 push feat,容易像今天这样冲突
- ❌ **上游升级越拖越难**:漂移已 282 笔,再不合下次合就更恐怖
- ❌ **CLAUDE.md 模型与现实不一致**:CLAUDE.md 写"dev 跟随 upstream/dev",但实际上根本没跟随,文档撒谎

### 1.3 笑南提出的两种方案

| 方案 | 说明 | 评分 |
|---|---|---|
| A:dev 是稳定主版本,主动决策合上游 | dev = 已 ship 的稳定基线,上游升级是周期性人工决定 | ⭐⭐⭐⭐⭐ |
| B:把上游同步到 feat,feat 做完合回 dev | 让 feat 既装 feature 又扛上游升级 | ⭐⭐(不推荐)|

方案 B 不推荐的理由:
- feat 责任过载(既装新功能又装上游升级,容易乱)
- 多 feat 同时开时,谁负责 sync 上游?
- 你开发到一半,有人把几十笔上游 rebase 进 feat,工作树会"地震"

---

## 二、推荐方案:方案 A 的升级版(混合体)

把"合上游"这件事**单独切一个专用分支**(短命的 sync 分支),既保留方案 A 的稳定性,又把上游冲突隔离在临时空间:

```
upstream/dev(sst,只读)
     │
     │  主动决策时机(季度 / 看到上游新功能想要 / etc.)
     ▼
sync/upstream-<日期>   ← 临时分支,专吃上游
     │  解决冲突 + 验证 + 冒烟测试
     │  (在这里折腾,坏了不影响主干)
     ▼
dev (DeskFox 稳定主干)  ← 只接收"已验证过"的内容
     │  ship installer 都从这里打 tag
     │
     ├─→ feat/A
     ├─→ feat/B
     └─→ feat/C
         (各 feat 看到 dev 更新后,自己 rebase 一下拿到新基线)
```

### 2.1 三种分支的职责

| 分支 | 长短命 | 谁碰 | 干什么 |
|---|---|---|---|
| `upstream/dev` | 永久,只读 | 没人写 | sst/opencode 上游,只 fetch |
| `sync/upstream-<日期>` | 短命(1 天到 1 周)| 笑南 | 季度 / 按需吸收上游,验证后合回 dev |
| `dev`(本地 + origin)| 永久 | 笑南 | 稳定主干,ship installer 的来源 |
| `feat/<name>` | 短命(几天到几周)| 笑南 / 协作者 | 单个新功能,做完合回 dev |

### 2.2 核心原则

1. **dev 永远是"能 ship 的状态"** — 任何时刻 checkout dev,都应该能 build 出可工作的 installer
2. **dev 不自动跟随上游** — 上游升级是主动决策,通过 sync 分支吸收
3. **feat 只装单一功能** — 不再让 feat 当大箩筐
4. **每次 ship 必打 tag** — `ship-<版本号>`(如 `ship-2026.4.29.2`)

---

## 三、决策(讨论中已敲定)

| 决策点 | 选择 |
|---|---|
| dev 是否自动跟随上游 | ❌ 不自动,主动决策 |
| 上游升级走哪里 | 专用 `sync/upstream-<日期>` 短命分支 |
| feat 分支策略 | 单功能短命分支,做完合回 dev |
| ship 必打 tag | ✅ 每次 ship installer 在 dev 打 `ship-<版本>` tag |
| HANDOFF md 处置(2026-04-30) | 删除(任务已结,主仓 commit `41817499d` 已 push 完成) |
| **B5 mac 端协作通知**(2026-04-30) | ✅ 已通知李哲暂停推 dev / feat,等切换稳定 |
| **B1+B2 github 双 push**(2026-04-30) | 临时把 origin 的 github push URL 去除,**只推 gitee**;github/dev 幽灵分支后置处理(切换稳定后再决定 force push / 删除 / 保留) |
| **B3 改动规则.md 4.3 节**(2026-04-30) | ✅ 正式废除"禁止直 push 到 main/dev/master"。理由:hook 从未实装该规则,且 v2 模型本意就是笑南本人直推 dev。详见 [`docs/governance/改动规则.md`](../../governance/改动规则.md) 4.3 节废除说明 |

## 四、决策(待笑南最终敲定)

### 4.1 切换时机

- [ ] **立刻切换** — 今天就把 feat/editable-file-viewer 合回 dev,从此走新模型
- [ ] **等下一个稳定 milestone 切换** — 比如再 ship 一个版本后切
- [ ] **暂不切换,先维持现状** — 等上游漂移真的难处理时再说

### 4.2 合上游时机

- [ ] **本次切换后立刻合一次**(把 282 笔上游一次性吞掉,工作量半天到 1 天)
- [ ] **季度合一次**(下次定在 2026 Q3,大概 7 月)
- [ ] **按需合**(看到上游某个新功能想要时再合)

### 4.3 安全告警处理

GitHub Dependabot 报告:**39 个漏洞(8 high / 23 moderate / 8 low)**,在 default branch(dev)上。
- [ ] 切换 dev 之后立刻处理(因为切完 dev 会更新,告警基线会变)
- [ ] 单独立 feat:`security-deps-update`,作为合上游之后的下一步
- [ ] 暂不处理,看实际是否影响功能

### 4.4 老 feat 分支怎么办

`feat/editable-file-viewer` 名字已经盖不住实际内容(file-viewer / GetBot / installer / md-viewer / privacy / ...),切换时:
- [ ] **直接合到 dev,留作历史 tag**(`pre-strategy-v2-2026-04-30`),分支删掉
- [ ] **保留分支,但停止使用**(只读历史,新工作切新 feat)
- [ ] **重命名为 `legacy/dev-pre-v2`**,让名字反映状态

### 4.5 协作流程

- [ ] PR-based(双端通过 PR 合 dev,需要 review)
- [ ] 当前直 push 模式(feat 上直接 push,不开 PR)
- [ ] 混合(重要 feat 走 PR,小 fix 直 push)

---

## 五、动作计划(按优先级)

### 🔥 高优先级(2-3 天内做完)

| # | 动作 | 工作量 | 价值 |
|---|---|---|---|
| 1 | 给已 ship 的 `2026.4.29.2` 补打 `ship-prod-2026.4.29.2` tag(commit `e6faf1132` — 调研确认只此 1 笔 ship,无 .1)| 5 分钟 | 出 bug 时能精准定位源码 |
| 2 | 把 feat/editable-file-viewer 合回 dev,dev 升为稳定主干 | 30-60 分钟 | 切换到 v2 模型,告别"feat 大箩筐" |
| 3 | 切一笔 sync/upstream-2026-Q2,合 282 笔上游 | 半天到 1 天 | 漂移归零,健康指标恢复 |
| 4 | 处理 8 个 high 安全漏洞 | 1-2 小时 | 真实安全风险 |

### 🟡 中优先级(本周内做完)

| # | 动作 | 工作量 | 价值 |
|---|---|---|---|
| 5 | 立 `feat/win-tri-env-appid`:Win 端补三档 AppId(`DeskFox.iss` 加 `#ifdef AppEnv` + `pack-installer.ps1` 加 `-Env` 参数),完成应用身份规则 Win 部分(详见附录 D)| 1.5-2 小时 | 补 Mac/Win 不对称(三档共存能力两端对齐) + 实测 v2 模型下"短命 feat → dev"流程是否好用 |
| 6 | 更新 CLAUDE.md "默认仓库约定"段,反映 v2 模型 | 15 分钟 | 文档与现实一致 |
| 7 | 写 `docs/governance/分支策略-v2.md` 长期文档 | 30 分钟 | 协作者上手 |
| 8 | 写 `docs/fork-divergence.md` 维护"我们 vs 上游"差异面 | 15 分钟 | 季度自查支持 |
| 9 | 把"分支策略-v2"立为正式 feat,加 2-plan / 3-changelog | 30 分钟 | 流程闭环 |

### 🟢 低优先级(看心情)

| # | 动作 | 工作量 | 价值 |
|---|---|---|---|
| 10 | PR-based workflow 切换 | 看协作密度 | 双端协作密度高才值得 |
| 11 | 自动化 CHANGELOG 生成 | 半天 | 现有手动维护够好,ROI 低 |
| 12 | 加 GitHub Actions CI(自动 typecheck + build) | 半天到 1 天 | 替代部分本地 pre-commit hook |

---

## 六、第一步实施细节(高优先级 #1 + #2)

### 6.1 补打历史 ship tag

```bash
# 找到 ship 2026.4.29.1 对应的 commit
git log --oneline | grep "ship.*2026.4.29.1"
# 假设是 abc123,打 tag
git tag ship-2026.4.29.1 abc123

# 同样补 .2
git log --oneline | grep "ship.*2026.4.29.2"
# 假设是 e6faf1132
git tag ship-2026.4.29.2 e6faf1132

# push tags
git push origin --tags
```

### 6.2 把 feat 合回 dev 的两条路

#### 路径 A:简单粗暴(推荐 — 个人项目)

```bash
git checkout dev
git pull origin dev   # 确保本地 dev 与 origin/dev 同步
git tag pre-strategy-v2-dev-was-bootstrap-only  # 兜底 tag
git reset --hard feat/editable-file-viewer       # dev 直接拉到 feat HEAD
git push origin dev                                # 推到远端

# 之后双端都做:
# git checkout dev
# git pull
# 然后从干净 dev 切新 feat
```

**优点**:简单,1 步到位
**缺点**:dev 历史从"1 笔"突然变"67 笔",看起来像 force push(虽然不是)

#### 路径 B:merge --no-ff(保留 feat 历史拓扑)

```bash
git checkout dev
git merge --no-ff feat/editable-file-viewer -m "merge feat/editable-file-viewer into dev (strategy v2 切换)"
git push origin dev
```

**优点**:历史拓扑可见(能看出"这块 67 笔是从 feat 合过来的")
**缺点**:多一个 merge commit 节点

### 6.3 老 feat 分支处置

合并后,`feat/editable-file-viewer` 的处置看 **4.4** 决策。

---

## 七、风险与回滚

### 7.1 风险

| 风险 | 严重度 | 缓解 |
|---|---|---|
| 切换 dev 后 mac 端不知情,继续推 feat 旧分支 | 中 | 先告知 mac 端 + 在仓库 README 标注新分支策略 |
| 合上游 282 笔产生大量冲突 | 中-高 | 走 sync 分支,坏了 git reset --hard 撤回,不影响 dev |
| 切换后 ship 流程没适配新 dev | 低 | 切换前先在 dev 跑一次完整 build + 出 installer 验证 |
| dev 上 push 被 pre-push hook 拦(写了"禁止直 push 到 dev") | 高 | **需要先改 hook**,允许笑南本人推 dev,或者临时关掉 |

> ⚠️ **风险 4 是切换前必须处理的**。`docs/governance/改动规则.md` 节 4.3 写"禁止直 push 到 main/master/dev",这条是按 GitFlow 思路写的(假设走 PR)。新模型下笑南需要直接 push dev,要么改 hook,要么改成 PR-based。

### 7.2 回滚方法

- **切换 dev 失败**:`git tag pre-strategy-v2-dev-was-bootstrap-only` 已打,`git reset --hard pre-strategy-v2-dev-was-bootstrap-only` 一键回到切换前
- **合上游失败**:sync 分支独立,`git branch -D sync/upstream-2026-Q2` 删除即可
- **新模型不适应**:每个 ship tag 都在,可以单独从 tag 上 cherry-pick 回 feat 上工作

---

## 八、附录 A:大型 OSS 项目对照(为什么这套模型合理)

| 项目 | 主干 | 稳定分支 | 我们的对应 |
|---|---|---|---|
| Linux 内核 | mainline | stable / LTS | dev = 我们的 mainline + stable(单一稳定主干,小项目不需要分两条)|
| Kubernetes | main | release-1.X | 同上 |
| VS Code | main | release/1.X.x | 同上 |
| sst/opencode | dev(单一)| 无 | 我们直接 fork 它,但加了 ship tag 当"软 release" |
| 大型 fork(MariaDB / Forge)| 自有 main | 无 | 我们的 dev 学这个 |

**核心收获**:大项目都有"主干稳定 + 临时分支处理风险"这个模式。我们个人项目体量,**不需要 release 分支** / **不需要 RC 周期**,但是**应该有"主干稳定 + sync 分支吸上游"这个最小骨架**。

---

## 九、附录 B:CLAUDE.md 哪些段需要同步更新

如笑南敲定本方案,以下 CLAUDE.md 段落需要改(单独立 feat 处理):

1. **元原则**段不变(三件事不变)
2. **R1-R4** 不变
3. **默认仓库约定**段需要重写:
   - 老:"默认分支:dev(跟随 upstream/dev)"
   - 新:"默认分支:dev(DeskFox 稳定主干 — 已 ship 的基线,不直接跟随上游)"
4. **新增一段**:上游同步走 `sync/upstream-<日期>` 临时分支,验证后合回 dev
5. **健康指标**保持(漂移 ≤ 100,但加注"通过 sync 分支主动管控")

---

## 附录 C:开源仓库 PR 安全模型(陌生人能做什么 / 不能做什么)

> 起草于 2026-04-30,源于笑南讨论中提问"陌生人提交修改进来会直接合并吗"。
> 结论先行:**陌生人不可能直接合并到本仓,绝对不会**。仓库主人(笑南)不点 Merge,改动就永远停在 PR 页面进不来。

### C.1 陌生人能做的最多就是

1. **fork** — 把仓库克隆一份到他自己 GitHub/Gitee 账号下,这只是复制,跟本仓无关
2. **提 Pull Request**(字面意思"请你把我的改动拉过去")— 这只是**请求**,默认状态是"等你审"

类比:陌生人在你家门口按门铃,你不开门就进不来。

### C.2 真正会让陌生人有写权限的几种情况(都需要笑南主动操作)

| 情况 | 风险 |
|---|---|
| 把对方加为 **Collaborator**(仓库 Settings 里手动添加) | 高 — 他能直接 push,权限跟笑南一样 |
| 装了 auto-merge 机器人(Mergify、Dependabot auto-merge) | 看配置,默认都很保守 |
| 仓库 transfer / 加到 organization 给了 admin | 高 |

**没主动做以上任何一件 → 陌生人只能在 PR 页面等笑南点头。**

### C.3 与本文档"hook 与 dev push"问题的关系

- pre-push hook(`docs/governance/改动规则.md` 4.3)拦的是 **笑南自己本地手滑**,防止误操作直推主干
- **不是**防陌生人 — 平台层面陌生人本来就进不来
- 所以"放开 hook 让笑南本人能推 dev"**不会因此降低对外安全性**,只是放宽了对自己的限制

### C.4 额外保险(可选,小项目用不上)

GitHub **Branch Protection Rules**(Settings → Branches)可以给 dev 加规则:

- ❌ "必须经过 PR 才能合(禁止直 push)" — 这条会跟 v2 模型"切到 dev 直 push"冲突,**别开**
- ❌ "必须有 N 个人 review 才能合" — 单人项目用不上

**结论**:笑南不点 merge,谁都合不进来,默认就够安全。

---

## 附录 D:三档环境(dev/beta/prod)与分支模型的关系

> 起草于 2026-04-30,源于讨论"dev / beta / prod 三档是不是要对应三个分支"。
> 结论先行:**不需要**。三档是 build 环境(应用身份维度的区分),不是分支维度。同一个 dev 分支用不同 build 参数即可产出三档,各自独立打 tag ship。

### D.1 概念区分(讨论中曾被混淆)

| 概念 | 是什么 | 跟分支的关系 |
|---|---|---|
| **build 环境**(dev/beta/prod) | 同一份代码 + 不同 build 参数(应用身份/配置/日志开关)出不同产物 | **不绑定分支** |
| **release 节奏**(谁更频繁) | 不同环境何时 ship | **不绑定分支** |
| **分支模型** | 代码版本管理(主干 / feat / sync) | 与 build 环境正交 |

应用身份(Mac Bundle ID / Win AppId)的三档配置,完整规则见 [`docs/governance/应用身份-命名规则.md`](../../governance/应用身份-命名规则.md)。

### D.2 引用的 "gitflow" 模型为何不适用

讨论中曾引述"主流开源项目都用 develop / release / main 三类分支对应三档环境"。这个说法描述的是 **gitflow 模型**(Vincent Driessen 2010),其作者 2020 年公开承认"小项目别用"。现代主流是 **trunk-based**(Google / Meta / GitHub):单一长期分支 + 短命 feat + tag。

| 模型 | 长期分支 | 谁在用 |
|---|---|---|
| gitflow | `main` + `develop` + `release/*` | 早期 OSS,**已被很多人放弃** |
| GitHub Flow | `main` + 短命 feat | GitHub 自己 |
| trunk-based | 单一 trunk + tag | Google / Meta / 大部分现代大厂 |
| Linux 模型 | `mainline` + `stable/LTS` | Linux 内核(本文档附录 A) |
| sst/opencode(我们上游) | `dev` 一条 | 上游 |

DeskFox 的 v2 模型就是 trunk-based + tag,完全够用。

### D.3 v2 模型下三档环境怎么处理

```
源码:   dev 分支(单一稳定主干)
              │
              ├─ pack -Env dev  → DeskFox-<版本>-Dev   + Mac id=ai.deskfox.app.dev   + Win id={dev GUID}*  + tag ship-dev-<版本>
              ├─ pack -Env beta → DeskFox-<版本>-Beta  + Mac id=ai.deskfox.app.beta  + Win id={beta GUID}* + tag ship-beta-<版本>
              └─ pack -Env prod → DeskFox-<版本>       + Mac id=ai.deskfox.app       + Win id={F9F6F6...}  + tag ship-prod-<版本>

* 注:Win 三档 AppId 待落地(feat/win-tri-env-appid,本文档动作计划 #5),当前 Win 仅有 prod 的 GUID
```

**打哪档 = 你定**。三档可在同一 Mac 共存(Bundle ID 独立);Win 三档 AppId 落地后也支持共存。

### D.4 Mac / Win 不对称(已知遗留)与解决路径

| | Mac | Win |
|---|---|---|
| 三档身份独立 | ✅ 已落地(2026-04-30,`bundle-id-debrand`) | ❌ 单一 AppId |
| 三档可同机共存 | ✅ | ❌ 后装替换先装 |
| 网格/启动器搜索 | prod / beta 可搜,dev 隐藏 | 都正常(Win 没那个过滤) |
| 解决路径 | 已完成 | `feat/win-tri-env-appid`(动作计划 #5,v2 切换之后立刻做) |

### D.5 真正需要 release 分支的唯一情况

当某个用户报告 prod v2.5 有 bug,你要在**不带上 v3 新功能**的前提下出 v2.5.1 hot-fix —— 那时候才从 `ship-prod-v2.5` tag 临时切一个 `hotfix/v2.5.1` 短命分支,修完直接 build prod 出 v2.5.1.exe,这个分支随后可以删掉。

→ **hot-fix 用短命分支 + tag 处理,不需要长期 release 分支。**

DeskFox 现状(2026-04-30):没有 prod 用户基数(自用 + 朋友 + 小范围),没有合规需求,ship 节奏快(7 天 ship 6 次),**永远不需要长期 release/beta 分支**。

---

## 十、修订记录

| 版本 | 日期 | 修订内容 | 修订人 |
|---|---|---|---|
| v0.1(草稿) | 2026-04-30 | 初版起草,讨论稿状态 | Claude(代笔,待笑南审定) |
| v0.2(草稿) | 2026-04-30 | 加"讨论引导"段(关注点 1/2 + 接下来怎么走)+ 附录 C(开源 PR 安全模型,源于笑南讨论提问)| Claude |
| v0.3(草稿) | 2026-04-30 | 加附录 D(三档环境与分支模型的关系)+ 动作计划 #5 补 `feat/win-tri-env-appid`(Win 三档 AppId,v2 切换之后立刻做)+ 动作计划 #1 修正(ship 调研确认只有 .2 一笔)| Claude |
| v0.4(草稿) | 2026-04-30 | 第三节"决策已敲定"补 4 条:HANDOFF 删除 / B5 mac 协作通知 / B1+B2 origin 双 push 改单推 gitee / B3 改动规则 4.3 节正式废除(同笔改 `docs/governance/改动规则.md` 4.3 节加废除说明)| Claude |
