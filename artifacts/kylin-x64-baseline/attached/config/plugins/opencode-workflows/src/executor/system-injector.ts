/**
 * OpenCode Workflows —— 系统提示注入抽象（SystemInjector）。
 *
 * 封装两条系统提示注入路径以应对「per-call system override 未验证」风险
 * （见 design.md 待验证依赖表）。Agent_Executor（任务 8.3）通过本抽象注入
 * plain-text / structured-output 指令，**不感知**底层走的是哪条路径：
 *
 * 1. **direct（直注路径）**：把系统提示作为 `session.prompt()` 的 `system` 入参
 *    回传（per-call system override）。任务 1.3 的 risk gate spike
 *    （`__tests__/integration/sdk-capability-spike.test.ts` 的
 *    `RISK_DECISIONS.perCallSystem`）已将该能力判定为 **VERIFIED-AVAILABLE**，
 *    故 {@link createSystemInjector} 默认采用此路径。
 * 2. **transform-hook（兜底路径）**：登记 `sessionId → systemText` 到内部注册表，
 *    由 `experimental.chat.system.transform` 回调凭 `sessionID` 查询并 unshift
 *    到 `output.system`。该路径凭 `sessionID` 关联（spike 中
 *    `RISK_DECISIONS.transformSessionId` 同为 VERIFIED-AVAILABLE），作为 direct
 *    路径不可用时的降级方案保留。
 *
 * 本模块同时导出两类内置系统提示模板（R6.5、R6.7），供 Agent_Executor 组合成每个
 * 子 Agent 的系统提示文本（结构化输出系统提示已由 SDK 原生 format:json_schema 注入，
 * 本模块不再承担 R6.6）：
 *
 * - {@link plainTextInstruction}      —— plain-text 模式：最终输出文本即返回值（R6.5）
 * - {@link FORBID_SEND_USER_MESSAGE}  —— 禁止使用 SendUserMessage（R6.7）
 *
 * @see .kiro/specs/opencode-workflows/design.md — 0. SystemInjector（系统提示注入抽象）
 * @see __tests__/integration/sdk-capability-spike.test.ts — RISK_DECISIONS.perCallSystem / transformSessionId
 * Requirements: 6.5, 6.7, 12.8
 */

// ============================================================================
// 注入模式与接口
// ============================================================================

/**
 * 系统提示注入路径。
 * - `direct`：经 `session.prompt()` 的 `system` 入参直注（per-call override，默认）；
 * - `transform-hook`：经 `experimental.chat.system.transform` hook 凭 sessionID 注入（兜底）。
 */
export type InjectionMode = "direct" | "transform-hook"

/**
 * 系统提示注入抽象。封装 direct 与 transform-hook 两条路径，上层不感知具体路径。
 */
export interface SystemInjector {
  /** 当前生效的注入路径（验证后确定） */
  mode(): InjectionMode
  /**
   * 为某子 session 准备系统提示注入：
   * - `direct`：登记到内部注册表（对称性 + 便于排查），并在返回值的 `system` 字段
   *   携带文本，供 `session.prompt()` 作为 per-call system override 透传；
   * - `transform-hook`：仅登记 `sessionId → systemText`（由
   *   `experimental.chat.system.transform` 回调消费），返回 `{}`（不带 `system` 入参）。
   */
  inject(sessionId: string, systemText: string): Promise<{ system?: string }>
  /**
   * transform-hook 路径供 `chat.system.transform` 回调查询某 session 应注入的文本；
   * 未登记 / 非 workflow 绑定的 session 返回 `undefined`。
   */
  resolve(sessionId: string): string | undefined
}

// ============================================================================
// 工厂
// ============================================================================

/**
 * 创建一个 {@link SystemInjector}。
 *
 * @param mode 注入路径，默认 `"direct"`。默认值依据任务 1.3 risk gate spike 的
 *   `RISK_DECISIONS.perCallSystem`（VERIFIED-AVAILABLE → 直注路径）确定；
 *   验证环境不支持 per-call override 时可显式传入 `"transform-hook"` 切换到兜底路径。
 */
export function createSystemInjector(mode: InjectionMode = "direct"): SystemInjector {
  const activeMode: InjectionMode = mode
  /** sessionId → 该子 session 应注入的系统提示文本。 */
  const registry = new Map<string, string>()

  async function inject(sessionId: string, systemText: string): Promise<{ system?: string }> {
    // 两条路径都登记到注册表：direct 路径登记用于对称与排查，transform-hook 路径登记供回调消费。
    registry.set(sessionId, systemText)
    if (activeMode === "direct") {
      // 直注路径：把文本作为 session.prompt() 的 per-call system 入参回传。
      return { system: systemText }
    }
    // transform-hook 路径：不回传 system 入参，由 transform 回调凭 sessionID 注入。
    return {}
  }

  function resolve(sessionId: string): string | undefined {
    return registry.get(sessionId)
  }

  function modeFn(): InjectionMode {
    return activeMode
  }

  return { mode: modeFn, inject, resolve }
}

// ============================================================================
// 内置系统提示模板（R6.5 / R6.7）
// ============================================================================

/**
 * plain-text 模式指令（R6.5）。
 *
 * 告知子 Agent：它的**最终输出文本**将被原样作为该 agent() 调用的返回值；
 * 因此应在最后直接给出结果本身，不要附带寒暄、过程说明或 Markdown 包裹。
 */
export function plainTextInstruction(): string {
  return [
    "【输出契约 · 纯文本模式】",
    "你的**最终输出文本**会被原样作为本次任务的返回值传回上层编排脚本。",
    "因此：",
    "1. 直接给出任务结果本身，不要附加寒暄、自我说明或对过程的复述；",
    "2. 不要用 Markdown 代码块或多余的标题包裹最终结果；",
    "3. 最后一条消息的正文即为返回值，请确保它是完整、可直接使用的结果。",
  ].join("\n")
}

/**
 * 禁止使用 SendUserMessage 的指令（R6.7）。
 *
 * 子 Agent 的结果通过编排脚本（返回值）传递，**不得**通过 SendUserMessage
 * 向用户/主 session 发消息——那会触发额外 LLM 轮次并绕开结果回传契约。
 */
export const FORBID_SEND_USER_MESSAGE: string = [
  "【通信约束】",
  "禁止使用 SendUserMessage（或任何向用户 / 主会话直接发送消息的等价手段）。",
  "你的执行结果只通过本次任务的返回值传回编排脚本，由脚本统一处理；",
  "直接发消息既无效（脚本不读取这类消息），也会造成不必要的额外开销。",
].join("\n")
