/**
 * 权利要求书模板
 *
 * 遵循审查指南第二部分第二章（权利要求书撰写规定）。
 * 按发明类型区分结构。
 */

import type { TemplateParams } from "./index.js"

/**
 * 独立权利要求模板（装置型）
 */
export function claimsTemplateApparatus(params: TemplateParams): string {
  return `## 权利要求书

1. 一种${params.inventionTitle}，其特征在于，包括：
   {{independentClaims}}

{{dependentClaims}}

---
*权利要求撰写说明：*
- 独立权利要求（第 1 项）：保护范围适中，包含必要技术特征
- 从属权利要求（第 2-N 项）：分层布局，逐级缩小保护范围
- 使用"其特征在于"引导特征部分
- 前序部分写明发明主题和用途`
}

/**
 * 独立权利要求模板（方法型）
 */
export function claimsTemplateMethod(params: TemplateParams): string {
  return `## 权利要求书

1. 一种${params.inventionTitle}方法，其特征在于，包括以下步骤：
   {{independentClaims}}

{{dependentClaims}}

---
*权利要求撰写说明：*
- 独立权利要求（第 1 项）：按步骤顺序描述方法流程
- 从属权利要求（第 2-N 项）：对步骤的细化、增加步骤、限定条件
- 方法步骤用"步骤一""步骤二"或功能描述引导`
}

/**
 * 独立权利要求模板（系统型）
 */
export function claimsTemplateSystem(params: TemplateParams): string {
  return `## 权利要求书

1. 一种${params.inventionTitle}系统，其特征在于，包括：
   {{independentClaims}}

{{dependentClaims}}

---
*权利要求撰写说明：*
- 系统权利要求描述各组成部分及其连接关系
- 可与方法权利要求对应（系统各模块对应方法各步骤）`
}

/**
 * 从属权利要求分层布局模板
 */
export function dependentClaimsLayout(): string {
  return `2. 根据权利要求1所述的${"[发明名称]"}，其特征在于，[第一层细化特征]。

3. 根据权利要求2所述的${"[发明名称]"}，其特征在于，[第二层细化特征]。

4. 根据权利要求1所述的${"[发明名称]"}，其特征在于，[可选技术特征A]。

5. 根据权利要求1所述的${"[发明名称]"}，其特征在于，[可选技术特征B]。

6. 根据权利要求3所述的${"[发明名称]"}，其特征在于，[第三层细化特征]。`
}

/**
 * 根据发明类型选择权利要求模板
 */
export function getClaimsTemplate(params: TemplateParams): string {
  switch (params.inventionType) {
    case "方法": return claimsTemplateMethod(params)
    case "系统": return claimsTemplateSystem(params)
    case "装置":
    default: return claimsTemplateApparatus(params)
  }
}
