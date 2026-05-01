---
feat-id: 数据目录-deskfox-隔离
status: spec
related: ./1-spec.md
---

# 数据目录-deskfox-隔离 — spec

> **状态**:**backlog**(spec 已落,实施未启动)。从 `docs/legal/隐私协议.md` v0.5 待办挪入(2026-05-01 review 评估后,认定属代码层 issue,不应留在用户隐私协议里)。

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
