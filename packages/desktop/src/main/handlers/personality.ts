import { ipcMain } from "electron";
import { app } from "electron";
import { promises as fs } from "fs";
import path from "path";

interface PersonalityData {
  id: string;
  name: string;
  description?: string;
  traits?: string[];
  systemPrompt?: string;
  temperature?: number;
  model?: string;
}

const getPersonalitiesDir = () => {
  return path.join(app.getPath("userData"), "personalities");
};

const getAgentsDir = () => {
  return path.join(app.getPath("userData"), "agents");
};

export function registerPersonalityIpcHandlers() {
  // جلب قائمة جميع الشخصيات
  ipcMain.handle("personality:list", async (): Promise<PersonalityData[]> => {
    const dir = getPersonalitiesDir();
    try {
      await fs.mkdir(dir, { recursive: true });
      const files = await fs.readdir(dir);
      const personalities: PersonalityData[] = [];

      for (const file of files) {
        if (file.endsWith(".json")) {
          const filePath = path.join(dir, file);
          const content = await fs.readFile(filePath, "utf-8");
          const data = JSON.parse(content);
          personalities.push({
            id: file.replace(".json", ""),
            ...data,
          });
        }
      }

      return personalities;
    } catch (error) {
      console.error("فشل في جلب قائمة الشخصيات:", error);
      return [];
    }
  });

  // إنشاء شخصية جديدة
  ipcMain.handle(
    "personality:create",
    async (_event, data: Omit<PersonalityData, "id">): Promise<{ success: boolean; id?: string; error?: string }> => {
      try {
        const dir = getPersonalitiesDir();
        await fs.mkdir(dir, { recursive: true });

        const id = data.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        const filePath = path.join(dir, `${id}.json`);

        // التحقق من عدم وجود شخصية بنفس الاسم
        try {
          await fs.access(filePath);
          return { success: false, error: "شخصية بهذا الاسم موجودة بالفعل" };
        } catch {
          // الملف غير موجود، هذا جيد
        }

        await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");

        // إنشاء مجلد التعلم وملف learnings.md
        const agentsDir = getAgentsDir();
        const agentDir = path.join(agentsDir, id);
        await fs.mkdir(agentDir, { recursive: true });
        const learningFile = path.join(agentDir, "learnings.md");
        const header = `# سجل التعلم - ${data.name}\n\nهذا الملف يحتوي على جميع الدروس المستفادة وتطويرات الشخصية.\n\n---\n\n`;
        await fs.writeFile(learningFile, header, "utf-8");

        return { success: true, id };
      } catch (error) {
        console.error("فشل في إنشاء الشخصية:", error);
        return { success: false, error: String(error) };
      }
    },
  );

  // تحديث شخصية موجودة
  ipcMain.handle(
    "personality:update",
    async (_event, id: string, data: Partial<PersonalityData>): Promise<{ success: boolean; error?: string }> => {
      try {
        const dir = getPersonalitiesDir();
        const filePath = path.join(dir, `${id}.json`);

        // قراءة البيانات الحالية
        const content = await fs.readFile(filePath, "utf-8");
        const currentData = JSON.parse(content);

        // دمج البيانات الجديدة
        const updatedData = { ...currentData, ...data };

        await fs.writeFile(filePath, JSON.stringify(updatedData, null, 2), "utf-8");

        return { success: true };
      } catch (error) {
        console.error("فشل في تحديث الشخصية:", error);
        return { success: false, error: String(error) };
      }
    },
  );

  // حذف شخصية
  ipcMain.handle(
    "personality:delete",
    async (_event, id: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const dir = getPersonalitiesDir();
        const filePath = path.join(dir, `${id}.json`);
        await fs.unlink(filePath);

        // حذف مجلد التعلم المرتبط
        const agentsDir = getAgentsDir();
        const agentDir = path.join(agentsDir, id);
        try {
          await fs.rm(agentDir, { recursive: true, force: true });
        } catch {
          // تجاهل إذا لم يكن المجلد موجودًا
        }

        return { success: true };
      } catch (error) {
        console.error("فشل في حذف الشخصية:", error);
        return { success: false, error: String(error) };
      }
    },
  );

  // قراءة تفاصيل شخصية محددة
  ipcMain.handle(
    "personality:read",
    async (_event, id: string): Promise<{ success: boolean; data?: PersonalityData; learnings?: string; error?: string }> => {
      try {
        const dir = getPersonalitiesDir();
        const filePath = path.join(dir, `${id}.json`);
        const content = await fs.readFile(filePath, "utf-8");
        const data = JSON.parse(content);

        // قراءة ملف التعلم
        const agentsDir = getAgentsDir();
        const learningFile = path.join(agentsDir, id, "learnings.md");
        let learnings = "لا توجد دروس مسجلة بعد.";
        try {
          learnings = await fs.readFile(learningFile, "utf-8");
        } catch {
          // الملف غير موجود
        }

        return { success: true, data: { id, ...data }, learnings };
      } catch (error) {
        console.error("فشل في قراءة الشخصية:", error);
        return { success: false, error: String(error) };
      }
    },
  );
}
