// securecode compaction-language-preserve plugin.
//
// Compaction 時に生成されるサマリーが英語に引きずられる問題 (#209) への対応。
// `experimental.session.compacting` フックで context 配列に「サマリーの言語を
// 直近の会話に合わせよ」という指示を追加し、LLM 自身が直近のメッセージの言語
// (日本語/Chinese/等他) に従うよう誘導する。
//
// 言語検出ロジックは持たず、context 文中で LLM 自身に「直近のユーザー発話の
// 言語に合わせよ」と委ねる方式。CJK/多言語問わず汎用に効く。
//
// Compaction prompt 自体は差し替えない (prompt は触らず context のみ追加)
// ことで、upstream のテンプレート変更にも追従しやすくする。

import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export type CompactionLanguagePreserveOptions = {
  /**
   * Suppress the language-instruction context entry.
   * Useful for tests that only need the hook to fire.
   */
  suppressContext?: boolean
}

export const LANGUAGE_PROMPT_CONTEXT =
  "IMPORTANT: When generating the summary, write it in the same language as the most recent conversation messages. Do not switch to English if the user has been speaking Japanese, Chinese, or any other language. Preserve the conversation's language throughout."

export async function CompactionLanguagePreservePlugin(
  _input: PluginInput,
  options?: CompactionLanguagePreserveOptions,
): Promise<Hooks> {
  return {
    "experimental.session.compacting": async (_input, output) => {
      if (options?.suppressContext) return
      if (!output.context) return
      output.context.push(LANGUAGE_PROMPT_CONTEXT)
    },
  }
}
