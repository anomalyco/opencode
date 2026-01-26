// Override react-native-marked types to fix React 18/19 ReactNode mismatch.
// The library bundles @types/react@18 internally which conflicts with our React 19.
// This declaration re-exports the module with React 19-compatible types.
declare module "react-native-marked" {
  import type { ReactNode } from "react"
  import type { FlatListProps, ImageStyle, TextStyle, ViewStyle } from "react-native"
  import type { Hooks, Tokenizer } from "marked"

  export interface RendererInterface {
    paragraph(children: ReactNode[], styles?: ViewStyle): ReactNode
    blockquote(children: ReactNode[], styles?: ViewStyle): ReactNode
    heading(text: string | ReactNode[], styles?: TextStyle, depth?: number): ReactNode
    code(text: string, language?: string, containerStyle?: ViewStyle, textStyle?: TextStyle): ReactNode
    hr(styles?: ViewStyle): ReactNode
    listItem(children: ReactNode[], styles?: ViewStyle): ReactNode
    list(
      ordered: boolean,
      li: ReactNode[],
      listStyle?: ViewStyle,
      textStyle?: TextStyle,
      startIndex?: number,
    ): ReactNode
    escape(text: string, styles?: TextStyle): ReactNode
    link(children: string | ReactNode[], href: string, styles?: TextStyle, title?: string): ReactNode
    image(uri: string, alt?: string, style?: ImageStyle, title?: string): ReactNode
    strong(children: string | ReactNode[], styles?: TextStyle): ReactNode
    em(children: string | ReactNode[], styles?: TextStyle): ReactNode
    codespan(text: string, styles?: TextStyle): ReactNode
    br(): ReactNode
    del(children: string | ReactNode[], styles?: TextStyle): ReactNode
    text(text: string | ReactNode[], styles?: TextStyle): ReactNode
    html(text: string | ReactNode[], styles?: TextStyle): ReactNode
    linkImage(href: string, imageUrl: string, alt?: string, style?: ImageStyle, title?: string | null): ReactNode
    table(
      header: ReactNode[][],
      rows: ReactNode[][][],
      tableStyle?: ViewStyle,
      rowStyle?: ViewStyle,
      cellStyle?: ViewStyle,
    ): ReactNode
  }

  export class Renderer implements RendererInterface {
    paragraph(children: ReactNode[], styles?: ViewStyle): ReactNode
    blockquote(children: ReactNode[], styles?: ViewStyle): ReactNode
    heading(text: string | ReactNode[], styles?: TextStyle): ReactNode
    code(text: string, language?: string, containerStyle?: ViewStyle, textStyle?: TextStyle): ReactNode
    hr(styles?: ViewStyle): ReactNode
    listItem(children: ReactNode[], styles?: ViewStyle): ReactNode
    list(
      ordered: boolean,
      li: ReactNode[],
      listStyle?: ViewStyle,
      textStyle?: TextStyle,
      startIndex?: number,
    ): ReactNode
    escape(text: string, styles?: TextStyle): ReactNode
    link(children: string | ReactNode[], href: string, styles?: TextStyle, title?: string): ReactNode
    image(uri: string, alt?: string, style?: ImageStyle, title?: string): ReactNode
    strong(children: string | ReactNode[], styles?: TextStyle): ReactNode
    em(children: string | ReactNode[], styles?: TextStyle): ReactNode
    codespan(text: string, styles?: TextStyle): ReactNode
    br(): ReactNode
    del(children: string | ReactNode[], styles?: TextStyle): ReactNode
    text(text: string | ReactNode[], styles?: TextStyle): ReactNode
    html(text: string | ReactNode[], styles?: TextStyle): ReactNode
    linkImage(href: string, imageUrl: string, alt?: string, style?: ImageStyle, title?: string | null): ReactNode
    table(
      header: ReactNode[][],
      rows: ReactNode[][][],
      tableStyle?: ViewStyle,
      rowStyle?: ViewStyle,
      cellStyle?: ViewStyle,
    ): ReactNode
    getKey(): string
  }

  export interface UserTheme {
    colors?: Record<string, string>
    spacing?: Record<string, number>
  }

  export interface MarkedStyles {
    [key: string]: ViewStyle | TextStyle | ImageStyle | undefined
  }

  export interface MarkdownProps {
    value: string
    flatListProps?: Omit<FlatListProps<ReactNode>, "data" | "renderItem" | "horizontal">
    theme?: UserTheme
    renderer?: RendererInterface
    styles?: MarkedStyles | Record<string, unknown>
    baseUrl?: string
    tokenizer?: Tokenizer
    hooks?: Hooks
  }

  const Markdown: React.FC<MarkdownProps>
  export default Markdown
}
