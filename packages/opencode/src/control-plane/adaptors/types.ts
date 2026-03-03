export type Adaptor<Config, Args> = {
  getConfig(input: { workspaceID: string; branch: string | null; args: Args }): Config | Promise<Config>
  create(input: { workspaceID: string; branch?: string | null; config: Config; from?: Config }): Promise<void>
  remove(config: Config): Promise<void>
  fetch(config: Config, input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}
