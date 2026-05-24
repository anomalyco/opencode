# 双端协作 SOP — feat 分支生命周期 + Win/Mac 协作流程

> **状态**:活规则,2026-04-30 起生效
> **适用范围**:DeskFox(opencode-fork)分支策略 v2 模型下,Win 端(DeskFox官方)与 Mac 端(DeskFox 协作方)双端协作的日常开发流程
> **前置阅读**:[`docs/features/分支策略-v2/1-spec.md`](../features/分支策略-v2/1-spec.md)(v2 模型本身)
> **作者视角**:本文用大白话写,面向**非研发的项目主理人**和**协作 agent**;命令直接给可复制的形式

---

## TL;DR(一句话规则)

> **feat 分支 = 一次性容器。合 main = 销毁。新项目 = 新名字。**

类比:**一次性会议室**。开完一场会就退订,下一场会新订一间。不会因为"反正还是这间空着"就把上一场和下一场堆在同一间里。

---

## 一、feat 分支生命周期(核心规则)

### 1.1 三段式生命

```
[创建]  从最新 main 切分支  →  feat/<语义清晰的名字>
   ↓
[使用]  自己开发 + push 到 origin/feat/X  →  开发期间允许多次 commit / push
   ↓
[销毁]  合 main 后立刻删本地 + 远端  →  分支名彻底回收
```

**三段不可省**:
- 创建必须从 `main` 切,不能从别的 feat 切(那叫"借鸡生蛋",会让历史拓扑乱)
- 销毁必须立刻做(不要"留着以后再用"),否则该分支名就报废了

### 1.2 分支命名规范

```
<type>/<name>
```

**type 部分(全小写)**:

| type | 用途 |
|---|---|
| `feat` | 新功能 / 重构 / 大多数日常工作 |
| `fix` | bug 修复(可独立时用,功能附带的 fix 仍走 feat) |
| `chore` | 维护性改动(依赖更新等) |
| `sync` | 上游同步(`sync/upstream-<日期>`) |
| `hotfix` | 紧急修复(从 `ship-prod-<版本>` tag 切短命分支) |

> **本项目 commit message 仍统一用 `[feat: <id>]` tag**,不引入 `[doc:]` `[fix:]` 等。type 前缀只用在分支名,不影响 commit tag。

**name 部分,5 条硬规则**:

1. **全小写** — `feat/win-tri-env-appid` ✅ / `feat/Win-Tri-Env-AppId` ❌
2. **kebab-case**(中划线分词) — `feat/双端协作-sop` ✅ / `feat/双端协作_sop`(下划线)❌ / `feat/doubleEndCollab`(camelCase)❌
3. **不用大写缩写** — `feat/双端协作-sop` ✅ / `feat/双端协作-SOP` ❌
4. **中英混合 OK,英文部分必须小写**(对齐规范 v2 的 feat-id 命名风格)
5. **名字反映"做什么"不反映"谁做"** — `feat/win-tri-env-appid` ✅ / `feat/laoli-task` ❌

**为什么必须全小写?(行业常规)**

Linux 默认 case-sensitive(`feat/SOP` 与 `feat/sop` 是两个分支),Windows / macOS HFS+ 默认 case-insensitive(同一分支)。三端协作时大小写不统一会出"幽灵分支":

> **实战踩坑**(2026-04-30 立本规则的当天):本 SOP 首笔 commit 起初用了 `feat/双端协作-SOP`(大写),发现踩中规则,执行 `git branch -m feat/双端协作-SOP feat/双端协作-sop` 改小写时,Windows 下 git 直接报 `fatal: a branch named 'feat/双端协作-sop' already exists` —— 因为 case-insensitive FS 把两个名字视为同一分支。最终用两步法绕开(`git branch -m <中间名>` → `git branch -m <目标名>`)。**新分支起名时第一步就用小写,可省掉这个绕路**。

**绝不复用**:`feat/A` 销毁后,新项目即使内容相关也用新名字(如 `feat/A-v2`、`feat/A-followup`)

**关于文件名 / 路径 / 文档命名的大小写**:**不在本 SOP 范围**。本节只规定 git 分支名命名。仓库内文件名(如 `UPSTREAM-MERGE-GUIDE.md` / `STATUS.md` / `双端协作-SOP.md`)历史上没有统一规则,**保持现状**。文件名层级真正会出问题的是"同目录下两个文件名只差大小写"(跨平台冲突),那是 hook 层规则,详见 [`改动规则.md` 4.4 节(大小写冲突检查)](改动规则.md#44-大小写冲突检查跨平台)。

### 1.3 反例:为什么不能复用

历史上 `feat/editable-file-viewer` 名字盖不住实际范围(里面塞了 file-viewer / GetBot / installer / md-viewer / privacy 一大堆),就是"feat 不删掉、一直加"的反面教材。详见 [`分支策略-v2/1-spec.md`](../features/分支策略-v2/1-spec.md) 第 1.1 节。

复用的三个具体危害:

1. **diff 算不清** —— git 不会自动知道"老内容已经合过 main 了",老 + 新混在一起,合 main 时容易重算或冲突
2. **名字撒谎** —— 一个 feat 名字对应一件事是基本契约,复用就破契约,后续看 git log 看不出"这段时间在做什么"
3. **历史拓扑乱** —— 多个语义无关的项目挤在同一分支,review / 回滚 / cherry-pick 都变难

---

## 二、单人开发流程(DeskFox官方或DeskFox 协作方一人独立工作时)

### 2.1 完整 5 步

```bash
# === Step 1:从最新 main 切新 feat ===
git checkout main
git pull origin main
git checkout -b feat/<新名字>
git push -u origin feat/<新名字>

# === Step 2:在 feat 上开发,允许多次 commit / push ===
# (正常写代码、commit、push)
git add . && git commit -m "..."
git push origin feat/<新名字>

# === Step 3:开发完成,准备合 main 前最后一次同步 main ===
git fetch origin
git checkout feat/<新名字>
git rebase origin/main                      # 跟上 main 最新基线(如果对方合了东西)
# 有冲突就解,然后 git rebase --continue
git push --force-with-lease origin feat/<新名字>   # rebase 改了历史,要强推

# === Step 4:合到 main ===
git checkout main
git pull origin main                        # 再确认最新
git merge --no-ff feat/<新名字> -m "merge feat/<新名字> into main"
git push origin main

# === Step 5:销毁 feat 分支 ===
git branch -d feat/<新名字>                 # 删本地
git push origin --delete feat/<新名字>      # 删远端
```

### 2.2 开始下一个项目

回到 Step 1,起**新名字**(不是 feat/A 又开 feat/A)。

---

## 三、双端同时开发流程(DeskFox官方 + DeskFox 协作方)

### 3.1 场景假设

- DeskFox官方在 Win 端开 `feat/win-tri-env-appid`(以下简称 feat/A)
- DeskFox 协作方在 Mac 端开 `feat/macos-icon-fix`(以下简称 feat/B)
- 两人**同时进行**,各自推自己的 feat 到 origin

### 3.2 协作流程图

```
两人都从 main 切分支(分支名不同)
            │
        ┌───┴───┐
        │       │
     feat/A  feat/B    (各自独立开发,互不影响)
        │       │
        ▼       │
       合 main   │
        │       │
        ▼       ▼
       main ←(rebase)─ feat/B   (后合的 rebase 跟上)
                │
                ▼
              合 main
```

### 3.3 详细步骤

**Step 1:开工前约定分支名(关键!)**

通过微信 / 飞书 / 任何渠道同步:
- DeskFox官方:"我开 `feat/win-tri-env-appid`"
- DeskFox 协作方:"我开 `feat/macos-icon-fix`"

**绝不能重名**(即使是同一个语义,也要协商谁主、谁副)。

**Step 2:各自从最新 main 切分支**(单人流程 Step 1 一样)

**Step 3:各自开发,各自 push 自己的 feat**

互不影响,因为分支名不同。

**Step 4:谁先做完谁先合(假设DeskFox官方先)**

DeskFox官方走完单人流程的 Step 3-5(rebase + 合 main + 删分支),**完成后通知DeskFox 协作方**:
> "main 更新了,我合了 feat/A,你 rebase 一下。"

**Step 5:后合的人(DeskFox 协作方)必须先 rebase 跟上 main,再合**

```bash
git fetch origin
git checkout feat/B
git rebase origin/main                      # 把 feat/B 重新接到新 main 后面
# 有冲突就解(谁 rebase 谁解),git rebase --continue
git push --force-with-lease origin feat/B  # 强推自己的 feat
```

然后走单人流程 Step 4-5(合 main + 删分支)。

---

## 四、三个常见坑

### 4.1 后合的人忘记 rebase,直接 merge

**症状**:main 历史拓扑变成"分叉合流"型(像河流交汇),功能没问题但难看。

**避免**:每次合 main 前,**先在 feat 上 `git rebase origin/main` 一次**,再合。

**已经发生了怎么办**:不影响代码功能,下不为例即可。main 上不要 force push 改历史。

### 4.2 两人改了同一个文件

**症状**:rebase 时报冲突。

**处理**:谁 rebase 谁解(因为是你接到对方的工作之上)。

```bash
# rebase 报冲突时
git status                                 # 看哪些文件冲突
# 编辑冲突文件,删除 <<<<<<< / ======= / >>>>>>> 标记,留下你想要的版本
git add <冲突文件>
git rebase --continue
```

**实在解不动**:
```bash
git rebase --abort                         # 撤销 rebase,回到 rebase 前
```
然后跟对方协调,或者把自己的改动重做一份手动应用到新 main 上。

### 4.3 强推 feat 之后没通知对方

**症状**:罕见 —— 如果对方碰巧 checkout 了你的 feat 分支,会看到 "diverged" 错误。

**避免**:**feat 分支默认只有所有者一人改**,别人不要 checkout。如果协作模式真的需要两人在同一 feat 上工作,需要单独约定(本 SOP 不覆盖)。

---

## 五、特殊情况

### 5.1 feat 做到一半暂停(以后还要继续)

**先别删分支**。可以正常 push 到 origin 保留进度,过段时间继续:

```bash
git checkout main
git pull
git checkout feat/X
git rebase origin/main                      # 跟上 main 最新基线
# 接着开发
```

### 5.2 feat 半截放弃(决定不做了)

直接销毁:
```bash
git checkout main
git branch -D feat/X                       # 大写 D = 强删,即使没合也能删
git push origin --delete feat/X            # 删远端
```

**不要"留着以备万一"** —— 留着会让分支列表越来越乱。如果几个月后真又想做了,从 main 切新分支重做即可(老 commit 实在有用,可以 cherry-pick 回新分支)。

### 5.3 feat 中途想改方向(比如 feat/A 做着发现要拆成 feat/A1 + feat/A2)

**正确做法**:
1. 把当前 feat/A 的进度合到 main(如果到一个稳定节点)
2. 销毁 feat/A
3. 从 main 切 feat/A1 做第一部分,合 main,销毁
4. 从 main 切 feat/A2 做第二部分,合 main,销毁

**不要**直接把 feat/A 改名为 feat/A1 然后再切个 feat/A2 出来 —— 这会让两个 feat 共享 base,违反"一个 feat 一件事"原则。

### 5.4 main 上的小补丁(DeskFox官方 / DeskFox 协作方都允许直推 main)

**适用情形**(且仅限这些):

- typo / 错别字修复(注释 / 文档 / commit message 拼写)
- 单行注释补充 / 措辞润色
- 已合并 commit 的 message 补全(回填 commit hash 等)
- 单文件 ≤ 10 行的纯文档改动

**为什么允许**:这种"立 feat → push → merge → 删 feat"四步成本远大于改动本身,流程开销 > 价值。v2 模型 4.3 节已废除"禁止直 push main"硬规则(详见 [`改动规则.md` 4.3 节](./改动规则.md#43-强制-feature-分支2026-04-30-起正式废除)),本节是把"什么算小到可以直推"的边界写明。

**操作**:

```bash
git checkout main
git pull origin main                        # 先确认最新
# 改文件
git add . && git commit -m "docs(<scope>): <说明> [feat: <相关-feat-id>]"
git push origin main
```

**反例**(必须立 feat,不许直推 main):

- 任何代码改动(`.ts` / `.tsx` / `.rs` / `.ps1` / `.sh` 等)
- 跨多文件的文档改动(≥ 3 个文件)
- 配置改动(`.iss` / `tauri.conf.json` / `.husky/*` 等)
- 新增功能 / 重构 / bug fix(无论多小)

**约定上限**:同一天直推 main ≤ 3 笔。超过说明"小补丁"判断错了,后续应该立 feat 攒着合。

---

## 六、协作约定(沟通层)

| 场景 | 约定 |
|---|---|
| 开新 feat 前 | 微信 / 飞书一句话告知名字,避免重名 |
| 合 main 之后 | 通知对方"main 更新了,记得 rebase" |
| feat rebase 后强推 | 如果对方有 checkout 你的 feat(罕见),需告知"我刚 rebase 强推了 feat/X" |
| main 上发现冲突难解 | 不要硬上 —— 拉个语音或视频协商,谁来主、谁来让 |
| 切分支策略变化 | 修改本 SOP 文档,commit message 标 `[feat: 双端协作-sop]`(本项目统一 tag,不引入 `[doc:]`),改完通知对方 |

---

## 七、命令速查表

| 操作 | 命令 |
|---|---|
| 起新 feat | `git checkout main && git pull && git checkout -b feat/X && git push -u origin feat/X` |
| 跟上 main 最新基线 | `git fetch origin && git rebase origin/main` |
| 强推自己 feat(rebase 后) | `git push --force-with-lease origin feat/X` |
| 合 feat 到 main | `git checkout main && git pull && git merge --no-ff feat/X -m "merge feat/X" && git push origin main` |
| 销毁 feat | `git branch -d feat/X && git push origin --delete feat/X` |
| 解 rebase 冲突 | 编辑冲突文件 → `git add <文件> && git rebase --continue` |
| 撤销 rebase | `git rebase --abort` |
| 看当前分支状态 | `git status && git branch -vv` |

---

## 八、与其他文档的关系

| 文档 | 关系 |
|---|---|
| [`docs/features/分支策略-v2/1-spec.md`](../features/分支策略-v2/1-spec.md) | v2 模型本身的设计与决策(为什么稳定主干 / sync 分支 / 三档环境)。本 SOP 是 v2 模型的**操作落地**。注:v2 spec 写作时主分支叫 `dev`,2026-05-21 起改名 `main`(详 `feat/rename-dev-to-main` changelog),spec 文档作为历史快照不回填 |
| [`docs/governance/改动规则.md`](./改动规则.md) | 白黑名单 / hook / diff 阈值 — 是"哪些文件能改"的层级。本 SOP 是"分支怎么走"的层级,两者正交 |
| [`docs/governance/fork-跟随升级与协作规范.md`](./fork-跟随升级与协作规范.md) | 治理总纲 — 五条设计原则(P1-P5)+ 四条规范(R1-R4)。本 SOP 是其中"协作流程"维度的展开 |
| [`docs/governance/UPSTREAM-MERGE-GUIDE.md`](./UPSTREAM-MERGE-GUIDE.md) | 与上游 anomalyco/opencode 合并(`sync/upstream-<日期>` 分支)。本 SOP 不覆盖 upstream 同步,那是另一个流程 |
| [`CLAUDE.md`](../../CLAUDE.md) | agent 启动必读 — "默认仓库约定"段会指向本 SOP |

---

## 九、修订记录

| 版本 | 日期 | 修订内容 |
|---|---|---|
| v1.0 | 2026-04-30 | 初版立稿,起源于 v2 模型锁版后DeskFox官方追问"feat 合并后下个项目用同名还是新名"。结论:**feat 一次性容器,新项目新名字**。同笔加 5 处引用点(CLAUDE.md / 治理总纲 / 分支策略-v2/2-plan / docs/README / 改动日志) |
| v1.1 | 2026-04-30 | 1.2 节扩"分支命名规范":加 type 前缀清单(feat/fix/chore/sync/hotfix)+ 5 条 name 硬规则(**全小写 + kebab-case**)+ 立规则当天踩坑实录(case-insensitive FS 上同名只大小写不同会冲突)。**第六节 `[doc:]` tag 改回 `[feat:]` 统一**(本项目 commit tag 仅用 `[feat:]`,不引入 `[doc:]`,理由:仓库历史 100% 一致性优先)。本笔 commit `[feat: 双端协作-sop]`(分支已对齐小写)|
| v1.2 | 2026-04-30 | review 后补丁(7 处):① 1.2 节末加"文件名大小写不在本 SOP 范围"+ 双向交叉引用 → [`改动规则.md` 4.4 节](./改动规则.md#44-大小写冲突检查跨平台);② 新增 **5.4 节"main 上的小补丁"** 明确 typo/错别字/commit message 回填等小补丁DeskFox官方 / DeskFox 协作方都允许直推 main,边界 + 操作 + 反例 + 同日上限 3 笔;③ CLAUDE.md 同笔修复两处 stale 描述(`feat/win-tri-env-appid` 已落地 `21c3f80f9`,R3 段 + 文档链路表);④ CLAUDE.md 默认仓库约定段补"<name> 全小写 + kebab-case"短规则(指向本节);⑤ 改动规则 4.4 节加交叉引用回本 1.2 节(双向引用闭环)|
