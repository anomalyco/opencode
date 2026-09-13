import retriever, { LocalRetriever } from './retriever';
import middleware, { KnowledgeEnrichmentMiddleware } from './middleware';
import type { RetrievalResult } from './types';

export interface PlanOutput {
  plan: string;
  objectives: string[];
  bestPractices: RetrievalResult[];
  resources: RetrievalResult[];
}

export class BuildAgentKnowledge {
  private middleware: KnowledgeEnrichmentMiddleware;
  private retriever: LocalRetriever;

  constructor(customRetriever?: LocalRetriever) {
    this.retriever = customRetriever || retriever;
    this.middleware = new KnowledgeEnrichmentMiddleware(this.retriever);
  }

  /**
   * Prepares execution payload enriched with implementation and coding knowledge
   */
  public async prepareTask(task: string, context?: string): Promise<{
    enrichedPrompt: string;
    docs: RetrievalResult[];
  }> {
    const result = await this.middleware.before({ content: task, context }, 'build');
    return {
      enrichedPrompt: result.enrichedPrompt,
      docs: result.retrievedDocs,
    };
  }

  /**
   * Automatic troubleshooting for execution errors
   */
  public async handleExecutionError(error: Error | string): Promise<string> {
    const errMsg = typeof error === 'string' ? error : error.message;
    const solutions = await this.retriever.findTroubleshootingSolution(errMsg);

    if (solutions.length === 0) {
      return `❌ خطأ في التنفيذ: ${errMsg}\n(لم يُعثر على حل مطابق في المعرفة المحلية).`;
    }

    const sol = solutions[0];
    return `
❌ خطأ في التنفيذ:
${errMsg}

✅ حل موصى به من قاعدة المعرفة:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 ${sol.title} - ${sol.section}
${sol.content}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();
  }
}

export class PlanAgentKnowledge {
  private retriever: LocalRetriever;

  constructor(customRetriever?: LocalRetriever) {
    this.retriever = customRetriever || retriever;
  }

  /**
   * Synthesizes a structured plan combining task objectives with retrieved best practices
   */
  public async generatePlan(task: string): Promise<PlanOutput> {
    const [bestPractices, strategies, relatedDocs] = await Promise.all([
      this.retriever.advancedSearch(task, { agentType: 'plan', topK: 3 }),
      this.retriever.getBestPractice(task),
      this.retriever.retrieveRelevant(task, 3),
    ]);

    const combinedDocs = [...bestPractices, ...strategies, ...relatedDocs];
    // Deduplicate by ID
    const uniqueDocs = Array.from(new Map(combinedDocs.map(d => [d.id, d])).values());

    const objectives = [
      `تحليل متطلبات المهمة بدقة: ${task}`,
      'مراجعة المعايير والأنماط المعمارية في توثيق OpenCode',
      'تحديد خطوات التنفيذ المتتابعة واختبارات السلامة',
      'توقع الأخطاء المحتملة وإعداد حلول استكشاف الأخطاء',
    ];

    const practicesText = uniqueDocs.slice(0, 4).map(d =>
      `  ✓ [${d.title} > ${d.section}]: ${d.content.replace(/\s+/g, ' ').substring(0, 150)}...`
    ).join('\n');

    const plan = `
================================================================================
📋 خطة العمل الذكية لـ: "${task}"
(مدعومة بمحرك المعرفة المحلي لـ OpenCode)
================================================================================

🎯 الأهداف المحورية:
${objectives.map(o => `  • ${o}`).join('\n')}

📚 أفضل الممارسات الموثقة المسترجعة:
${practicesText || '  (المعايير القياسية للمشروع)'}

🛣️ مسار التنفيذ المقترح:
  1. التهيئة والتحقق من البيئة وإعدادات الموفرين.
  2. كتابة واختبار الوحدات البرمجية وفق المعايير.
  3. الفحص والتكامل مع واجهات OpenCode وأدواتها.
  4. المراجعة النهائية واختبار الجودة.

💡 المراجع المعرفية المرتبطة: ${uniqueDocs.length} مستند تم الرجوع إليه.
================================================================================
    `.trim();

    return {
      plan,
      objectives,
      bestPractices: uniqueDocs.filter(d => d.type === 'lesson'),
      resources: uniqueDocs,
    };
  }
}

export default {
  BuildAgentKnowledge,
  PlanAgentKnowledge,
};
