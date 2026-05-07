/**
 * 说明书模板
 *
 * 遵循审查指南第二部分第二章（说明书的撰写规定）。
 * 标准五章节结构。
 */

import type { TemplateParams } from "./index.js"

/**
 * 说明书完整模板
 */
export function specificationTemplate(params: TemplateParams): string {
  const inventionTitle = params.inventionTitle
  const inventionType = params.inventionType

  return `# ${inventionTitle}

## 技术领域

${params.technicalField || `[本发明涉及${inventionType === "方法" ? "一种" : "一种"}${inventionTitle}，属于[具体技术领域]。]`}

## 背景技术

${params.backgroundArt || `[请描述现有技术的状况，包括：]
[1. 现有技术方案及其局限]
[2. 现有技术存在的问题]
[3. 需要解决的技术问题]
[注意：背景技术应客观描述，不宜过度贬低现有技术]`}

## 发明内容

${params.technicalProblem || `[要解决的技术问题]`}

${params.technicalSolution || `[解决该技术问题的技术方案]`}

${params.technicalEffect || `[该技术方案带来的有益效果]`}

### 有益效果

${params.technicalEffect || `[请列举具体有益效果：]
[1. 有益效果一（对应技术特征一）]
[2. 有益效果二（对应技术特征二）]
[3. 有益效果三（对应技术特征三）]
[注意：有益效果应当与区别特征对应，有因果关系]`}

## 附图说明

${params.drawingDescription || `[如有附图，请描述各附图的内容：]
[图1 是本发明实施例的${inventionTitle}的结构示意图；]
[图2 是本发明实施例的${inventionTitle}的流程图；]
[如无附图，删除本节]`}

## 具体实施方式

${params.detailedDescription || `[以下结合附图和具体实施例对本发明作进一步详细说明。]

[实施例1]
[请详细描述至少一个具体实施方式，包括：]
[- 实施方式的整体结构/流程]
[- 各组成部分的详细描述]
[- 各组成部分之间的连接/交互关系]
[- 具体参数、条件的描述（如有）]

[实施例2]
[如有变形实施方式，在此描述]
[展示发明的不同应用场景或参数范围]

[注意：]
[- 具体实施方式应使所属技术领域的技术人员能够实现]
[- 应当对照附图进行描述]
[- 至少描述一个实施例]`}`
}

/**
 * 说明书各章节的字数参考
 */
export const SPEC_LENGTH_GUIDE = {
  technicalField: { min: 50, max: 100, label: "技术领域" },
  backgroundArt: { min: 300, max: 500, label: "背景技术" },
  inventionContent: { min: 800, max: 1500, label: "发明内容" },
  detailedDescription: { min: 1500, max: 3000, label: "具体实施方式" },
} as const
