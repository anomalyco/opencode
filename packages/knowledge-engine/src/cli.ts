#!/usr/bin/env bun
import manager from './manager';
import retriever from './retriever';

const args = process.argv.slice(2);
const command = args[0] || 'help';

async function main() {
  switch (command) {
    case 'index': {
      const targetPath = args[1];
      const res = manager.buildIndex(targetPath);
      console.log('\n📊 إحصائيات الفهرس الحالية:');
      console.log(JSON.stringify(res.stats, null, 2));
      break;
    }

    case 'search': {
      const query = args.slice(1).join(' ');
      if (!query) {
        console.error('❌ يرجى تحديد نص البحث: opencode-knowledge search <query>');
        process.exit(1);
      }
      console.log(`\n🔍 البحث عن: "${query}"...\n`);
      const results = await retriever.retrieveRelevant(query, 5);
      if (results.length === 0) {
        console.log('لم يتم العثور على نتائج.');
      } else {
        for (const r of results) {
          console.log(`\n[#${r.rank}] 📌 ${r.title} | ${r.section}`);
          console.log(`⭐ درجة التطابق: ${(r.similarity * 100).toFixed(1)}% | النوع: ${r.type} | المرحلة: ${r.stage}`);
          console.log(`🏷️ الوسوم: ${r.tags.join(', ')}`);
          console.log(`📄 المصدر: ${r.source}`);
          console.log(`📝 المحتوى:\n${r.content}`);
          console.log('─'.repeat(70));
        }
      }
      break;
    }

    case 'test': {
      await manager.testRetrieval();
      break;
    }

    case 'stats': {
      const stats = manager.getFullStats();
      console.log('\n📊 إحصائيات محرك المعرفة المحلي:');
      console.log(JSON.stringify(stats, null, 2));
      break;
    }

    case 'help':
    default: {
      console.log(`
🧠 OpenCode Local Knowledge Engine CLI

الاستخدام:
  bun run src/cli.ts index [path]     فهرسة مسار مستندات markdown
  bun run src/cli.ts search <query>   بحث هجين (Vector + FTS5) في المعرفة
  bun run src/cli.ts test             تشغيل اختبارات الاسترجاع
  bun run src/cli.ts stats            عرض إحصائيات قاعدة البيانات المحلية
      `);
      break;
    }
  }
}

main().catch(err => {
  console.error('خطأ غير متوقع:', err);
  process.exit(1);
});
