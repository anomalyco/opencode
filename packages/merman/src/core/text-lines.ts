export function splitDiagramLines(value: string): string[] {
  return value.split(/<br\s*\/?>/i).map((line) => line.trim())
}
