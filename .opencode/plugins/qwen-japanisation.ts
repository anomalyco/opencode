import type { Plugin } from "@opencode-ai/plugin"

export const QwenJapanisationPlugin: Plugin = async () => {
  return {
    "experimental.chat.system.transform": async (input, output) => {
      if (input.model.providerID === "qwen") {
        const LANGUAGE_INSTRUCTION = `
          IMPORTANT: You MUST respond entirely in the SAME LANGUAGE as the user's message. If the user writes in Japanese, your entire response MUST be in Japanese. If the user writes in English, your entire response MUST be in English. NEVER respond in Mandarin Chinese (中文) unless the user writes in Chinese. Japanese kanji (漢字) used as part of proper Japanese text is fine, but you MUST NOT use Simplified Chinese characters (簡体字 / 简体字) — always use the Japanese / traditional form. For example, write 経済 not 经济, 確認 not 确认, 関係 not 关系, 図 not 图, 専門 not 专门, 実装 not 实装, 変数 not 变量, 関数 not 函数, 説明 not 说明, 動作 not 动作. If you are about to emit a character whose Simplified Chinese form differs from its Japanese form, you MUST emit the Japanese form. Do NOT switch languages mid-sentence or mid-response. NEVER mix some languages in the same conversation.
        `.trim()
        if (output.system[0]) {
          output.system[0] = `${LANGUAGE_INSTRUCTION}\n\n${output.system[0]}`
          return
        }
      }
      
    },
  }
}
