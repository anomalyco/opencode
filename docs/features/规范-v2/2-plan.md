---
feat-id: 规范-v2
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 规范 v2 — plan

## 实施步骤

1. 改 `.husky/pre-commit`:THRESHOLD 200→500,加 EXCEPTION_REGEX(sprite.svg + types.ts)
2. 改 `CLAUDE.md`:
   - "完整文档链路"段重写,加三文档结构 + commit message 格式 + 规模分级
   - 加"规范修订记录"段(末尾)
3. 创建 `docs/features/INDEX.md`
4. 创建 `docs/features/规范-v2/{1-spec,2-plan,3-changelog}.md`
5. 创建 `docs/features/getbot-接入/{1-spec,2-plan,3-changelog}.md`(从老 `docs/provider-model-system.md` 拆出)
6. 删 `docs/provider-model-system.md`(已迁移)
7. 同笔 commit 走完(规范修订是原子改动)

## 决策轨迹

| 决策点 | 选项 | 取舍 | 理由 |
|---|---|---|---|
| 三文档 vs 单文件分段 | A. 文件夹 + 3 文件 / B. 单文件三段 | A | 文件级隔离更清晰,git diff 看哪部分变了一眼出 |
| 阈值放宽到多少 | 300 / 500 / 1000 | 500 | 真实 feature 中位数 200-400,500 是"该停下想想"的临界,1000 太松 |
| 老 #1-#12 是否迁移 | 全迁 / 不迁 | 不迁 | 迁移成本大,且历史条目只读价值,不动反而稳 |
| feat-id 命名风格 | snake_case / kebab-case / 中文 | 自由(语义清晰即可) | 不强制,user 习惯中文混拼 |

## 风险

- **三文档分离 → 文档分裂**:plan 写完不更新 changelog,信息脱节。**对策**:CLAUDE.md 写明"commit 后必填 3-changelog.md"
- **feat-id 命名混乱**:不强制规范容易长期失控。**对策**:INDEX.md 集中维护,每加一个 feature 就更新索引,review 时 grep 看是否一致

## 预算

- 改 hook:~10 行
- 改 CLAUDE.md:~50 行(主要是新段)
- 新 docs:~200 行(spec + plan + changelog × 2 个 feature)
- 总:~260 行,**不计**新文件(规范 v2 hook 行数预算同样豁免)

## 走过的弯路 / 中途调整

(本次直接上,无弯路)
