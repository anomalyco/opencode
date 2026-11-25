// The home page's "New" bar: one message per recent feature, each linking to the changelog release
// (or product page) that has it. Checked against the v2.2.0–v2.2.5 release notes on 2026-11-03.
// Design mode offers them as copy options (home.announcement); the first is the default.
export const announcements = [
  // v2.2.0: "Create, install and share Desktop plugins (experimental)".
  { text: "Create, install and share desktop plugins.", link: "See what's new in 2.2", href: "/changelog/v2.2.0" },
  // v2.2.4: "Persistent Desktop Terminals".
  { text: "Desktop terminals now survive restarts.", link: "See v2.2.4", href: "/changelog/v2.2.4" },
  // v2.2.1: "Generate Images".
  { text: "Agents can now generate images.", link: "See v2.2.1", href: "/changelog/v2.2.1" },
  // The Mobile product page (the carousel marks it new).
  { text: "Steer your sessions from your phone.", link: "Meet OpenCode Mobile", href: "/mobile" },
  // v2.2.0: "Refreshed the desktop app experience".
  { text: "A refreshed desktop app.", link: "See what's new in 2.2", href: "/changelog/v2.2.0" },
] as const

/** A message as one line of Design mode copy: the announcement, then its link text. */
export const announcementCopy = (item: (typeof announcements)[number]) => `${item.text} ${item.link}`
