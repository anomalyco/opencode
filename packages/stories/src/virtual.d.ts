declare module "virtual:story-index" {
  export function findStory(
    id: string,
  ): { load: () => Promise<{ [name: string]: unknown }>; name: string; file: string } | undefined
}
