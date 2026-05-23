// [fork-only] reply-actions — feishu-bridge-light 纯函数 helper
// [feat: feishu-bridge-light] 2026-05-23
//
// 收纳本 feat 的可单测纯函数,跟 message-pipeline.ts 的 IO/状态隔离:
//   - stripMentions — 从 text 里 strip 飞书 @mention 标记(/new 检测前用)
//   - (后续 Phase 2 加)parseAttachMarkers — AI reply 里 [ATTACH:path] marker
//   - (后续 Phase 3 加)parseCreateGroupMarkers — AI reply 里 [CREATE_GROUP:name] marker

/** ImMessageEvent.mentions 的子集 — 只用到 key 字段,decouple wss-client 直接依赖 */
export interface MentionRef {
  key: string
  name: string
  openId?: string
}

/**
 * 从 text 里把所有 @mention 标记 strip 掉,然后 trim。
 *
 * 飞书 IM 在 text content 里把 `@bot` 渲染成形如 `@_user_1 ...` 的占位,对应
 * `mentions[].key === "_user_1"`。`/new` 在群里以 `@bot /new` 发出时,需先 strip mention
 * 才能识别字面值。私聊里没 @ 标记,strip 后等于 trim。
 *
 * key 里理论上不含 regex 特殊字符(飞书形态 `_user_N`),但防御性转义保险。
 */
export function stripMentions(text: string, mentions: ReadonlyArray<MentionRef>): string {
  let out = text
  for (const m of mentions) {
    const escaped = m.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    out = out.replace(new RegExp(`@${escaped}\\s*`, "g"), "")
  }
  return out.trim()
}
