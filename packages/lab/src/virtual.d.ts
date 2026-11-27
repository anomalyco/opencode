declare module "virtual:lab-index" {
  export function findState(
    id: string,
  ): { load: () => Promise<{ [name: string]: unknown }>; name: string; file: string } | undefined
}
