import retriever, { LocalRetriever } from './retriever';
import type { RetrievalResult } from './types';

export interface EnrichmentMessage {
  content: string;
  context?: string;
  metadata?: Record<string, any>;
}

export interface EnrichedResult {
  enrichedPrompt: string;
  agentType: 'build' | 'plan';
  retrievedDocs: RetrievalResult[];
  originalContent: string;
}

export class KnowledgeEnrichmentMiddleware {
  private retriever: LocalRetriever;

  constructor(customRetriever?: LocalRetriever) {
    this.retriever = customRetriever || retriever;
  }

  /**
   * Determine whether task requires Plan or Build agent based on semantic intent
   */
  public determineAgent(input: string): 'build' | 'plan' {
    const lower = input.toLowerCase();
    const planKeywords = [
      'خطط', 'خطة', 'حلل', 'قيم', 'استراتيجية', 'معمارية',
      'plan', 'strategy', 'analyze', 'architecture', 'design', 'review'
    ];
    return planKeywords.some(k => lower.includes(k)) ? 'plan' : 'build';
  }

  /**
   * Pre-execution middleware: retrieves relevant knowledge and enriches agent prompt
   */
  public async before(
    message: EnrichmentMessage,
    explicitAgent?: 'build' | 'plan'
  ): Promise<EnrichedResult> {
    const agentType = explicitAgent || this.determineAgent(message.content);

    // Retrieve relevant documents using hybrid search tailored to agent role
    const docs = await this.retriever.advancedSearch(message.content, {
      topK: 3,
      agentType,
      minSimilarity: 0.2,
    });

    let knowledgeSection = '';
    if (docs.length > 0) {
      const items = docs.map((d, i) => `
[#${i + 1}] 📌 ${d.title} > ${d.section} (تطابق: ${(d.similarity * 100).toFixed(1)}%)
المصدر: ${d.source}
المحتوى:
${d.content}
      `.trim()).join('\n\n---\n\n');

      knowledgeSection = `
================================================================================
📚 KNOWLEDGE BASE ENRICHMENT (Local OpenCode Knowledge Engine)
================================================================================
تم استرجاع المعرفة الموثقة التالية المتعلقة بطلب المستخدم:

${items}

💡 توجيهات للوكيل (${agentType.toUpperCase()} AGENT):
• اعتمد على الحقائق والأنماط والمعايير المسترجعة أعلاه كمرجع رسمي.
• لا تختلق معلومات تتعارض مع التوثيق المرفق.
================================================================================
      `.trim();
    }

    const enrichedPrompt = `
${knowledgeSection ? `${knowledgeSection}\n\n` : ''}${message.context ? `السياق السابق:\n${message.context}\n\n` : ''}طلب المستخدم:
${message.content}
    `.trim();

    return {
      enrichedPrompt,
      agentType,
      retrievedDocs: docs,
      originalContent: message.content,
    };
  }

  /**
   * Post-execution middleware: inspects output for errors and attaches troubleshooting advice
   */
  public async after(response: string): Promise<{
    finalResponse: string;
    enhancedWithSolution: boolean;
    solutionTitle?: string;
  }> {
    const lower = response.toLowerCase();
    const hasError = lower.includes('error') || lower.includes('خطأ') || lower.includes('failed') || lower.includes('فشل');

    if (hasError) {
      const solutions = await this.retriever.findTroubleshootingSolution(response);
      if (solutions.length > 0) {
        const bestSolution = solutions[0];
        const attached = `
\n\n--------------------------------------------------------------------------------
💡 مقترح استكشاف الأخطاء التلقائي (من محرك المعرفة المحلي):
📌 ${bestSolution.title} - ${bestSolution.section}
${bestSolution.content}
--------------------------------------------------------------------------------
        `.trim();

        return {
          finalResponse: `${response}\n\n${attached}`,
          enhancedWithSolution: true,
          solutionTitle: bestSolution.title,
        };
      }
    }

    return {
      finalResponse: response,
      enhancedWithSolution: false,
    };
  }
}

export default new KnowledgeEnrichmentMiddleware();
