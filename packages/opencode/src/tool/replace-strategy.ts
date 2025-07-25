import { ReplacerRegistry, PatternAnalysis } from "./replacer-registry"
import * as Replacers from "./replacers"

export class ReplaceStrategy {
  private registry: ReplacerRegistry

  constructor() {
    this.registry = new ReplacerRegistry()
    this.registerDefaultReplacers()
  }

  private registerDefaultReplacers(): void {
    // Always try simple replacement first (highest priority)
    this.registry.register({
      name: 'simple',
      replacer: Replacers.SimpleReplacer,
      priority: 0,
    })

    // Line-based replacers for multiline patterns
    this.registry.register({
      name: 'lineTrimmed',
      replacer: Replacers.LineTrimmedReplacer,
      priority: 10,
      condition: (find) => PatternAnalysis.isMultiline(find) || PatternAnalysis.hasWhitespaceVariation(find)
    })

    // Block anchor for larger multiline patterns
    this.registry.register({
      name: 'blockAnchor',
      replacer: Replacers.BlockAnchorReplacer,
      priority: 20,
      condition: (find) => PatternAnalysis.getLineCount(find) >= 3
    })

    // Whitespace normalization
    this.registry.register({
      name: 'whitespaceNormalized',
      replacer: Replacers.WhitespaceNormalizedReplacer,
      priority: 30,
      condition: (find) => PatternAnalysis.hasWhitespaceVariation(find) || PatternAnalysis.isMultiline(find)
    })

    // Indentation flexible matching
    this.registry.register({
      name: 'indentationFlexible',
      replacer: Replacers.IndentationFlexibleReplacer,
      priority: 40,
      condition: (find) => PatternAnalysis.isMultiline(find) && PatternAnalysis.hasWhitespaceVariation(find)
    })

    // Escape sequence handling
    this.registry.register({
      name: 'escapeNormalized',
      replacer: Replacers.EscapeNormalizedReplacer,
      priority: 50,
      condition: (find) => PatternAnalysis.hasEscapeSequences(find)
    })

    // Trimmed boundary matching
    this.registry.register({
      name: 'trimmedBoundary',
      replacer: Replacers.TrimmedBoundaryReplacer,
      priority: 60,
      condition: (find) => PatternAnalysis.hasWhitespaceVariation(find)
    })

    // Context-aware matching for complex patterns
    this.registry.register({
      name: 'contextAware',
      replacer: Replacers.ContextAwareReplacer,
      priority: 70,
      condition: (find) => PatternAnalysis.getLineCount(find) >= 3
    })
  }

  replace(content: string, oldString: string, newString: string, replaceAll = false): string {
    if (oldString === newString) {
      throw new Error("oldString and newString must be different")
    }

    // Try simple replacement first for performance
    if (PatternAnalysis.isSimplePattern(oldString, content)) {
      if (replaceAll) {
        return content.replaceAll(oldString, newString)
      }
      const firstIndex = content.indexOf(oldString)
      const lastIndex = content.lastIndexOf(oldString)
      if (firstIndex === lastIndex && firstIndex !== -1) {
        return content.substring(0, firstIndex) + newString + content.substring(firstIndex + oldString.length)
      }
    }

    // Get applicable replacers based on pattern characteristics
    const replacers = this.registry.getReplacers(oldString, content)

    // Try each replacer in order
    for (const replacer of replacers) {
      const matches = this.collectMatches(replacer, content, oldString)
      
      if (matches.length > 0) {
        return this.applyReplacement(content, matches, newString, replaceAll)
      }
    }

    throw new Error("oldString not found in content or was found multiple times")
  }

  private collectMatches(replacer: any, content: string, find: string): string[] {
    const matches: string[] = []
    
    for (const match of replacer(content, find)) {
      if (content.includes(match)) {
        matches.push(match)
      }
    }
    
    return matches
  }

  private applyReplacement(content: string, matches: string[], newString: string, replaceAll: boolean): string {
    for (const match of matches) {
      if (replaceAll) {
        return content.replaceAll(match, newString)
      }
      
      const firstIndex = content.indexOf(match)
      const lastIndex = content.lastIndexOf(match)
      
      if (firstIndex === lastIndex && firstIndex !== -1) {
        return content.substring(0, firstIndex) + newString + content.substring(firstIndex + match.length)
      }
    }
    
    throw new Error("Match found but could not apply replacement")
  }
}