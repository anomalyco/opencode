import path from "path"

export type AutocompleteReference = {
  name: string
  path: string
  hidden?: boolean
}

export type AutocompleteFileRequest = {
  reference: AutocompleteReference | undefined
  directory: string
  query: string
  mentionDirectory: string
}

type LocalReference = AutocompleteReference & {
  source: {
    type: "local"
    path: string
  }
}

type HomeReference = LocalReference
type RootReference = LocalReference

export function createHomeReference(home: string): HomeReference {
  return {
    name: "~",
    path: home,
    source: {
      type: "local" as const,
      path: home,
    },
  }
}

export function createRootReference(root: string): RootReference {
  return {
    name: "",
    path: root,
    hidden: true,
    source: {
      type: "local" as const,
      path: root,
    },
  }
}

export function withHomeReference<Reference extends AutocompleteReference>(
  references: readonly Reference[],
  home: string,
) {
  return [createHomeReference(home), ...references.filter((reference) => reference.name !== "~")]
}

export function withRootReference<Reference extends AutocompleteReference>(
  references: readonly Reference[],
  root: string,
) {
  return [createRootReference(root), ...references.filter((reference) => reference.name !== "")]
}

export function findReferenceAlias(query: string, references: readonly AutocompleteReference[]) {
  const slash = query.indexOf("/")
  const alias = slash === -1 ? query : query.slice(0, slash)
  return references.find((item) => !item.hidden && item.name === alias)
}

export function findReferencePath(query: string, references: readonly AutocompleteReference[]) {
  if (query.startsWith("/")) {
    const reference = references.find((item) => item.name === "")
    if (!reference) return
    return {
      reference,
      query: query.replace(/^\/+/, ""),
    }
  }

  const slash = query.indexOf("/")
  const reference = findReferenceAlias(query, references)
  if (!reference) return

  if (slash === -1) {
    if (query !== "~") return
    return {
      reference,
      query: "",
    }
  }

  return {
    reference,
    query: query.slice(slash + 1),
  }
}

export function referenceMentionPath(referenceName: string, filePath: string) {
  const path = filePath.replaceAll("\\", "/").replace(/^\/+/, "")
  if (!referenceName) return `/${path}`
  return `${referenceName}/${path}`
}

export function createFileSearchRequest(
  query: string,
  baseDirectory: string,
  references: readonly AutocompleteReference[],
): AutocompleteFileRequest {
  const reference = findReferencePath(query, references)
  if (reference) return splitFileSearchRequest(reference.query, reference.reference.path, reference.reference)
  return splitFileSearchRequest(query, baseDirectory)
}

export function fileSearchMentionPath(request: AutocompleteFileRequest, filePath: string) {
  const mentionPath = joinMentionPath(request.mentionDirectory, filePath)
  if (request.reference) return referenceMentionPath(request.reference.name, mentionPath)
  return mentionPath
}

function splitFileSearchRequest(query: string, baseDirectory: string, reference?: AutocompleteReference) {
  const split = splitDirectoryQuery(query)
  return {
    reference,
    directory: path.resolve(baseDirectory, split.directory),
    query: split.query,
    mentionDirectory: split.directory,
  }
}

function splitDirectoryQuery(query: string) {
  const normalized = query.replaceAll("\\", "/")
  if (normalized.endsWith("/")) {
    return {
      directory: trimMentionPathSlashes(normalized),
      query: "",
    }
  }

  const slash = normalized.lastIndexOf("/")
  if (slash === -1) {
    return {
      directory: "",
      query: normalized,
    }
  }

  return {
    directory: trimMentionPathSlashes(normalized.slice(0, slash)),
    query: normalized.slice(slash + 1),
  }
}

function joinMentionPath(directory: string, filePath: string) {
  const prefix = trimMentionPathSlashes(directory)
  const suffix = filePath.replaceAll("\\", "/").replace(/^\/+/, "")
  if (!prefix) return suffix
  if (!suffix) return prefix
  return `${prefix}/${suffix}`
}

function trimMentionPathSlashes(filePath: string) {
  return filePath.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "")
}
