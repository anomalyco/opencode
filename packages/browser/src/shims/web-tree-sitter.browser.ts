type NodeKind = "command_name" | "word"

class MockTokenNode {
  public readonly type: NodeKind
  public readonly text: string

  constructor(text: string, index: number) {
    this.text = text
    this.type = index === 0 ? "command_name" : "word"
  }
}

class MockCommandNode {
  public readonly type = "command"
  public readonly parent: undefined = undefined
  public readonly text: string
  private readonly tokens: MockTokenNode[]

  constructor(text: string) {
    this.text = text.trim()
    this.tokens = tokenizeCommand(this.text).map((token, index) => new MockTokenNode(token, index))
  }

  public get childCount(): number {
    return this.tokens.length
  }

  public child(index: number): MockTokenNode | null {
    return this.tokens[index] ?? null
  }
}

class MockRootNode {
  constructor(private readonly source: string) {}

  public descendantsOfType(type: string): MockCommandNode[] {
    if (type !== "command") {
      return []
    }

    return splitCommands(this.source)
      .map((command) => new MockCommandNode(command))
      .filter((command) => command.text.length > 0)
  }
}

function splitCommands(source: string): string[] {
  return source
    .split(/(?:&&|\|\||;|\n)/g)
    .map((part) => part.trim())
    .filter(Boolean)
}

function tokenizeCommand(command: string): string[] {
  const matches = command.match(/"[^"]*"|'[^']*'|`[^`]*`|[^\s]+/g)
  return matches?.map((token) => token.trim()).filter(Boolean) ?? []
}

export class Parser {
  public static async init(): Promise<void> {}

  public setLanguage(_language: unknown): void {}

  public parse(source: string): { rootNode: MockRootNode } {
    return { rootNode: new MockRootNode(source) }
  }
}

export const Language = {
  async load(_path: string): Promise<Record<string, never>> {
    return {}
  },
}

export default {
  Parser,
  Language,
}
