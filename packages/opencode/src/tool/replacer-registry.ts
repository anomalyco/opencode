export type Replacer = (content: string, find: string) => Generator<string, void, unknown>

export interface ReplacerConfig {
  name: string
  replacer: Replacer
  priority: number
  condition?: (find: string, content: string) => boolean
}

export class ReplacerRegistry {
  private replacers: ReplacerConfig[] = []

  register(config: ReplacerConfig): void {
    this.replacers.push(config)
    this.replacers.sort((a, b) => a.priority - b.priority)
  }

  getReplacers(find: string, content: string): Replacer[] {
    return this.replacers
      .filter(config => !config.condition || config.condition(find, content))
      .map(config => config.replacer)
  }

  clear(): void {
    this.replacers = []
  }
}

// Pattern analysis utilities
export namespace PatternAnalysis {
  export function isMultiline(text: string): boolean {
    return text.includes('\n')
  }

  export function hasWhitespaceVariation(text: string): boolean {
    return text !== text.trim()
  }

  export function getLineCount(text: string): number {
    return text.split('\n').length
  }

  export function hasEscapeSequences(text: string): boolean {
    return /\\[ntr'"\\`$]/.test(text)
  }

  export function isSimplePattern(find: string, content: string): boolean {
    return content.includes(find)
  }
}