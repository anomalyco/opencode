import { z } from "zod";
import { Tool } from "../types";
import { getPersonalityPath, getLearningPath } from "../../config/personality";
import { appendFile, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const UpdateLearningSchema = z.object({
  personalityId: z.string().describe("معرف الشخصية (اسم الملف بدون .md)"),
  lesson: z.string().describe("الدرس أو المعلومة الجديدة التي تعلمها الوكيل"),
  category: z.string().optional().describe("تصنيف الدرس (مثال: تقنية، أسلوب، تفضيل مستخدم)"),
});

export const updateLearningTool: Tool<typeof UpdateLearningSchema> = {
  name: "update_learning",
  description: "تحديث ملف learnings.md الخاص بالشخصية بإضافة درس جديد. استخدم هذه الأداة عندما تتعلم شيئاً جديداً من المستخدم أو تكتشف خطأً قمت به.",
  schema: UpdateLearningSchema,
  execute: async ({ personalityId, lesson, category = "عام" }) => {
    const learningFile = getLearningPath(personalityId);
    
    // تأكد من وجود المجلد
    const dir = join(learningFile, "..");
    if (!existsSync(dir)) {
      await writeFile(dir, "", { flag: "wx" }).catch(() => {}); // إنشاء المجلد إذا لم يوجد
    }

    const timestamp = new Date().toISOString();
    const entry = `## ${timestamp}\n\n**التصنيف:** ${category}\n\n${lesson}\n\n---\n\n`;

    if (!existsSync(learningFile)) {
      // إنشاء الملف مع مقدمة
      const header = `# سجل التعلم - ${personalityId}\n\nهذا الملف يحتوي على جميع الدروس المستفادة وتطويرات الشخصية.\n\n---\n\n`;
      await writeFile(learningFile, header + entry, "utf-8");
    } else {
      // إضافة الدرس إلى نهاية الملف
      await appendFile(learningFile, entry, "utf-8");
    }

    return {
      success: true,
      message: `تم إضافة الدرس بنجاح إلى سجل تعلم شخصية "${personalityId}"`,
      file: learningFile,
    };
  },
};

const UpdatePersonalityProfileSchema = z.object({
  personalityId: z.string().describe("معرف الشخصية"),
  field: z.enum(["traits", "description", "systemPrompt"]).describe("الحقل المراد تعديله"),
  value: z.string().describe("القيمة الجديدة للحقل"),
  reason: z.string().optional().describe("سبب التعديل (اختياري)"),
});

export const updatePersonalityProfileTool: Tool<typeof UpdatePersonalityProfileSchema> = {
  name: "update_personality_profile",
  description: "تعديل ملف تعريف الشخصية (profile.md). استخدم بحذر لتعديل السمات، الوصف، أو system prompt بناءً على تطور الشخصية.",
  schema: UpdatePersonalityProfileSchema,
  execute: async ({ personalityId, field, value, reason }) => {
    const profileFile = getPersonalityPath(personalityId);
    
    if (!existsSync(profileFile)) {
      throw new Error(`ملف تعريف الشخصية "${personalityId}" غير موجود.`);
    }

    let content = await readFile(profileFile, "utf-8");
    const lines = content.split("\n");
    let inFrontmatter = false;
    let frontmatterEnd = 0;
    let updated = false;

    // البحث عن frontmatter وتحديث الحقل
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        if (!inFrontmatter) {
          inFrontmatter = true;
        } else {
          frontmatterEnd = i;
          break;
        }
      } else if (inFrontmatter && lines[i].startsWith(`${field}:`)) {
        lines[i] = `${field}: "${value.replace(/"/g, '\\"')}"`;
        updated = true;
        break;
      }
    }

    // إذا كان الحقل هو systemPrompt وقد لا يكون في frontmatter
    if (!updated && field === "systemPrompt") {
      // إضافة systemPrompt كقسم خاص في نهاية الملف إذا لم يوجد
      const promptSection = `\n## System Prompt\n\n${value}\n`;
      if (!content.includes("## System Prompt")) {
        content += promptSection;
        updated = true;
      } else {
        // استبدال القسم الموجود (تبسيط: إعادة كتابة القسم)
        const regex = /## System Prompt[\s\S]*?(?=##|$)/;
        content = content.replace(regex, `## System Prompt\n\n${value}\n`);
        updated = true;
      }
    }

    if (!updated) {
      throw new Error(`فشل تحديث الحقل "${field}". تأكد من وجوده في الملف.`);
    }

    await writeFile(profileFile, content, "utf-8");

    return {
      success: true,
      message: `تم تحديث حقل "${field}" لشخصية "${personalityId}" بنجاح.${reason ? ` السبب: ${reason}` : ""}`,
      file: profileFile,
    };
  },
};

const ReadPersonalityContextSchema = z.object({
  personalityId: z.string().describe("معرف الشخصية"),
});

export const readPersonalityContextTool: Tool<typeof ReadPersonalityContextSchema> = {
  name: "read_personality_context",
  description: "قراءة ملف تعريف الشخصية وملف التعلم الحاليين. استخدم هذه الأداة لمراجعة ما تعلمته أو للتأكد من صفاتك الحالية.",
  schema: ReadPersonalityContextSchema,
  execute: async ({ personalityId }) => {
    const profileFile = getPersonalityPath(personalityId);
    const learningFile = getLearningPath(personalityId);

    let profileContent = "غير متوفر";
    let learningContent = "لا توجد دروس مسجلة بعد.";

    if (existsSync(profileFile)) {
      profileContent = await readFile(profileFile, "utf-8");
    }

    if (existsSync(learningFile)) {
      learningContent = await readFile(learningFile, "utf-8");
    }

    return {
      success: true,
      profile: profileContent,
      learnings: learningContent,
      message: `تم تحميل سياق شخصية "${personalityId}"`,
    };
  },
};

export const personalityTools = [
  updateLearningTool,
  updatePersonalityProfileTool,
  readPersonalityContextTool,
];
