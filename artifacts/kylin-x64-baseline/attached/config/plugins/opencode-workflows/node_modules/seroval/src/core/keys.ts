import { serializeString } from './string';

// Used for mapping isomorphic references
export const REFERENCES_KEY = '__SEROVAL_REFS__';

export const GLOBAL_CONTEXT_REFERENCES = '$R';

const GLOBAL_CONTEXT_R = `self.${GLOBAL_CONTEXT_REFERENCES}`;

export function getCrossReferenceHeader(id?: string): string {
  if (id == null) {
    return `${GLOBAL_CONTEXT_R}=${GLOBAL_CONTEXT_R}||[]`;
  }
  return `(${GLOBAL_CONTEXT_R}=${GLOBAL_CONTEXT_R}||{})["${serializeString(
    id,
  )}"]=[]`;
}
