export * from './types';
export * from './candidate';
export { extractCandidates, type ExtractionOptions } from './extraction';
export {
  decide,
  pendingReviews,
  reviewCandidate,
  toReviewView,
  type ReviewDecision,
  type ReviewView,
} from './review';
export {
  admit,
  admitCandidate,
  sweepSuperseded,
  type AdmissionDeps,
  type AdmissionReceipt,
  type AdmissionResult,
} from './admission';
export { CandidateStore, resolveCandidatesDbPath, CANDIDATES_DB_FILENAME } from './staging';
export { LocalVectorDB, resolveKnowledgeDbPath, KNOWLEDGE_DB_FILENAME } from './vector-db';
export { LocalEmbedder } from './embedder';
export { KnowledgeExtractor } from './extractor';
export { LocalRetriever, LocalRetriever as RetrievalEngine } from './retriever';
export { applyAbstentionGate, hasLexicalSupport, substantiveTokens } from './abstention';
export { AgentKnowledgeIntegration } from './agent-integration';
export { KnowledgeEngineManager } from './manager';

import manager from './manager';
import retriever from './retriever';
import integration from './agent-integration';

export default {
  manager,
  retriever,
  integration,
};
