import type { CandidateInput, CandidateKind } from './candidate';

/**
 * B2 — Candidate extraction for Phase 4B (Engineering Memory System).
 *
 * Pure, deterministic, local: takes a compaction summary text plus the
 * source session id and returns candidate inputs ready for
 * `CandidateStore.create`. No database, no I/O, no approval, no indexing —
 * B2 ends at staging (pending). Every gate below encodes the B2 review
 * policy: generalizable, not session-specific, no secrets.
 */

export interface ExtractionOptions {
  /** Units shorter than this (chars) are dropped as too thin. Default 30. */
  readonly minContentChars?: number;
  /** Flood protection for staging. Default 10. */
  readonly maxCandidates?: number;
}

const MIN_CONTENT_CHARS = 30;
const MAX_CANDIDATES = 10;
const MAX_CONTENT_CHARS = 2000;
const MAX_TITLE_CHARS = 80;
const MAX_TAGS = 4;

interface Unit {
  readonly breadcrumb: string;
  readonly text: string;
}

const HEADING = /^\s*#{1,6}\s+(.*\S)\s*$/;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/;

function splitUnits(summary: string): Unit[] {
  const units: Unit[] = [];
  let breadcrumb = '';
  let prose: string[] = [];
  const flushProse = () => {
    const text = prose.join(' ').replace(/\s+/g, ' ').trim();
    prose = [];
    if (text.length > 0) units.push({ breadcrumb, text });
  };
  for (const line of summary.split('\n')) {
    const heading = line.match(HEADING);
    if (heading) {
      flushProse();
      breadcrumb = heading[1].trim();
      continue;
    }
    const bullet = line.match(BULLET);
    if (bullet) {
      flushProse();
      units.push({ breadcrumb, text: bullet[1].replace(/\s+/g, ' ').trim() });
      continue;
    }
    if (line.trim().length === 0) {
      flushProse();
      continue;
    }
    prose.push(line.trim());
  }
  flushProse();
  return units.filter((unit) => unit.text.length > 0);
}

// Gate 3 — secrets. High precision: credentials, tokens, emails, private
// keys, user-home paths. Project-relative paths are kept (they are normal
// in engineering lessons); only home directories are dropped.
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*\S+/i,
  /\bsk-[A-Za-z0-9]{8,}\b/,
  /\bgh[ops]_[A-Za-z0-9]{8,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{8,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]+\b/,
  /\bBearer\s+\S+/i,
  /[\w.+-]+@[\w-]+\.[\w.]{2,}/,
  /~\/|\/home\/|\/Users\//,
];

function hasSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

// Gates 1+2 — session-specificity. Drops episodic units: references to a
// concrete session, first-person past-tense actions, user requests quoted as
// events, temporal deictics. Timeless statements about components pass.
const EPISODIC_PATTERNS: ReadonlyArray<RegExp> = [
  /\bses_[0-9a-f]{8,}\b/i,
  /\bsession\s+(abc\d*|#?\d+|ids?\b)/i,
  /\b(this|that|current)\s+session\b/i,
  /\bin\s+this\s+session\b/i,
  /\buser\s+(asked|said|wants?|requested|reported)\b/i,
  /\b(i|we)\s+(tried|fixed|restarted|re-ran|retried|clicked|decided|agreed|noticed)\b/i,
  /\bjust now\b/i,
  /\b(today|yesterday|this morning)\b.*\b(fixed|tried|restarted|retried|failed)\b/i,
];

function isEpisodic(text: string): boolean {
  return EPISODIC_PATTERNS.some((pattern) => pattern.test(text));
}

function classify(text: string): CandidateKind {
  if (/^(prompt template|reusable prompt|template:)/i.test(text)) return 'prompt';
  // Author intent first: a prescriptive norm stays a practice even when it
  // mentions failures in passing ("Always prefer explicit error returns").
  if (/^(always|never|prefer|avoid|ensure|make sure)\b/i.test(text)) return 'practice';
  if (/(error|fail|bug|fix|workaround|crash|broken|stack trace)/i.test(text)) return 'troubleshooting';
  if (/(instead of|make sure|ensure)/i.test(text)) return 'practice';
  return 'lesson';
}

const STOPWORDS = new Set(
  'with from that this have will when then than into over under about after before between during through while where which what your their they them been were does doing because once such each other into onto upon'.split(
    ' ',
  ),
);

function extractTags(title: string, content: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const token of `${title} ${content}`.toLowerCase().match(/[a-z0-9][a-z0-9_-]{3,}/g) ?? []) {
    if (STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    tags.push(token);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

function firstSentence(text: string): string {
  const sentence = text.split(/[.!?。\n]/, 1)[0].trim();
  const base = sentence.length > 0 ? sentence : text;
  return base.length > MAX_TITLE_CHARS ? `${base.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : base;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function extractCandidates(
  summary: string,
  sourceSession: string,
  options: ExtractionOptions = {},
): CandidateInput[] {
  const minChars = options.minContentChars ?? MIN_CONTENT_CHARS;
  const maxCount = options.maxCandidates ?? MAX_CANDIDATES;
  if (summary.trim().length === 0 || sourceSession.trim().length === 0) return [];
  const seen = new Set<string>();
  const candidates: CandidateInput[] = [];
  for (const unit of splitUnits(summary)) {
    if (candidates.length >= maxCount) break;
    const content =
      unit.text.length > MAX_CONTENT_CHARS ? `${unit.text.slice(0, MAX_CONTENT_CHARS).trimEnd()}…` : unit.text;
    if (content.length < minChars) continue;
    if (hasSecret(content)) continue;
    if (isEpisodic(content)) continue;
    const key = normalize(content);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = firstSentence(content);
    candidates.push({
      title,
      summary: unit.breadcrumb.length > 0 ? `${unit.breadcrumb}\n${content.slice(0, 300)}` : content.slice(0, 300),
      content,
      sourceSession,
      type: classify(content),
      tags: extractTags(title, content),
      extractor: 'compaction-summary/v1',
    });
  }
  return candidates;
}
