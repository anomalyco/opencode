import { readdirSync, readFileSync, statSync, existsSync, realpathSync } from 'fs';
import { join, basename } from 'path';
import type { KnowledgeChunk, KnowledgeMetadata } from './types';

/**
 * FNV-1a 32-bit hash → 8 hex chars. Dependency-free deterministic IDs.
 */
export function hashId(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Deterministic chunk ID: same (source, section) → same ID across runs,
 * so re-indexing REPLACEs instead of duplicating. `occurrence`
 * disambiguates repeated headings inside one file.
 */
export function chunkId(source: string, section: string, occurrence: number): string {
  return `chunk-${hashId(`${source}\n${section}\n#${occurrence}`)}`;
}

/**
 * Canonical base path: resolve symlinks (e.g. learn-opencode/docs →
 * packages/docs) and strip trailing slashes, so the same tree always
 * yields the same stored sources — a precondition for orphan cleanup.
 */
export function normalizeBase(targetPath: string): string {
  const real = existsSync(targetPath) ? realpathSync(targetPath) : targetPath;
  return real.length > 1 ? real.replace(/\/+$/, '') : real;
}

export class KnowledgeExtractor {
  private defaultBasePath: string;

  constructor(defaultBasePath: string = '/mnt/k/opencode/packages/docs') {
    this.defaultBasePath = defaultBasePath;
  }

  /**
   * Recursively collect all markdown/mdx files in a directory
   */
  public findMarkdownFiles(dir: string): string[] {
    const files: string[] = [];
    if (!existsSync(dir)) return files;

    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...this.findMarkdownFiles(fullPath));
      } else if (entry.endsWith('.md') || entry.endsWith('.mdx')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  /**
   * Parse simple frontmatter without requiring external heavy dependencies
   */
  public parseFrontmatter(content: string): { data: Record<string, any>; body: string } {
    const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
    const match = content.match(fmRegex);
    if (!match) {
      return { data: {}, body: content };
    }

    const rawYaml = match[1];
    const body = match[2];
    const data: Record<string, any> = {};

    for (const line of rawYaml.split('\n')) {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join(':').trim().replace(/^['"](.*)['"]$/, '$1');
        data[key] = value;
      }
    }

    return { data, body };
  }

  /**
   * Split document into logical sections by markdown headings
   */
  public splitIntoSections(content: string, fallbackTitle: string): Array<{ heading: string; content: string }> {
    const sections: Array<{ heading: string; content: string }> = [];
    const lines = content.split('\n');

    let currentHeading = fallbackTitle;
    let currentLines: string[] = [];

    for (const line of lines) {
      const match = line.match(/^#{1,3}\s+(.+)$/);
      if (match) {
        if (currentLines.length > 0 && currentLines.join('\n').trim()) {
          sections.push({
            heading: currentHeading,
            content: currentLines.join('\n').trim(),
          });
        }
        currentHeading = match[1].trim();
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0 && currentLines.join('\n').trim()) {
      sections.push({
        heading: currentHeading,
        content: currentLines.join('\n').trim(),
      });
    }

    return sections.length > 0 ? sections : [{ heading: fallbackTitle, content: content.trim() }];
  }

  /**
   * Detect content type
   */
  public detectType(filename: string, content: string): KnowledgeMetadata['type'] {
    const lowerName = filename.toLowerCase();
    const lowerContent = content.toLowerCase();

    if (lowerName.includes('troubleshoot') || lowerContent.includes('استكشاف الأخطاء') || lowerContent.includes('error') || lowerContent.includes('حل مشكلة')) {
      return 'troubleshooting';
    }
    if (lowerContent.includes('تمرين') || lowerContent.includes('exercise') || lowerContent.includes('تدريب') || lowerContent.includes('practice')) {
      return 'practice';
    }
    if (lowerName.includes('prompt') || lowerContent.includes('قالب') || lowerContent.includes('prompt template')) {
      return 'prompt';
    }
    return 'lesson';
  }

  /**
   * Extract meaningful semantic tags
   */
  public extractTags(content: string): string[] {
    const tags = new Set<string>();
    const lower = content.toLowerCase();

    if (lower.includes('plan') || lower.includes('خطة') || lower.includes('تخطيط')) tags.add('plan');
    if (lower.includes('build') || lower.includes('بناء') || lower.includes('تنفيذ')) tags.add('build');
    if (lower.includes('agent') || lower.includes('وكيل')) tags.add('agent');
    if (lower.includes('code') || lower.includes('كود') || lower.includes('برمجة')) tags.add('coding');
    if (lower.includes('tui') || lower.includes('terminal')) tags.add('tui');
    if (lower.includes('mcp') || lower.includes('protocol')) tags.add('mcp');
    if (lower.includes('api') || lower.includes('provider')) tags.add('provider');
    if (lower.includes('error') || lower.includes('خطأ') || lower.includes('bug')) tags.add('troubleshooting');
    if (lower.includes('prompt') || lower.includes('موجه')) tags.add('prompt');
    if (lower.includes('rag') || lower.includes('search') || lower.includes('vector')) tags.add('rag');

    return Array.from(tags);
  }

  /**
   * Extract knowledge chunks from a specified path
   */
  public extractAll(targetPath?: string): KnowledgeChunk[] {
    const basePath = normalizeBase(targetPath || this.defaultBasePath);
    const chunks: KnowledgeChunk[] = [];
    const files = this.findMarkdownFiles(basePath);

    for (const filePath of files) {
      try {
        const rawContent = readFileSync(filePath, 'utf-8');
        const { data, body } = this.parseFrontmatter(rawContent);
        const fileName = basename(filePath);
        const docTitle = data.title || fileName.replace(/\.(md|mdx)$/, '');

        // Infer stage from directory structure or filename if present
        let stage = 1;
        const stageMatch = filePath.match(/(\d+)-[a-zA-Z0-9_-]+/);
        if (stageMatch) {
          stage = parseInt(stageMatch[1], 10);
        }

        const occurrence = new Map<string, number>();
        const sections = this.splitIntoSections(body, docTitle);
        for (let i = 0; i < sections.length; i++) {
          const sec = sections[i];
          const occ = occurrence.get(sec.heading) || 0;
          occurrence.set(sec.heading, occ + 1);
          chunks.push({
            id: chunkId(filePath, sec.heading, occ),
            title: docTitle,
            stage,
            section: sec.heading,
            content: sec.content,
            metadata: {
              source: filePath,
              type: this.detectType(fileName, sec.content),
              tags: this.extractTags(sec.content),
              language: /[\u0600-\u06FF]/.test(sec.content) ? 'ar' : 'en',
              difficulty: Math.min(100, Math.max(10, stage * 20)),
            },
          });
        }
      } catch (err) {
        console.error(`Error reading ${filePath}:`, err);
      }
    }

    return chunks;
  }
}

export default new KnowledgeExtractor();
