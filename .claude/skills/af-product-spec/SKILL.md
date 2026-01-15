---
name: af-product-spec
description: 生成与维护产品 SPEC.md / SPEC_CHANGELOG.md 的规范。用于需求澄清、范围控制、验收标准写作与变更记录。
user-invocable: true
---

# AF Product Spec Skill

## When to use
- 你要写/改 docs/product/SPEC.md
- 需求讨论发散，需要把结论固化
- 需要补验收标准、非目标、风险

## Output rules
- SPEC 变更必须同步写入 SPEC_CHANGELOG（按日期追加一条）
- 任何新功能点必须标注 Must/Should/Could/Won’t

## Templates
- 参考：spec-template.md（用于初始化或重构 SPEC）
