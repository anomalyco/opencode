import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "OpenCode",
      url: "/",
    },
    links: [
      {
        text: "GitHub",
        url: "https://github.com/anomalyco/opencode",
        external: true,
      },
    ],
  }
}
