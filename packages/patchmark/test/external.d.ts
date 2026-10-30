declare module "commonmark" {
  export class Parser {
    parse(input: string): unknown
  }

  export class HtmlRenderer {
    render(ast: unknown): string
  }
}

declare module "commonmark-spec" {
  export interface SpecTest {
    markdown: string
    html: string
    example: number
    start_line: number
    end_line: number
    section: string
  }

  export const tests: SpecTest[]
}
