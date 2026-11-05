export interface RendererOptions<NodeType> {
  createElement(tag: string): NodeType;
  createTextNode(value: string): NodeType;
  replaceText(textNode: NodeType, value: string): void;
  isTextNode(node: NodeType): boolean;
  setProperty<T>(node: NodeType, name: string, value: T, prev?: T): void;
  insertNode(parent: NodeType, node: NodeType, anchor?: NodeType): void;
  removeNode(parent: NodeType, node: NodeType): void;
  getParentNode(node: NodeType): NodeType | undefined;
  getFirstChild(node: NodeType): NodeType | undefined;
  getNextSibling(node: NodeType): NodeType | undefined;
}

export interface Renderer<NodeType> {
  render(code: () => NodeType, node: NodeType): () => void;
  effect<T>(fn: (prev?: T) => T, init?: T): void;
  memo<T>(fn: () => T, equal: boolean): () => T;
  createComponent<T>(Comp: (props: T) => NodeType, props: T): NodeType;
  createElement(tag: string): NodeType;
  createTextNode(value: string): NodeType;
  insertNode(parent: NodeType, node: NodeType, anchor?: NodeType): void;
  insert<T>(parent: any, accessor: (() => T) | T, marker?: any | null, initial?: any): NodeType;
  spread<T>(node: any, accessor: (() => T) | T, skipChildren?: boolean): void;
  setProp<T>(node: NodeType, name: string, value: T, prev?: T): T;
  mergeProps(...sources: unknown[]): unknown;
  use<A, T>(fn: (element: NodeType, arg: A) => T, element: NodeType, arg: A): T;
}

export function createRenderer<NodeType>(options: RendererOptions<NodeType>): Renderer<NodeType>;

