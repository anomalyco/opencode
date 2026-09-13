import defaultRetriever, { LocalRetriever } from './retriever';
import type { RetrievalResult } from './types';

export class AgentKnowledgeIntegration {
  /**
   * Enrich Build Agent context with practical implementation knowledge
   */
  public static async enrichBuildContext(
    task: string,
    currentContext: string = '',
    customRetriever?: LocalRetriever
  ): Promise<string> {
    const activeRetriever = customRetriever || defaultRetriever;
    const relevantKnowledge = await activeRetriever.advancedSearch(task, {
      agentType: 'build',
      topK: 4,
    });

    if (relevantKnowledge.length === 0) {
      return currentContext;
    }

    const knowledgeText = relevantKnowledge
      .map(k => `### [${k.title}] - ${k.section}\n${k.content}`)
      .join('\n\n---\n\n');

    return `
${currentContext ? `${currentContext}\n\n` : ''}================================================================================
📚 KNOWLEDGE ENGINE CONTEXT (Local Embedded RAG)
================================================================================
${knowledgeText}
================================================================================
💡 GUIDELINES:
- Apply the implementation patterns and guidelines from the retrieved knowledge above.
- Ensure idiomatic, secure, and tested code matching the project specifications.
================================================================================
`.trim();
  }

  /**
   * Enrich Plan Agent context with architectural strategy and best practices
   */
  public static async enrichPlanContext(
    task: string,
    currentContext: string = '',
    customRetriever?: LocalRetriever
  ): Promise<string> {
    const activeRetriever = customRetriever || defaultRetriever;
    const [strategyResults, bestPractices] = await Promise.all([
      activeRetriever.advancedSearch(task, { agentType: 'plan', topK: 3 }),
      activeRetriever.getBestPractice(task),
    ]);

    const items = [...strategyResults, ...bestPractices];
    if (items.length === 0) {
      return currentContext;
    }

    const strategyText = strategyResults
      .map(s => `• 📌 **${s.title} (${s.section})**: ${s.content.substring(0, 250)}...`)
      .join('\n');

    const practicesText = bestPractices
      .map(p => `• ✨ **${p.title}**: ${p.content.substring(0, 200)}...`)
      .join('\n');

    return `
${currentContext ? `${currentContext}\n\n` : ''}================================================================================
🧠 STRATEGIC KNOWLEDGE ENGINE GUIDANCE
================================================================================
🎯 Recommended Strategy References:
${strategyText || 'None found.'}

✨ Best Practices:
${practicesText || 'Standard practices apply.'}
================================================================================
`.trim();
  }

  /**
   * Provide immediate troubleshooting solutions for errors
   */
  public static async getErrorGuidance(
    errorMessage: string,
    customRetriever?: LocalRetriever
  ): Promise<string> {
    const activeRetriever = customRetriever || defaultRetriever;
    const solutions = await activeRetriever.findTroubleshootingSolution(errorMessage);

    if (solutions.length === 0) {
      return '⚠️ لم يتم العثور على حل مطابق ومباشر في قاعدة المعرفة المحلية لهذا الخطأ.';
    }

    const guidance = solutions
      .map((s, idx) => `### ${idx + 1}. ${s.title} (${s.section})\n${s.content}`)
      .join('\n\n');

    return `
================================================================================
🛠️ KNOWLEDGE ENGINE TROUBLESHOOTING GUIDANCE
================================================================================
${guidance}
================================================================================
`.trim();
  }

  /**
   * Comprehensive guide generation on any topic
   */
  public static async generateComprehensiveGuide(
    topic: string,
    customRetriever?: LocalRetriever
  ): Promise<string> {
    const activeRetriever = customRetriever || defaultRetriever;
    const detailed = await activeRetriever.getDetailedContent(topic);

    const overview = detailed.overview.map(o => `### ${o.section}\n${o.content}`).join('\n\n');
    const practices = detailed.practices.map(p => `### ${p.section}\n${p.content}`).join('\n\n');
    const fixes = detailed.troubleshooting.map(t => `### ${t.section}\n${t.content}`).join('\n\n');

    return `
# 📖 دليل شامل: ${topic}

## 📚 نظرة عامة وشرح
${overview || 'لا يوجد محتوى مسجل.'}

## 💡 أفضل الممارسات والتنفيذ
${practices || 'لا توجد ممارسات مخصصة.'}

## ⚠️ استكشاف وحل الأخطاء
${fixes || 'لا توجد أخطاء مسجلة.'}
`.trim();
  }
}

export default AgentKnowledgeIntegration;
