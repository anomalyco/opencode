---
feat-id: release-mac-ci
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# release-mac-ci — Changelog

> 实施日期:2026-05-02 起
> 本笔特点:**纯新增 fork-only 文件**(不改任何上游),触动文件 ≤ 3 个,Medium 规模。

---

## 一、commit / tag 一览

| # | commit | 主题 | 行数 | 状态 |
|---|---|---|---|---|
| 1 | (本笔)| 主体:workflow + 三文档 + 索引同步 | ~600 | ⏳ 待提交 |

(commit hash 提交后回填)

---

## 二、影响范围

### 新增文件

| 文件 | 行数 | 说明 |
|---|---|---|
| `.github/workflows/release-mac-deskfox.yml` | ~190 | mac CI 主体(对照 release-deskfox.yml) |
| `docs/features/release-mac-ci/1-spec.md` | ~135 | spec(决策表 + 改动范围 + 风险) |
| `docs/features/release-mac-ci/2-plan.md` | ~75 | 实施计划 + 决策轨迹 |
| `docs/features/release-mac-ci/3-changelog.md` | ~80 | 本文档 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `docs/features/INDEX.md` | 加一行 `release-mac-ci` |
| `改动日志.md` | 加索引行 |

### 不改的(明确)

- `release-deskfox.yml`(Win)— 不动,新文件独立
- `bump-installer-version.sh` / `build-deskfox.sh` / `pack-installer.sh` — 已 work,不改
- 任何 `packages/desktop/` / `packages/branding/src/` 资源 — 0 改

### 上游侵入率影响

- 新增 fork-only 文件:6 个
- 改上游文件:**0 个**
- → 上游侵入率不变,健康

---

## 三、回归测试(待实测后填)

| 测试项 | 命令 / 操作 | 结果 |
|---|---|---|
| yaml 语法 | 肉眼 + GitHub Actions 拉 workflow 时校验 | ⏳ |
| dispatch dev 模式 | Actions UI → Run workflow → env=dev | ⏳ |
| .dmg 产物存在 | dispatch 完看 artifact | ⏳ |
| .dmg 文件名格式 | artifact 名 `DeskFox Dev-<v>_aarch64.dmg` | ⏳ |
| dispatch 不发 Release | Releases 页面无新 entry | ⏳ |
| (后续)tag 模式发 draft | push `ship-mac-prod-*` tag | ⏳ |

**release exe / installer 实测**:dispatch 跑通后,user 自取 .dmg 实装验证 Gatekeeper 流程。

---

## 四、回退方法

### 整笔回滚

```bash
git revert <commit-hash>   # 撤本笔主体 commit
```

revert 后:workflow 文件没了,push tag `ship-mac-*` 也不会触发任何东西(workflow 已删)— 安全无副作用,Win workflow 不受影响。

### 单次 release 失败

- workflow 跑挂 → 看 Actions log 排查,修后重新触发
- draft Release 出错 → GitHub UI 删 draft + 删对应 tag,本地修后重发 tag

### 不需要回退的场景

- dispatch 模式产物不满意 → 直接重跑,artifact 30 天保留期内自动覆盖

---

## 五、未结尾巴(转交后续)

| 事项 | 性质 | 状态 |
|---|---|---|
| 实测 dispatch dev 模式跑通 | 测试 | ⏳ |
| 测试通过后合 dev | 流程 | ⏳ |
| 首发 `ship-mac-prod-<v>` 出第一个 mac dmg | 真实 ship | ⏳ |
| universal binary(arm64 + x86_64)| 未来扩展 | 延后(spec 第六节)|
| 签名 / notarize | 未来扩展 | 延后(spec 第六节)|
| 统一 `ship-prod-*` 同时出 win + mac | 未来扩展 | 延后(spec 第六节)|

---

## 六、重大经验(实施完成后回填)

(待实测后回填)
