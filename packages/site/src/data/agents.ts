export interface AgentConfig {
  command: string;
  displayName: string;
  borderColor: string;
  companyName: string;
  logo?: string;
}

export const agents: AgentConfig[] = [
  {
    command: 'claude',
    displayName: 'Claude Code',
    borderColor: '#da7756',
    companyName: 'Claude Code',
    logo: '/favicons/claude.ico',
  },
  {
    command: 'codex',
    displayName: 'Codex',
    borderColor: '#6c908e',
    companyName: 'Codex',
    logo: '/favicons/codex.png',
  },
  {
    command: 'gemini',
    displayName: 'Gemini',
    borderColor: '#cda9fc',
    companyName: 'Gemini',
    logo: '/favicons/gemini.png',
  },
  {
    command: 'kimi',
    displayName: 'Kimi',
    borderColor: '#8b5cf6',
    companyName: 'Kimi',
    logo: '/favicons/kimi.svg',
  },
  {
    command: 'auggie',
    displayName: 'Augment',
    borderColor: '#ffffff',
    companyName: 'Augment',
    logo: '/favicons/augment.svg',
  },
  {
    command: 'goose',
    displayName: 'Goose',
    borderColor: '#8abfb7',
    companyName: 'Goose',
    logo: '/favicons/goose.ico',
  },
  {
    command: 'opencode',
    displayName: 'OpenCode',
    borderColor: '#ffba88',
    companyName: 'OpenCode',
    logo: '/favicons/opencode.png',
  },
  {
    command: 'stakpak',
    displayName: 'Stakpak',
    borderColor: '#1883a0',
    companyName: 'Stakpak',
    logo: '/favicons/stakpak.png',
  },
];

export type OS = 'macos' | 'linux' | 'windows';

export const installCommands: Record<OS, string> = {
  macos: 'brew install forge',
  linux: 'brew install forge',
  windows: 'brew install forge',
};

export function getStartCommand(agentName: string): string {
  return `forge ${agentName}`;
}
