/**
 * 案件生命周期状态机
 *
 * 定义专利案件从草稿到授权/失效的全生命周期状态转换规则。
 * 对应 CONSTITUTION 第七章第二十一条。
 */

import type { CaseStatus } from "./case-store.js"

/**
 * 合法状态转换表
 *
 * 键：当前状态 → 值：允许转换到的状态列表
 */
const VALID_TRANSITIONS: Record<string, CaseStatus[]> = {
  // 撰写阶段
  draft:              ["filed", "active", "closed"],

  // 申请阶段
  filed:              ["under_exam", "abandoned"],
  under_exam:         ["oa_issued", "allowed", "rejected"],

  // 审查阶段
  oa_issued:          ["amended", "rejected", "reexam", "closed"],
  amended:            ["allowed", "oa_issued", "rejected", "reexam"],
  allowed:            ["granted"],

  // 授权后
  granted:            ["expired", "invalidation_pending", "closed"],
  invalidation_pending: ["granted", "closed"],

  // 复审路径
  rejected:           ["reexam", "abandoned"],
  reexam:             ["under_exam", "rejected", "abandoned"],

  // 终态
  abandoned:          ["closed"],
  expired:            ["closed"],
  withdrawn:          ["closed"],

  // 向后兼容（旧状态）
  active:             ["filed", "closed", "archived"],
  closed:             ["active", "archived"],
  archived:           ["active"],
}

/**
 * 状态转换原因描述
 */
const TRANSITION_LABELS: Record<string, string> = {
  "draft→filed": "提交申请",
  "filed→under_exam": "进入实质审查",
  "under_exam→oa_issued": "收到审查意见",
  "under_exam→allowed": "准予授权",
  "oa_issued→amended": "提交修改后的答复",
  "oa_issued→rejected": "驳回",
  "amended→allowed": "准予授权",
  "amended→rejected": "驳回",
  "allowed→granted": "授权公告",
  "granted→expired": "专利到期",
  "granted→invalidation_pending": "收到无效宣告请求",
  "rejected→reexam": "提出复审请求",
  "rejected→abandoned": "放弃",
  "reexam→under_exam": "复审撤销驳回",
  "reexam→rejected": "复审维持驳回",
  "abandoned→closed": "案件关闭",
  "expired→closed": "案件关闭",
}

/**
 * 检查状态转换是否合法
 */
export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  const allowed = VALID_TRANSITIONS[from]
  if (!allowed) return false
  return allowed.includes(to)
}

/**
 * 获取当前状态可转换到的所有合法状态
 */
export function getValidTransitions(current: CaseStatus): CaseStatus[] {
  return VALID_TRANSITIONS[current] ?? []
}

/**
 * 获取状态转换的中文描述
 */
export function getTransitionLabel(from: CaseStatus, to: CaseStatus): string {
  return TRANSITION_LABELS[`${from}→${to}`] ?? `${from} → ${to}`
}

/**
 * 获取状态的中文描述
 */
export function getStatusLabel(status: CaseStatus): string {
  const labels: Record<CaseStatus, string> = {
    draft: "草稿",
    filed: "已提交",
    under_exam: "实质审查中",
    oa_issued: "收到审查意见",
    amended: "已答复/修改",
    allowed: "准予授权",
    granted: "已授权",
    rejected: "已驳回",
    reexam: "复审中",
    invalidation_pending: "无效宣告审理中",
    abandoned: "已放弃",
    expired: "已到期",
    withdrawn: "已撤回",
    active: "进行中",
    closed: "已关闭",
    archived: "已归档",
  }
  return labels[status] ?? status
}

/**
 * 验证并执行状态转换
 * @throws 如果转换不合法
 */
export function validateTransition(from: CaseStatus, to: CaseStatus): void {
  if (!canTransition(from, to)) {
    const validOptions = getValidTransitions(from).join(", ")
    throw new Error(
      `非法状态转换: ${getStatusLabel(from)} → ${getStatusLabel(to)}。` +
      `当前状态可转换为: ${validOptions}`,
    )
  }
}
