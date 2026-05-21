import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';

// تحديد مسار مجلد الوكلاء
const AGENTS_DIR = path.join(process.cwd(), '.opencode', 'agents');

/**
 * أداة لتحديث ملف التعلم الخاص بالوكيل.
 * يستخدمها الوكيل لتسجيل الدروس المستفادة أو التصحيحات.
 */
export const updateLearningTool = {
  name: 'update_learning',
  description: 'Update the agent\'s learning log (learnings.md) with new insights, corrections, or user feedback.',
  parameters: z.object({
    agentName: z.string().describe('The name of the agent (e.g., "mohammed")'),
    content: z.string().describe('The new learning entry to append. Should be concise and actionable.'),
  }),
  execute: async ({ agentName, content }: { agentName: string; content: string }) => {
    const agentDir = path.join(AGENTS_DIR, agentName);
    const learningFile = path.join(agentDir, 'learnings.md');

    // Ensure directory exists
    await fs.mkdir(agentDir, { recursive: true });

    // Prepare the new entry with a timestamp
    const timestamp = new Date().toISOString();
    const entry = `\n## Update: ${timestamp}\n${content}\n`;

    // Append to file
    await fs.appendFile(learningFile, entry, 'utf-8');

    return { success: true, message: 'Learning updated successfully.' };
  },
};

/**
 * أداة لتحديث ملف تعريف الشخصية (Profile).
 * يستخدمها الوكيل لتعديل صفاته أو الـ System Prompt إذا لزم الأمر.
 */
export const updatePersonalityProfileTool = {
  name: 'update_personality_profile',
  description: 'Update the agent\'s own personality profile (traits, description, system prompt). Use with caution.',
  parameters: z.object({
    agentName: z.string().describe('The name of the agent'),
    updates: z.object({
      traits: z.string().optional().describe('Updated traits list'),
      description: z.string().optional().describe('Updated short description'),
      systemPrompt: z.string().optional().describe('Updated core system instructions'),
    }).describe('Fields to update in the profile'),
  }),
  execute: async ({ agentName, updates }: { agentName: string; updates: any }) => {
    const agentDir = path.join(AGENTS_DIR, agentName);
    const profileFile = path.join(agentDir, 'profile.md');

    await fs.mkdir(agentDir, { recursive: true });

    let content = '';
    try {
      content = await fs.readFile(profileFile, 'utf-8');
    } catch (e) {
      // If file doesn't exist, start with basic frontmatter
      content = `---\nname: ${agentName}\ndescription: A custom agent\ntraits: []\n---\n`;
    }

    // Simple parsing and updating logic (Frontmatter + Content)
    // Note: In a production env, use a proper YAML parser like 'gray-matter'
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    
    if (!frontmatterMatch) {
      throw new Error('Invalid profile format. Cannot update.');
    }

    let frontmatter = frontmatterMatch[1];
    const body = frontmatterMatch[2];

    // Apply updates to frontmatter string (Basic string replacement for simplicity)
    if (updates.description) {
      frontmatter = frontmatter.replace(/description: .*/, `description: ${updates.description}`);
    }
    if (updates.traits) {
      // Convert comma separated string to YAML array format if needed, or assume YAML format
      const traitsArray = updates.traits.includes(',') ? `[${updates.traits}]` : updates.traits;
      frontmatter = frontmatter.replace(/traits: .*/, `traits: ${traitsArray}`);
    }
    if (updates.systemPrompt) {
        // We can store system prompt in frontmatter or append a special section in body
        // Let's append to body as a specific instruction block for safety
        const newBody = body + `\n\n### Updated System Instruction:\n${updates.systemPrompt}\n`;
        content = `---\n${frontmatter}\n---\n${newBody}`;
    } else {
        content = `---\n${frontmatter}\n---\n${body}`;
    }

    await fs.writeFile(profileFile, content, 'utf-8');

    return { success: true, message: 'Personality profile updated successfully.' };
  },
};

/**
 * أداة لقراءة سياق الشخصية الحالي.
 */
export const readPersonalityContextTool = {
  name: 'read_personality_context',
  description: 'Read the current personality profile and learning history of an agent.',
  parameters: z.object({
    agentName: z.string().describe('The name of the agent'),
  }),
  execute: async ({ agentName }: { agentName: string }) => {
    const agentDir = path.join(AGENTS_DIR, agentName);
    const profileFile = path.join(agentDir, 'profile.md');
    const learningFile = path.join(agentDir, 'learnings.md');

    let profile = 'No profile found.';
    let learnings = 'No learnings recorded yet.';

    try {
      profile = await fs.readFile(profileFile, 'utf-8');
    } catch (e) { /* ignore */ }

    try {
      learnings = await fs.readFile(learningFile, 'utf-8');
    } catch (e) { /* ignore */ }

    return {
      profile,
      learnings,
    };
  },
};

export const personalityTools = [
  updateLearningTool,
  updatePersonalityProfileTool,
  readPersonalityContextTool,
];
