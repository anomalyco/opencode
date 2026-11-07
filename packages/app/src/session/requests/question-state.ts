import type { QuestionCacheSnapshot } from "./question-machine"

export const QUESTION_CACHE_LIMIT = 100

// Drafts of questions whose dock unmounted unanswered, newest last. Forms answered or cancelled while their dock is
// away never come back to read theirs, so the oldest give way past the limit.
const drafts = new Map<string, QuestionCacheSnapshot>()

export const questionCache = {
  get: (key: string) => drafts.get(key),
  set(key: string, snapshot: QuestionCacheSnapshot) {
    drafts.delete(key)
    drafts.set(key, snapshot)

    if (drafts.size <= QUESTION_CACHE_LIMIT) return
    const oldest = drafts.keys().next()

    if (!oldest.done) drafts.delete(oldest.value)
  },
  delete: (key: string) => void drafts.delete(key),
}
