type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;
interface Runtime {
    insert(parent: MountableElement, accessor: any, marker?: Node | null, init?: any): any;
    spread(node: Element, accessor: any, isSVG?: Boolean, skipChildren?: Boolean): void;
    assign(node: Element, props: any, isSVG?: Boolean, skipChildren?: Boolean): void;
    createComponent(Comp: (props: any) => any, props: any): any;
    dynamicProperty(props: any, key: string): any;
    SVGElements: Set<string>;
}
type ExpandableNode = Node & {
    [key: string]: any;
};
export type HyperScript = {
    (...args: any[]): () => ExpandableNode | ExpandableNode[];
    Fragment: (props: {
        children: (() => ExpandableNode) | (() => ExpandableNode)[];
    }) => ExpandableNode[];
};
export declare function createHyperScript(r: Runtime): HyperScript;
export {};
