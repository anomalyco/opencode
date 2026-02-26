/**
 * OpenCode Slash Commands Registry
 * 
 * This file defines all available slash commands that should be
 * suggested when the user types "/" in the console.
 */

export interface SlashCommand {
  name: string;
  description: string;
  shortcut?: string;
  category?: 'editing' | 'navigation' | 'system' | 'debug';
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // Editing commands
  {
    name: 'undo',
    description: '撤销上一步操作',
    shortcut: '<leader>u',
    category: 'editing'
  },
  {
    name: 'redo',
    description: '重做已撤销操作',
    shortcut: '<leader>r',
    category: 'editing'
  },
  
  // Navigation commands
  {
    name: 'last',
    description: '跳转到最后一条消息',
    shortcut: 'ctrl+alt+g,end',
    category: 'navigation'
  },
  {
    name: 'next',
    description: '跳转到下一条消息',
    category: 'navigation'
  },
  {
    name: 'previous',
    description: '跳转到上一条消息',
    category: 'navigation'
  },
  {
    name: 'copy',
    description: '复制当前消息',
    shortcut: '<leader>y',
    category: 'editing'
  },
  
  // System commands
  {
    name: 'model',
    description: '切换AI模型',
    category: 'system'
  },
  {
    name: 'debug',
    description: '打开调试面板',
    category: 'system'
  },
  {
    name: 'help',
    description: '显示帮助信息',
    category: 'system'
  }
];