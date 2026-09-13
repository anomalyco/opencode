import { describe, expect, test } from 'bun:test';
import { LocalEmbedder } from '../src/embedder';
import { LocalVectorDB } from '../src/vector-db';
import { KnowledgeExtractor } from '../src/extractor';
import { AgentKnowledgeIntegration } from '../src/agent-integration';
import { LocalRetriever } from '../src/retriever';
import type { KnowledgeChunk } from '../src/types';

describe('Knowledge Engine (Local & Embedded)', () => {
  const embedder = new LocalEmbedder(384);

  test('LocalEmbedder normalizes Arabic & English text and outputs 384-dim normalized vector', () => {
    const textAr = 'مرحباً بك في أوبن كود OpenCode!';
    const vec = embedder.embed(textAr);
    expect(vec.length).toBe(384);

    // Verify L2 norm is ~1.0
    let sumSquares = 0;
    for (let i = 0; i < vec.length; i++) {
      sumSquares += vec[i] * vec[i];
    }
    expect(Math.abs(Math.sqrt(sumSquares) - 1.0)).toBeLessThan(0.01);

    // Cosine similarity between identical vectors should be 1.0
    const sim = LocalEmbedder.cosineSimilarity(vec, vec);
    expect(Math.abs(sim - 1.0)).toBeLessThan(0.001);
  });

  test('LocalVectorDB performs hybrid search (Vector + FTS5) with metadata filtering', () => {
    const testDbPath = '/tmp/test_knowledge_' + Date.now() + '.db';
    const db = new LocalVectorDB(testDbPath);

    const chunk1: KnowledgeChunk = {
      id: 'chunk-1',
      title: 'بدء الاستخدام',
      stage: 1,
      section: 'التثبيت والإعداد',
      content: 'لتثبيت OpenCode CLI استخدم Bun أو السكربت المخصص لبناء الأداة.',
      metadata: {
        source: 'install.md',
        type: 'lesson',
        tags: ['install', 'setup', 'tui', 'coding', 'build'],
        language: 'ar',
        difficulty: 20,
      },
    };

    const chunk2: KnowledgeChunk = {
      id: 'chunk-2',
      title: 'استكشاف الأخطاء',
      stage: 2,
      section: 'خطأ الاتصال بـ LLM',
      content: 'إذا ظهر خطأ Connection error تأكد من صحة المفاتيح وصلاحيات الشبكة.',
      metadata: {
        source: 'troubleshoot.md',
        type: 'troubleshooting',
        tags: ['error', 'troubleshooting', 'provider'],
        language: 'ar',
        difficulty: 40,
      },
    };

    const vec1 = embedder.embed(`${chunk1.title} ${chunk1.section} ${chunk1.content}`);
    const vec2 = embedder.embed(`${chunk2.title} ${chunk2.section} ${chunk2.content}`);

    db.upsertChunk(chunk1, vec1);
    db.upsertChunk(chunk2, vec2);

    // 1. Text search
    const textResults = db.textSearch('التثبيت');
    expect(textResults.length).toBeGreaterThan(0);
    expect(textResults[0].id).toBe('chunk-1');

    // 2. Hybrid search for error
    const queryVec = embedder.embed('حل مشكلة خطأ الاتصال');
    const hybridResults = db.hybridSearch('خطأ الاتصال', queryVec, { topK: 2 });
    expect(hybridResults.length).toBeGreaterThan(0);
    expect(hybridResults[0].id).toBe('chunk-2');

    // 3. Metadata filtering by type
    const filtered = db.hybridSearch('CLI', queryVec, { type: 'troubleshooting' });
    expect(filtered.every(r => r.type === 'troubleshooting')).toBe(true);

    db.close();
  });

  test('KnowledgeExtractor parses frontmatter and splits markdown into sections', () => {
    const extractor = new KnowledgeExtractor();
    const markdown = `---
title: دليل OpenCode الشامل
author: OpenCode Team
---
# مقدمة
هذا هو القسم الأول يشرح المعمارية.

## التخطيط والبناء
القسم الثاني يغطي وكلاء Plan و Build.
`;

    const { data, body } = extractor.parseFrontmatter(markdown);
    expect(data.title).toBe('دليل OpenCode الشامل');

    const sections = extractor.splitIntoSections(body, data.title);
    expect(sections.length).toBe(2);
    expect(sections[0].heading).toBe('مقدمة');
    expect(sections[1].heading).toBe('التخطيط والبناء');
  });

  test('AgentKnowledgeIntegration generates enriched context prompts with custom retriever', async () => {
    const testDbPath = '/tmp/test_rag_' + Date.now() + '.db';
    const db = new LocalVectorDB(testDbPath);
    const customRetriever = new LocalRetriever(db, embedder);

    const chunk: KnowledgeChunk = {
      id: 'chunk-build-1',
      title: 'دليل Build Agent',
      stage: 3,
      section: 'تنفيذ الأوامر البرمجية',
      content: 'يقوم وكيل البناء Build بتنفيذ الكود والتحقق من سلامة البيئة البرمجية.',
      metadata: {
        source: 'build.md',
        type: 'lesson',
        tags: ['coding', 'build', 'agent'],
        language: 'ar',
        difficulty: 60,
      },
    };

    const vec = embedder.embed(`${chunk.title} ${chunk.section} ${chunk.content}`);
    db.upsertChunk(chunk, vec);

    const enriched = await AgentKnowledgeIntegration.enrichBuildContext(
      'تنفيذ الأوامر البرمجية وتطوير الكود',
      'Context: Initializing agent',
      customRetriever
    );

    expect(enriched).toContain('KNOWLEDGE ENGINE CONTEXT');
    expect(enriched).toContain('دليل Build Agent');
    expect(enriched).toContain('تنفيذ الأوامر البرمجية');

    db.close();
  });

  test('countBySourcePrefix separates governed admissions from the raw corpus', () => {
    const testDbPath = '/tmp/test_countsrc_' + Date.now() + '.db';
    const db = new LocalVectorDB(testDbPath);
    const put = (id: string, source: string) => {
      const chunk: KnowledgeChunk = {
        id,
        title: id,
        stage: 1,
        section: 'probe',
        content: `probe content for ${id}`,
        metadata: { source, type: 'lesson', tags: [], language: 'mixed', difficulty: 1 },
      };
      db.upsertChunk(chunk, embedder.embed(chunk.content));
    };
    put('chunk-doc-1', 'guide.md');
    put('chunk-doc-2', 'spec.md');
    expect(db.countBySourcePrefix('candidate:')).toBe(0);
    put('cand-00000001', 'candidate:cand-00000001');
    expect(db.countBySourcePrefix('candidate:')).toBe(1);
    expect(db.getStats().totalChunks).toBe(3);
    db.close();
  });
});
