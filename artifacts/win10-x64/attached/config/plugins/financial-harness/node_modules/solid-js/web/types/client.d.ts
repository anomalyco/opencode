import { JSX } from "./jsx.js";
export const Aliases: Record<string, string>;
export const Properties: Set<string>;
export const ChildProperties: Set<string>;
export const DelegatedEvents: Set<string>;
export const DOMElements: Set<string>;
export const SVGElements: Set<string>;
export const SVGNamespace: Record<string, string>;
export function getPropAlias(prop: string, tagName: string): string | undefined;

type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;
export function render(code: () => JSX.Element, element: MountableElement): () => void;
export function template(html: string, isCE?: boolean, isSVG?: boolean): () => Element;
export function effect<T>(fn: (prev?: T) => T, init?: T): void;
export function memo<T>(fn: () => T, equal: boolean): () => T;
export function untrack<T>(fn: () => T): T;
export function insert<T>(
  parent: MountableElement,
  accessor: (() => T) | T,
  marker?: Node | null,
  init?: JSX.Element
): JSX.Element;
export function createComponent<T>(Comp: (props: T) => JSX.Element, props: T): JSX.Element;
export function delegateEvents(eventNames: string[], d?: Document): void;
export function clearDelegatedEvents(d?: Document): void;
export function spread<T>(
  node: Element,
  accessor: T,
  isSVG?: Boolean,
  skipChildren?: Boolean
): void;
export function assign(node: Element, props: any, isSVG?: Boolean, skipChildren?: Boolean): void;
export function setAttribute(node: Element, name: string, value: string): void;
export function setAttributeNS(node: Element, namespace: string, name: string, value: string): void;
export function setBoolAttribute(node: Element, name: string, value: any): void;
export function className(node: Element, value: string): void;
export function setProperty(node: Element, name: string, value: any): void;
export function addEventListener(
  node: Element,
  name: string,
  handler: EventListener | EventListenerObject | (EventListenerObject & AddEventListenerOptions),
  delegate: boolean
): void;
export function classList(
  node: Element,
  value: { [k: string]: boolean },
  prev?: { [k: string]: boolean }
): { [k: string]: boolean };
export function style(
  node: Element,
  value: { [k: string]: string },
  prev?: { [k: string]: string }
): void;
export function getOwner(): unknown;
export function mergeProps(...sources: unknown[]): unknown;
export function dynamicProperty(props: unknown, key: string): unknown;

export function hydrate(
  fn: () => JSX.Element,
  node: MountableElement,
  options?: { renderId?: string; owner?: unknown }
): () => void;
export function getHydrationKey(): string;
export function getNextElement(template?: HTMLTemplateElement): Element;
export function getNextMatch(start: Node, elementName: string): Element;
export function getNextMarker(start: Node): [Node, Array<Node>];
export function useAssets(fn: () => JSX.Element): void;
export function getAssets(): string;
export function HydrationScript(): JSX.Element;
export function generateHydrationScript(): string;
export function Assets(props: { children?: JSX.Element }): JSX.Element;
export function Hydration(props: { children?: JSX.Element }): JSX.Element;
export function NoHydration(props: { children?: JSX.Element }): JSX.Element;
export interface RequestEvent {
  request: Request;
}
export declare const RequestContext: unique symbol;
export function getRequestEvent(): RequestEvent | undefined;
export function runHydrationEvents(): void;
