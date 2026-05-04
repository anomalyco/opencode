---
feat-id: 数据目录-deskfox-隔离
status: spec
related: ./1-spec.md
---

# 数据目录-deskfox-隔离 — spec

> **状态**:**deferred / not-now**(2026-05-04 评估暂搁,详见下方"评估决策")
> 来源:从 `docs/legal/隐私协议.md` v0.5 待办挪入(2026-05-01 review 评估后,认定属代码层 issue,不应留在用户隐私协议里)。

## 评估决策(2026-05-04)

**决定:暂不做(Phase 1 + Phase 2 都不做)**。继续放 backlog,**等触发条件**再启动。

### 收益评估

| 好处 | 实际有多大 |
|---|---|
| 同机装 OpenCode + DeskFox 不冲突 | 受众重合度极低(DeskFox 给办公人 / OpenCode 给程序员),真同时装的 < 1%。**99% 用户 = 0 收益** |
| 品牌"完全独立"工程证据 | 数字签名 / App Store 审核都看 Bundle ID(已独立)+ 行为,不查数据目录 |
| 跟上游升级数据独立 | 上游 schema 改动几个月一次,绝大多数 add column 兼容,实际破坏概率低 |
| 商业化时干净统计(ARR / DAU)| 还没到商业化阶段,**未来再做** |
| 企业客户问"数据存哪" | B2B 才有压力,B2C 没人问 |

**结论**:好处偏理论 / 未来 / 边缘场景,对当前主受众感知 ≈ 0。

### 代价评估

**用户感知**:
- 首启重新登录所有模型方(6 个 provider 各填一遍 API key,5-10 分钟)
- 聊天历史"消失"(除非加迁移脚本,用户惊吓)

**工程**:
- 改上游 1 行根目录派生(R3 或 R4 override)
- 写 + 测迁移脚本(把 `~/.config/opencode/...` 自动搬到 `~/.config/deskfox/...`)
- 跟上游 sync 时 `Global.Path` 那行必现 conflict,每次 take ours
- 实际工时 ~4-8 小时

### 触发条件(到这些再启动)

| 触发条件 | 该做 |
|---|---|
| 用户反馈"装了 OpenCode 后 DeskFox 出问题" | ✅ 立刻 |
| 上游某次 sync 引入 schema 破坏性改动 | ✅ 立刻 |
| 决定商业化(B2B 或个人付费版) | ✅ 上线前 1 个月 |
| 用户量过 10w+ | ✅ 顺手做 |
| **以上都没出现** | ⏸️ **继续 backlog,不动** ← **当前状态** |

类比:这事像家里的备用钥匙 — 你需要它存在(spec 已落档,清楚怎么做),但**没必要现在就做出来挂墙上**。当前精力放数字签名审核 / 用户增长 / 产品反馈更值。

完整评估对话见 2026-05-04 conversation log。

## 触发原因

DeskFox 与上游 sst/opencode 当前**共用全部本地数据目录**:

| 数据 | 路径 | 代码定义 |
|---|---|---|
| auth token | `~/.local/share/opencode/auth.json` | `packages/opencode/src/auth/index.ts:9`(上游) |
| 全局 config | `~/.config/opencode/opencode.json` | `packages/opencode/src/config/config.ts:395`(上游) |
| sessions / SQLite | `~/.local/share/opencode/storage/...` + `opencode.db` | `packages/opencode/src/storage/storage.ts:230`(上游) + Rust `lib.rs:724` |
| skill cache | `~/.cache/opencode/skills` | `packages/opencode/src/skill/discovery.ts:35`(上游) |
| 全局 agent | `~/.config/opencode/agent/` | `packages/opencode/src/cmd/agent.ts:91`(上游) |
| 派生根 | 单点常量 `const app = "opencode"` | `packages/opencode/src/global/index.ts:8`(上游) |
| install_id | `~/.cache/opencode/install_id` | `packages/telemetry/src/install_id.ts:18-23`(**fork-only**) |

同机并行安装 OpenCode + DeskFox 时已知冲突:SQLite 锁竞争 / settings 互覆盖 / 同 install_id 在两端后端各计数一次 / schema 漂移可能导致数据破坏。

详细共享面扫描结论见 2026-05-01 conversation log(用户问"是否彻底分开"的评估)。

## 范围分级(可独立执行)

### Phase 1 — install_id 独立(轻量,fork-only)

- 改 `packages/telemetry/src/install_id.ts:18-23`,把 dir 从 `~/.cache/opencode/` 改成 `~/.cache/deskfox/`
- 改动量:~3 行
- R 评级:**无**(`packages/telemetry/` 整包是 fork-only,commit `ddb36829d` 创建,上游不存在,**无需 R3**)
- 用户可见影响:DeskFox 上一次启动后会生成新 UUID,后端统计上"用户数 -1 + 1"(同机器换 ID),可接受
- 收益:统计端独立,避免与上游共用 install_id 造成两端后端各计数一次

### Phase 2 — 全量数据目录隔离(重活,改上游)

- 改 `packages/opencode/src/global/index.ts:8` 把 `const app = "opencode"` 改成可派生(env / build 注入)
- 改动量:1 行根改动 + 多个派生路径自动跟随;Rust 侧 `lib.rs:724` 同步改 1 处
- R 评级:**R3**(改上游 1 行,含 FORK marker);若 `global/index.ts` 在黑名单内则升 **R4**(待查)
- 用户可见影响:DeskFox 第一次启动**重新登录所有 provider** + **重导入聊天历史**(或加迁移脚本)
- 收益:auth / sessions / config / cache / log / bin 全部跟着搬到 deskfox 命名空间,与上游零数据冲突

## 待决策

- [ ] **两档关系**:Phase 1 单独先做(用户成本零,纯统计准确性收益)?还是和 Phase 2 一起做(避免两次发布、两次"重置 install_id"惊扰用户)?
- [ ] **Phase 2 时机**:正式发布前一次性切?还是后续 minor 版本切(给用户提前通知期)?
- [ ] **迁移脚本**:Phase 2 是否提供一次性 `~/.config/opencode/` → `~/.config/deskfox/` 的自动迁移(降低用户重登录 / 重导入成本)?
- [ ] **黑名单核查**:`packages/opencode/src/global/index.ts` 是否在 `docs/governance/改动规则.md` 的黑名单内,决定 R3 还是 R4

## 验收标准(草拟,待落地时细化)

### Phase 1
- [ ] 重启后 `~/.cache/deskfox/install_id` 生成,`~/.cache/opencode/install_id` 不再被 DeskFox 写入
- [ ] 后端 telemetry 端能看到 install_id 切换(原 UUID 在最后一次心跳后停更新,新 UUID 出现)
- [ ] 上游 OpenCode 在同机继续运行,其 install_id 不被影响

### Phase 2
- [ ] DeskFox 数据全部落在 `~/.config/deskfox/` + `~/.local/share/deskfox/` + `~/.cache/deskfox/`
- [ ] 上游 OpenCode 数据全部落在原 opencode 路径,**两端互不读写**
- [ ] 同机同时打开同一项目无 SQLite 锁冲突
- [ ] (若做迁移脚本)首次启动检测旧路径数据,提示用户一键迁移

## 关联

- **协议侧落地**:`docs/legal/隐私协议.md` 附录 B "关于路径名" + "共存场景"段当前如实描述"沿用 opencode/",Phase 2 落地后需同步改写
- **上游 merge 风险**:Phase 2 改 `Global.Path` 派生根后,需在 `docs/governance/UPSTREAM-MERGE-GUIDE.md` 加 watch 项(上游若改 `app = "opencode"` 这一行需特别 review)
