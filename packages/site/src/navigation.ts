import { getPermalink, getBlogPermalink, getAsset } from './utils/permalinks';

export const headerData = {
  links: [
    {
      text: 'Blog',
      href: getBlogPermalink(),
    },
  ],
  actions: [{ text: 'GitHub', href: 'https://github.com/forge-agents/forge', target: '_blank' }],
};

export const footerData = {
  links: [
    {
      title: 'Resources',
      links: [
        { text: 'GitHub', href: 'https://github.com/forge-agents/forge' },
        { text: 'Discord', href: 'https://discord.gg/P6Z4yn34RR' },
        { text: 'Blog', href: getBlogPermalink() },
      ],
    },
    {
      title: 'ACP Protocol',
      links: [
        { text: 'ACP Specification', href: 'https://agentclientprotocol.com' },
        { text: 'Documentation', href: 'https://github.com/forge-agents/forge#readme' },
      ],
    },
  ],
  secondaryLinks: [
    { text: 'Terms', href: getPermalink('/terms') },
    { text: 'Privacy Policy', href: getPermalink('/privacy') },
  ],
  socialLinks: [
    { ariaLabel: 'X', icon: 'tabler:brand-x', href: 'https://x.com/pat_erichsen' },
    { ariaLabel: 'Discord', icon: 'tabler:brand-discord', href: 'https://discord.gg/P6Z4yn34RR' },
    { ariaLabel: 'Github', icon: 'tabler:brand-github', href: 'https://github.com/forge-agents/forge' },
  ],
  footNote: `
    <a class="text-blue-600 underline dark:text-muted" href="https://forgeagents.dev">Forge</a> · Universal CLI for coding agents, powered by ACP
  `,
};
