import { describe, expect, test } from 'bun:test';
import { KnowledgeEnrichmentMiddleware } from '../src/middleware';
import { BuildAgentKnowledge, PlanAgentKnowledge } from '../src/agents';
import { LocalVectorDB } from '../src/vector-db';
import { LocalEmbedder } from '../src/embedder';
import { LocalRetriever } from '../src/retriever';
import type { KnowledgeChunk } from '../src/types';

describe('OpenCode Agents + Knowledge Engine Integration', () => {
  const embedder = new LocalEmbedder(384);
  const testDb = new LocalVectorDB('/tmp/test_integration_' + Date.now() + '.db');
  const retriever = new LocalRetriever(testDb, embedder);
  const middleware = new KnowledgeEnrichmentMiddleware(retriever);
  const buildAgent = new BuildAgentKnowledge(retriever);
  const planAgent = new PlanAgentKnowledge(retriever);

  // Seed test database with relevant docs
  const sampleDocs: KnowledgeChunk[] = [
    {
      id: 'doc-plan-1',
      title: 'استراتيجيات المعمارية',
      stage: 1,
      section: 'تخطيط النظم',
      content: 'يجب البدء بتقسيم المهام إلى وحدات منفصلة واختبار كل وحدة قبل التكامل.',
      metadata: { source: 'arch.md', type: 'lesson', tags: ['plan', 'strategy'], language: 'ar', difficulty: 50 },
    },
    {
      id: 'doc-build-1',
      title: 'أدوات التنفيذ البرمجي',
      stage: 2,
      section: 'كتابة الأكواد',
      content: 'تأكد من استخدام معالجة الأخطاء وكتابة اختبارات الوحدة للوظائف الحساسة.',
      metadata: { source: 'code.md', type: 'lesson', tags: ['build', 'coding'], language: 'ar', difficulty: 30 },
    },
    {
      id: 'doc-error-1',
      title: 'حلول أعطال الشبكة',
      stage: 1,
      section: 'انقطاع الاتصال',
      content: 'تحقق من المتغير البيئي وصلاحيات الـ API وتأكد من استقرار الإنترنت.',
      metadata: { source: 'troubleshoot.md', type: 'troubleshooting', tags: ['error', 'troubleshooting'], language: 'ar', difficulty: 20 },
    },
  ];

  const vectors = sampleDocs.map(d => embedder.embed(`${d.title} ${d.section} ${d.content}`));
  testDb.upsertBatch(sampleDocs, vectors);

  test('Middleware accurately infers Agent intent (Plan vs Build)', () => {
    expect(middleware.determineAgent('خطط لي هيكل مشروع')).toBe('plan');
    expect(middleware.determineAgent('analyze system architecture')).toBe('plan');
    expect(middleware.determineAgent('اكتب كود دالة حسابية')).toBe('build');
    expect(middleware.determineAgent('build API endpoint')).toBe('build');
  });

  test('Build Agent prepares enriched prompt with knowledge context', async () => {
    const result = await buildAgent.prepareTask('اكتب كود معالجة الأخطاء في المشروع');
    expect(result.enrichedPrompt).toContain('KNOWLEDGE BASE ENRICHMENT');
    expect(result.enrichedPrompt).toContain('طلب المستخدم');
    expect(result.docs.length).toBeGreaterThan(0);
  });

  test('Build Agent handles error and suggests relevant troubleshooting solution', async () => {
    const solution = await buildAgent.handleExecutionError('حدث انقطاع الاتصال بالشبكة connection error');
    expect(solution).toContain('حل موصى به من قاعدة المعرفة');
    expect(solution).toContain('حلول أعطال الشبكة');
  });

  test('Plan Agent synthesizes structured plan incorporating best practices', async () => {
    const planResult = await planAgent.generatePlan('تخطيط النظم وتقسيم المهام');
    expect(planResult.plan).toContain('خطة العمل الذكية');
    expect(planResult.objectives.length).toBeGreaterThan(0);
    expect(planResult.resources.length).toBeGreaterThan(0);
  });

  test('Middleware post-execution intercepts errors and attaches troubleshooting', async () => {
    const responseWithError = 'Execution failed: error occurred in connection';
    const postResult = await middleware.after(responseWithError);
    expect(postResult.enhancedWithSolution).toBe(true);
    expect(postResult.finalResponse).toContain('مقترح استكشاف الأخطاء التلقائي');
  });
});
