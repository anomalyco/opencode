export interface Definition {
    name: string
    command: string[]
    environment?: Record<string, string>
    extensions: string[]
    enabled(): Promise<boolean>
}
