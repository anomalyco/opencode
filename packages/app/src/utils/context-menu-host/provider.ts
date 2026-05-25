// FORK: 选区菜单 SelectionProvider interface — 统一菜单 + 可插拔 Provider 架构
// [feat: office-选中加聊天] 2026-05-24
//
// 把"如何拿选区(每种格式可能不同)"和"如何拼引用块/塞 composer(永远只有一种)"两个 concern 切开,
// 后者锁死成单一真理(ContextMenuHost),前者交给 Provider。
//
// v1 仅定 `getSelection()` 同步契约,不含 `getMenuItems()`。
// 理由(详 1-spec § 范围限定):v1 仅 chat + PDF/office 两个 use case 设计 getMenuItems
// 容易拍偏接口形状,等 v2 跟 CodeMirror 一起做时 4 个真 use case 在手再扩接口才对。

/**
 * Provider 返回的选区状态。
 *
 * - text 空字符串:Host 仍开菜单,菜单项 disabled 灰显(沿用 menu-always-show-with-disabled 哲学)
 * - text 有内容、partial=true:选区不完整(例如 PDF 跨页 textLayer 懒加载),Host 显示警告 + disable "添加到聊天"
 * - rects:用来给红色 highlight overlay 画框(选区在 input 模式 textarea 拿焦点时会丢,自家 overlay 兜底)
 * - range:Host 关菜单时调 Provider.clear() 清原生选区用
 * - sourceMeta:预留 v2,例如未来引用块加"来自 xxx.docx"
 */
export type SelectionResult = {
  text: string
  rects: DOMRect[]
  range: Range | null
  partial?: boolean
  sourceMeta?: { kind: string; path?: string }
}

/**
 * SelectionProvider 接口。
 *
 * **同步契约**:getSelection() 必须同步返回。右键事件触发的那一瞬间菜单要弹,
 * async 拿选区(等 textLayer 渲染 / iframe postMessage)会让菜单晚 N ms 出现,UX 立刻烂。
 * 未来 async 源(iframe / OCR)需自己做 "loading 态菜单" UI,可能引入平行的
 * `getSelectionAsync()` 接口,不动同步主路径。
 *
 * **路由策略**(v1):first match wins。Host 按 Provider 注册顺序遍历,第一个 matches 即接管。
 * v1 唯一 Provider 是 DomSelectionProvider,无冲突;v2+ 加新 Provider 时由注册顺序决定优先级。
 */
export interface SelectionProvider {
  /** 用于 debug toast 等场合标识来源,例如 "dom" / "codemirror" / "iframe" */
  readonly providerName: string

  /** 同步判定该 Provider 是否接管 target 区域。返回 true 后 Host 调 getSelection。 */
  matches(target: Element): boolean

  /**
   * 同步取选区。
   *
   * 注:即使无选区(用户在管辖区域内右键但没拖选),也返回 SelectionResult(text 为空字符串),
   * 让 Host 仍能开菜单(disabled 状态)。返回 null 表示根本无法评估(罕见,例如 SSR 阶段)。
   */
  getSelection(target: Element): SelectionResult | null

  /** Host 关菜单时调,清原生 selection(避免选区视觉残留)。 */
  clear(): void
}
