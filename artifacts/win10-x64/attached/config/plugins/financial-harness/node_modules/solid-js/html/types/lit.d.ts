type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;
interface Runtime {
    effect<T>(fn: (prev?: T) => T, init?: T): any;
    untrack<T>(fn: () => T): T;
    insert(parent: MountableElement, accessor: any, marker?: Node | null, init?: any): any;
    spread<T>(node: Element, accessor: (() => T) | T, isSVG?: Boolean, skipChildren?: Boolean): void;
    createComponent(Comp: (props: any) => any, props: any): any;
    addEventListener(node: Element, name: string, handler: EventListener | EventListenerObject | (EventListenerObject & AddEventListenerOptions), delegate: boolean): void;
    delegateEvents(eventNames: string[]): void;
    classList(node: Element, value: {
        [k: string]: boolean;
    }, prev?: {
        [k: string]: boolean;
    }): {
        [k: string]: boolean;
    };
    style(node: Element, value: {
        [k: string]: string;
    }, prev?: {
        [k: string]: string;
    }): void;
    mergeProps(...sources: unknown[]): unknown;
    dynamicProperty(props: any, key: string): any;
    setAttribute(node: Element, name: string, value: any): void;
    setAttributeNS(node: Element, namespace: string, name: string, value: any): void;
    Aliases: Record<string, string>;
    getPropAlias(prop: string, tagName: string): string | undefined;
    Properties: Set<string>;
    ChildProperties: Set<string>;
    DelegatedEvents: Set<string>;
    SVGElements: Set<string>;
    SVGNamespace: Record<string, string>;
}
export type HTMLTag = {
    (statics: TemplateStringsArray, ...args: unknown[]): Node | Node[];
};
export declare function createHTML(r: Runtime, { delegateEvents, functionBuilder }?: {
    delegateEvents?: boolean;
    functionBuilder?: (...args: string[]) => Function;
}): HTMLTag;
export {};
