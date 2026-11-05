declare namespace HTMLRewriterTypes {
  interface HTMLRewriterElementContentHandlers {
    element?(element: Element): void | Promise<void>;
    comments?(comment: Comment): void | Promise<void>;
    text?(text: Text): void | Promise<void>;
  }

  interface HTMLRewriterDocumentContentHandlers {
    doctype?(doctype: Doctype): void | Promise<void>;
    comments?(comment: Comment): void | Promise<void>;
    text?(text: Text): void | Promise<void>;
    end?(end: DocumentEnd): void | Promise<void>;
  }

  interface Text {
    /** The text content */
    readonly text: string;
    /** Whether this chunk is the last piece of text in a text node */
    readonly lastInTextNode: boolean;
    /** Whether this chunk was removed */
    readonly removed: boolean;
    /** Insert content before this chunk */
    before(content: Content, options?: ContentOptions): Text;
    /** Insert content after this chunk */
    after(content: Content, options?: ContentOptions): Text;
    /** Replace this chunk with new content */
    replace(content: Content, options?: ContentOptions): Text;
    /** Remove this chunk */
    remove(): Text;
  }

  interface Doctype {
    /** The doctype name (e.g. "html" for <!DOCTYPE html>) */
    readonly name: string | null;
    /** The doctype public identifier */
    readonly publicId: string | null;
    /** The doctype system identifier */
    readonly systemId: string | null;
    /** Whether this doctype was removed */
    readonly removed: boolean;
    /** Remove this doctype */
    remove(): Doctype;
  }

  interface DocumentEnd {
    /** Append content at the end of the document */
    append(content: Content, options?: ContentOptions): DocumentEnd;
  }

  interface ContentOptions {
    /** Whether to parse the content as HTML */
    html?: boolean;
  }

  type Content = string;

  interface Comment {
    /** The comment text */
    text: string;
    /** Whether this comment was removed */
    readonly removed: boolean;
    /** Insert content before this comment */
    before(content: Content, options?: ContentOptions): Comment;
    /** Insert content after this comment */
    after(content: Content, options?: ContentOptions): Comment;
    /** Replace this comment with new content */
    replace(content: Content, options?: ContentOptions): Comment;
    /** Remove this comment */
    remove(): Comment;
  }

  interface Element {
    /** The tag name in lowercase (e.g. "div", "span") */
    tagName: string;
    /** Iterator for the element's attributes */
    readonly attributes: IterableIterator<[string, string]>;
    /** Whether this element was removed */
    readonly removed: boolean;
    /** Whether the element is explicitly self-closing, e.g. <foo /> */
    readonly selfClosing: boolean;
    /**
     * Whether the element can have inner content. Returns `true` unless
     * - the element is an [HTML void element](https://html.spec.whatwg.org/multipage/syntax.html#void-elements)
     * - or it's self-closing in a foreign context (eg. in SVG, MathML).
     */
    readonly canHaveContent: boolean;
    /** The element's namespace URI */
    readonly namespaceURI: string;
    /** Get an attribute value by name */
    getAttribute(name: string): string | null;
    /** Check if an attribute exists */
    hasAttribute(name: string): boolean;
    /** Set an attribute value */
    setAttribute(name: string, value: string): Element;
    /** Remove an attribute */
    removeAttribute(name: string): Element;
    /** Insert content before this element */
    before(content: Content, options?: ContentOptions): Element;
    /** Insert content after this element */
    after(content: Content, options?: ContentOptions): Element;
    /** Insert content at the start of this element */
    prepend(content: Content, options?: ContentOptions): Element;
    /** Insert content at the end of this element */
    append(content: Content, options?: ContentOptions): Element;
    /** Replace this element with new content */
    replace(content: Content, options?: ContentOptions): Element;
    /** Remove this element and its contents */
    remove(): Element;
    /** Remove this element but keep its contents */
    removeAndKeepContent(): Element;
    /** Set the inner content of this element */
    setInnerContent(content: Content, options?: ContentOptions): Element;
    /** Add a handler for the end tag of this element */
    onEndTag(handler: (tag: EndTag) => void | Promise<void>): void;
  }

  interface EndTag {
    /** The tag name in lowercase */
    name: string;
    /** Insert content before this end tag */
    before(content: Content, options?: ContentOptions): EndTag;
    /** Insert content after this end tag */
    after(content: Content, options?: ContentOptions): EndTag;
    /** Remove this end tag */
    remove(): EndTag;
  }
}

/**
 * [HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter?bun) is a fast API for transforming HTML.
 *
 * Bun leverages a native implementation powered by [lol-html](https://github.com/cloudflare/lol-html).
 *
 * HTMLRewriter can be used to transform HTML in a variety of ways, including:
 * * Rewriting URLs
 * * Adding meta tags
 * * Removing elements
 * * Adding elements to the head
 *
 * @example
 * ```ts
 * const rewriter = new HTMLRewriter().on('a[href]', {
 *   element(element: Element) {
 *     // Rewrite all the URLs to this youtube video
 *     element.setAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
 *   }
 * });
 * rewriter.transform(await fetch("https://remix.run"));
 * ```
 *
 * @category HTML Manipulation
 */
declare class HTMLRewriter {
  constructor();
  /**
   * Add handlers for elements matching a CSS selector
   * @param selector - A CSS selector (e.g. "div", "a[href]", ".class")
   * @param handlers - Object containing handler functions for elements, comments, and text nodes
   */
  on(selector: string, handlers: HTMLRewriterTypes.HTMLRewriterElementContentHandlers): HTMLRewriter;

  /**
   * Add handlers for document-level events
   * @param handlers - Object containing handler functions for doctype, comments, text nodes and document end
   */
  onDocument(handlers: HTMLRewriterTypes.HTMLRewriterDocumentContentHandlers): HTMLRewriter;

  /**
   * Transform HTML content
   * @param input - The HTML to transform
   * @returns A new {@link Response} with the transformed HTML
   */
  transform(input: Response | Blob | Bun.BufferSource): Response;
  /**
   * Transform HTML content
   * @param input - The HTML string to transform
   * @returns A new {@link String} containing the transformed HTML
   */
  transform(input: string): string;
  /**
   * Transform HTML content
   * @param input - The HTML to transform as a {@link ArrayBuffer}
   * @returns A new {@link ArrayBuffer} with the transformed HTML
   */
  transform(input: ArrayBuffer): ArrayBuffer;
}
