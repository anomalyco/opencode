import extractor, { normalizeBase } from './extractor';
import { LocalVectorDB } from './vector-db';
import { LocalEmbedder } from './embedder';
import { LocalRetriever } from './retriever';
import type { IndexStats } from './types';

export class KnowledgeEngineManager {
  private db: LocalVectorDB;
  private embedder: LocalEmbedder;
  private retriever: LocalRetriever;

  constructor(dbPath?: string) {
    this.db = new LocalVectorDB(dbPath);
    this.embedder = new LocalEmbedder();
    this.retriever = new LocalRetriever(this.db, this.embedder);
  }

  /**
   * Build or rebuild the index from a documentation path.
   * - No path (default corpus): true rebuild — clear first, no orphans ever.
   * - With path: replace that tree only — idempotent, drops its deleted
   *   files, never touches other indexed trees.
   */
  public buildIndex(docsPath?: string): { count: number; stats: IndexStats } {
    console.log(`\n🔍 [Knowledge Engine] بدء استخراج المعرفة من: ${docsPath || 'المسار الافتراضي'}...`);
    const chunks = extractor.extractAll(docsPath);
    console.log(`📄 تم استخراج ${chunks.length} جزء معرفي.`);

    if (chunks.length === 0) {
      if (docsPath) this.db.deleteTree(normalizeBase(docsPath));
      console.warn('⚠️ لم يتم العثور على ملفات markdown صالحة في المسار المحدد.');
      return { count: 0, stats: this.db.getStats() };
    }

    if (docsPath) {
      this.db.deleteTree(normalizeBase(docsPath));
    } else {
      this.db.clear();
    }

    console.log('⚡ توليد الـ Dense Vectors وتحديث الفهرس الهجين (Vector + FTS5)...');
    const vectors = chunks.map(chunk => {
      const fullText = `${chunk.title} ${chunk.section} ${chunk.content} ${chunk.metadata.tags.join(' ')}`;
      return this.embedder.embed(fullText);
    });

    this.db.upsertBatch(chunks, vectors);
    console.log('✅ اكتملت الفهرسة بنجاح وبسرعة فائقة دون الحاجة لأي مفاتيح خارجية!');

    const stats = this.db.getStats();
    return { count: chunks.length, stats };
  }

  /**
   * Test retrieval system with queries
   */
  public async testRetrieval(queries?: string[]): Promise<void> {
    const testQueries = queries || [
      'how to use opencode cli',
      'plan agent vs build agent',
      'troubleshooting errors',
      'tui and terminal commands'
    ];

    console.log('\n🧪 [Knowledge Engine] بدء اختبار الاسترجاع الهجين...');
    for (const q of testQueries) {
      console.log(`\n❓ البحث عن: "${q}"`);
      const results = await this.retriever.retrieveRelevant(q, 3);
      if (results.length === 0) {
        console.log('   (لا توجد نتائج مطابقة)');
      } else {
        results.forEach(r => {
          console.log(`   [#${r.rank}] ${r.title} > ${r.section} (درجة التطابق: ${(r.similarity * 100).toFixed(1)}%)`);
          console.log(`        مقتطف: ${r.content.replace(/\s+/g, ' ').substring(0, 120)}...`);
        });
      }
    }
  }

  public getFullStats(): IndexStats {
    return this.db.getStats();
  }
}

export default new KnowledgeEngineManager();
