import type { RetrievalResult } from './types';

/**
 * B5 — Retrieval abstention gate (HARDENING-02, OBS-RETRIEVAL-ABSTENTION-01).
 *
 * Observed defect: an out-of-domain query (e.g. Arabic gardening) returned
 * five unrelated programming chunks instead of abstaining, because hybrid
 * scores (0.65 vector + 0.35 text) can reach 0.55–0.61 on generic dev docs
 * with zero topical overlap. Absolute-score thresholds cannot separate such
 * noise: Q6's top hit (0.6097) outscored Q1's genuine top hit (0.6013).
 *
 * Minimal rule: keep the merged list only when at least one result shares a
 * substantive (non-stopword, length >= 3) token with the query, checked over
 * title + section + content + tags. Otherwise return []. The gate lives in
 * the engine (`LocalVectorDB.hybridSearch`), never in CLI display code, so
 * direct engine users and the production CLI abstain identically.
 *
 * Deliberately whole-list (not per-result filtering): ranking, top-K bounds,
 * metadata filters, and authoritative-source preference are untouched.
 * Deliberately exact-match (no stemming): predictable, and the frozen
 * evaluation set (Q1–Q6) passes without it.
 */

// English base stopwords (mirrors extraction.ts) plus interrogatives, modals,
// and pronouns that carry no topical evidence.
const EN_STOPWORDS = new Set(
  ('with from that this have will when then than into over under about after before between during through ' +
    'while where which what your their they them been were does doing because once such each other onto upon ' +
    'how whose whom should would could shall does did are is was are were been being has had having do did done ' +
    'can may might must ought the and for are but not you all any both few more most out off own same too very ' +
    'just don should now him her its our your isn aren wasn weren hasn haven doesn didn won wouldn couldn ' +
    'shouldn mustn').split(' '),
);

// Arabic function words, interrogatives, and particles: frequent, never topical.
const AR_STOPWORDS = new Set(
  ('في من على إلى عن مع هل ما ماذا كيف أين متى لماذا التي الذي الذين هذا هذه ذلك تلك هو هي هم نحن أن إن أو ثم قد ' +
    'لا لم لن كل بعض بين بعد قبل عند غير ذات دون حتى كما لكن بل أيضا جدا نحو ضد إما إذا لو لما كلما حيث حين بينما ' +
    'إنما لقد ذلك التي والذي وهل وما وكيف وأين ومتى ولماذا وهذه وهذا وذلك وتلك').split(' '),
);

const MIN_TOKEN_CHARS = 3;

/** Lowercase Unicode tokens of length >= 3 that are not stopwords. */
export function substantiveTokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/gu)) {
    if (raw.length < MIN_TOKEN_CHARS) continue;
    if (EN_STOPWORDS.has(raw) || AR_STOPWORDS.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

function resultTokens(result: RetrievalResult): Set<string> {
  return new Set(substantiveTokens(`${result.title} ${result.section} ${result.content} ${result.tags.join(' ')}`));
}

/**
 * True when at least one result shares a substantive token with the query.
 * An empty substantive query can never have evidence → false (abstain).
 */
export function hasLexicalSupport(query: string, results: ReadonlyArray<RetrievalResult>): boolean {
  const queryTokens = new Set(substantiveTokens(query));
  if (queryTokens.size === 0) return false;
  return results.some((result) => {
    for (const token of resultTokens(result)) {
      if (queryTokens.has(token)) return true;
    }
    return false;
  });
}

/**
 * Abstention gate: return results unchanged when lexically supported,
 * otherwise return [] (honest empty, not display hiding).
 */
export function applyAbstentionGate(
  query: string,
  results: ReadonlyArray<RetrievalResult>,
): RetrievalResult[] {
  return hasLexicalSupport(query, results) ? [...results] : [];
}
