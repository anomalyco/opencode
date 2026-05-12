---
name: security
description: Audit dependencies, monitor bundle size, and manage secrets compliance
---

# Security

## 检查项
- `bun audit` — 依赖漏洞检测，零高危漏洞
- bundle size — 无 >10% 异常增长
- CI Secrets — 双轨制: `OCTOPUS_X || OPENCODE_X`

## Secrets 双轨制
```
Phase 1: 新增 OCTOPUS_* Secrets（保留 OPENCODE_*）
Phase 2: 代码使用 OCTOPUS_X || OPENCODE_X fallback
Phase 3: 全量迁移完成 → 删除旧 OPENCODE_* Secrets
```

## 报告
- 安全风险清单（P1）
- 审计报告（P4: bun audit + bundle size）
- 安全验证报告（P5: Secrets 双轨）
- Canary 安全扫描（P5.5）
