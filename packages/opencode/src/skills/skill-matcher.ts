/**
 * Claude Code Skill System - Skill Matcher
 *
 * Intelligently matches skills to user requests based on description analysis
 */

import type { SkillMetadata, SkillMatch, SkillMatchOptions } from './types'

/**
 * Common stop words to filter out during matching
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'been', 'be',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
  'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
])

/**
 * Extract keywords from text
 */
function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word))
}

/**
 * Calculate Jaccard similarity between two sets
 */
function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  const intersection = new Set([...set1].filter(x => set2.has(x)))
  const union = new Set([...set1, ...set2])

  return union.size === 0 ? 0 : intersection.size / union.size
}

/**
 * Calculate keyword overlap score
 */
function keywordOverlap(requestKeywords: string[], descriptionKeywords: string[]): number {
  const requestSet = new Set(requestKeywords)
  const descSet = new Set(descriptionKeywords)

  return jaccardSimilarity(requestSet, descSet)
}

/**
 * Check for exact phrase matches
 */
function phraseMatches(request: string, description: string): number {
  const requestLower = request.toLowerCase()
  const descLower = description.toLowerCase()

  // Extract potential key phrases (2-3 word sequences)
  const phrases = requestLower.match(/\b\w+\s+\w+(?:\s+\w+)?\b/g) || []

  const matches = phrases.filter(phrase => descLower.includes(phrase))
  return matches.length / Math.max(phrases.length, 1)
}

/**
 * Calculate context similarity based on additional hints
 */
function contextScore(
  request: string,
  description: string,
  context?: {
    currentFile?: string
    recentTools?: string[]
    projectType?: string
  }
): number {
  if (!context) return 0

  let score = 0
  const descLower = description.toLowerCase()

  // File extension matching
  if (context.currentFile) {
    const ext = context.currentFile.split('.').pop()?.toLowerCase()
    if (ext && descLower.includes(ext)) {
      score += 0.2
    }
  }

  // Tool usage matching
  if (context.recentTools && context.recentTools.length > 0) {
    const toolMatches = context.recentTools.filter(tool =>
      descLower.includes(tool.toLowerCase())
    )
    score += (toolMatches.length / context.recentTools.length) * 0.3
  }

  // Project type matching
  if (context.projectType && descLower.includes(context.projectType.toLowerCase())) {
    score += 0.3
  }

  return Math.min(score, 0.5) // Cap at 0.5
}

/**
 * Calculate trigger word boosting
 * Skills with strong trigger words like "activate when", "use for" get boosted
 */
function triggerWordBoost(description: string, request: string): number {
  const descLower = description.toLowerCase()
  const requestLower = request.toLowerCase()

  // Look for explicit trigger patterns in description
  const triggerPatterns = [
    /activate\s+(?:when|for|if)\s+([^.]+)/i,
    /use\s+(?:when|for|if)\s+([^.]+)/i,
    /invoke\s+(?:when|for|if)\s+([^.]+)/i,
  ]

  let boost = 0
  for (const pattern of triggerPatterns) {
    const match = descLower.match(pattern)
    if (match && match[1]) {
      const triggerPhrase = match[1].trim()
      // Check if request contains the trigger phrase
      if (requestLower.includes(triggerPhrase)) {
        boost += 0.3
      }
    }
  }

  return Math.min(boost, 0.4)
}

/**
 * SkillMatcher - Intelligent skill matching engine
 *
 * Analyzes user requests and matches them against skill descriptions
 * using multiple heuristics:
 * - Keyword overlap (Jaccard similarity)
 * - Phrase matching
 * - Context hints (file type, tools, project type)
 * - Trigger word analysis
 */
export class SkillMatcher {
  private debug: boolean

  constructor(debug = false) {
    this.debug = debug
  }

  /**
   * Find the best matching skills for a user request
   */
  async matchSkills(
    skills: SkillMetadata[],
    options: SkillMatchOptions
  ): Promise<SkillMatch[]> {
    const { request, minConfidence = 0.6, allowMultiple = true, context } = options

    this.log(`Matching request: "${request.substring(0, 100)}..."`)

    const requestKeywords = extractKeywords(request)
    this.log(`Extracted keywords: ${requestKeywords.join(', ')}`)

    const matches: SkillMatch[] = []

    for (const skill of skills) {
      const descriptionKeywords = extractKeywords(skill.frontmatter.description)

      // Calculate multiple similarity scores
      const keywordScore = keywordOverlap(requestKeywords, descriptionKeywords)
      const phraseScore = phraseMatches(request, skill.frontmatter.description)
      const contextSimilarity = contextScore(request, skill.frontmatter.description, context)
      const triggerBoost = triggerWordBoost(skill.frontmatter.description, request)

      // Weighted combination
      const confidence =
        keywordScore * 0.4 +
        phraseScore * 0.3 +
        contextSimilarity * 0.2 +
        triggerBoost * 0.3

      this.log(
        `Skill "${skill.frontmatter.name}": confidence=${confidence.toFixed(3)} ` +
        `(kw=${keywordScore.toFixed(2)}, ph=${phraseScore.toFixed(2)}, ` +
        `ctx=${contextSimilarity.toFixed(2)}, trig=${triggerBoost.toFixed(2)})`
      )

      if (confidence >= minConfidence) {
        // Find which keywords actually matched
        const matchedKeywords = requestKeywords.filter(kw =>
          descriptionKeywords.includes(kw)
        )

        matches.push({
          skill,
          confidence,
          reason: this.generateMatchReason(skill, confidence, matchedKeywords),
          matchedKeywords,
        })
      }
    }

    // Sort by confidence (highest first)
    matches.sort((a, b) => b.confidence - a.confidence)

    // Limit to top matches if not allowing multiple
    const result = allowMultiple ? matches : matches.slice(0, 1)

    this.log(`Found ${result.length} matching skills`)
    return result
  }

  /**
   * Match a single skill explicitly by name
   */
  async matchSkillByName(
    skills: SkillMetadata[],
    skillName: string
  ): Promise<SkillMatch | null> {
    const skill = skills.find(s => s.frontmatter.name === skillName)

    if (!skill) {
      return null
    }

    return {
      skill,
      confidence: 1.0,
      reason: `Explicitly requested skill: ${skillName}`,
      matchedKeywords: [],
    }
  }

  /**
   * Filter out skills that are already active
   */
  filterActiveSkills(
    matches: SkillMatch[],
    activeSkillNames: string[]
  ): SkillMatch[] {
    const activeSet = new Set(activeSkillNames)
    return matches.filter(m => !activeSet.has(m.skill.frontmatter.name))
  }

  /**
   * Generate a human-readable reason for the match
   */
  private generateMatchReason(
    skill: SkillMetadata,
    confidence: number,
    matchedKeywords: string[]
  ): string {
    const confidencePercent = Math.round(confidence * 100)
    const keywordList = matchedKeywords.slice(0, 5).join(', ')

    if (confidence > 0.8) {
      return `Strong match (${confidencePercent}%): keywords "${keywordList}" align well with skill description`
    } else if (confidence > 0.6) {
      return `Good match (${confidencePercent}%): found relevant keywords "${keywordList}"`
    } else {
      return `Moderate match (${confidencePercent}%): partial keyword overlap "${keywordList}"`
    }
  }

  /**
   * Debug logging
   */
  private log(message: string): void {
    if (this.debug) {
      console.log(`[SkillMatcher] ${message}`)
    }
  }
}

/**
 * Utility: Simple text similarity for quick comparisons
 */
export function calculateSimpleSimilarity(text1: string, text2: string): number {
  const keywords1 = extractKeywords(text1)
  const keywords2 = extractKeywords(text2)
  return keywordOverlap(keywords1, keywords2)
}

/**
 * Utility: Extract trigger phrases from skill description
 */
export function extractTriggerPhrases(description: string): string[] {
  const triggers: string[] = []
  const patterns = [
    /activate\s+(?:when|for|if)\s+([^.]+)/gi,
    /use\s+(?:when|for|if)\s+([^.]+)/gi,
    /invoke\s+(?:when|for|if)\s+([^.]+)/gi,
    /helpful\s+for\s+([^.]+)/gi,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(description)) !== null) {
      triggers.push(match[1].trim())
    }
  }

  return triggers
}
