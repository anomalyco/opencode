import path from "path"

function sliceAfterMatch(filePath: string, searchRoots: string[]) {
  const normalizedPath = filePath.replaceAll("\\", "/")
  for (const searchRoot of searchRoots) {
    const index = normalizedPath.indexOf(searchRoot)
    if (index === -1) continue
    return normalizedPath.slice(index + searchRoot.length)
  }
}

export function configEntryNameFromPath(filePath: string, searchRoots: string[]) {
  const candidate = sliceAfterMatch(filePath, searchRoots) ?? path.basename(filePath)
  const ext = path.extname(candidate)
  return ext.length ? candidate.slice(0, -ext.length) : candidate
}
