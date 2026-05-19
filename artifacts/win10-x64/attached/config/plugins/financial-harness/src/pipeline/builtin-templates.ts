// builtin-templates.ts — 内置模板数据

/** 模板信息（列表查询用） */
export interface TemplateInfo {
  mod: string
  id: string
  name: string
}

/** 完整模板定义（内部使用） */
interface TemplateDefinition {
  id: string
  mod: string
  name: string
  content: string
}

const _TEMPLATES: TemplateDefinition[] = [
  {
    id: "default",
    mod: "prd",
    name: "默认 PRD 模板",
    content: `# PRD 需求文档模板

## 背景
{描述项目背景和业务场景}

## 目标
{描述产品目标和成功指标}

## 用户故事
{以用户故事格式描述需求}

## 功能需求
{详细的功能需求列表}

## 非功能需求
{性能、安全、可用性等非功能需求}

## 验收标准
{可量化的验收标准}`,
  },
  {
    id: "default",
    mod: "design",
    name: "默认架构模板",
    content: `# 架构设计文档

## 概述
{系统概述和设计目标}

## 架构
{系统架构图和说明}

## 组件设计
{各组件的职责和交互}

## 数据模型
{核心数据模型定义}

## 接口设计
{API 接口定义}

## 高可用设计
{容错、降级、限流等高可用方案}`,
  },
  {
    id: "default",
    mod: "test",
    name: "默认测试方案模板",
    content: `# 测试方案文档

## 测试目标
{测试目标和质量指标}

## 测试范围
{测试覆盖的功能范围}

## 测试用例
{测试用例列表}

## 并发场景
{并发和压力测试场景}

## 验收标准
{测试通过标准}`,
  },
]

/**
 * 获取指定模板内容
 * @returns 模板内容字符串，不存在返回 null
 */
export function getTemplate(mod: string, templateId: string): string | null {
  const tpl = _TEMPLATES.find(t => t.mod === mod && t.id === templateId)
  return tpl?.content ?? null
}

/**
 * 列出可用模板
 * @param mod 可选，按模块过滤
 */
export function listTemplates(mod?: string): TemplateInfo[] {
  const filtered = mod ? _TEMPLATES.filter(t => t.mod === mod) : _TEMPLATES
  return filtered.map(t => ({ mod: t.mod, id: t.id, name: t.name }))
}
