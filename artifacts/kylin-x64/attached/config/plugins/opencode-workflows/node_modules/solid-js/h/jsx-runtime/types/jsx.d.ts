import * as csstype from "csstype";

/**
 * Based on JSX types for Surplus and Inferno and adapted for `dom-expressions`.
 *
 * https://github.com/adamhaile/surplus/blob/master/index.d.ts
 * https://github.com/infernojs/inferno/blob/master/packages/inferno/src/core/types.ts
 *
 * MathML typings coming mostly from Preact
 * https://github.com/preactjs/preact/blob/07dc9f324e58569ce66634aa03fe8949b4190358/src/jsx.d.ts#L2575
 *
 * Checked against other frameworks via the following table:
 * https://potahtml.github.io/namespace-jsx-project/index.html
 */
type DOMElement = Element;

export namespace JSX {
  // START - difference between `jsx.d.ts` and `jsx-h.d.ts`

  type FunctionMaybe<T = unknown> = { (): T } | T;
  interface FunctionElement {
    (): Element;
  }

  type Element =
    | Node
    | ArrayElement
    | FunctionElement
    | (string & {})
    | number
    | boolean
    | null
    | undefined;
  // END - difference between `jsx.d.ts` and `jsx-h.d.ts`

  interface ArrayElement extends Array<Element> {}

  interface ElementClass {
    // empty, libs can define requirements downstream
  }
  interface ElementAttributesProperty {
    // empty, libs can define requirements downstream
  }
  interface ElementChildrenAttribute {
    children: {};
  }

  // Event handlers

  interface EventHandler<T, E extends Event> {
    (
      e: E & {
        currentTarget: T;
        target: DOMElement;
      }
    ): void;
  }

  interface BoundEventHandler<
    T,
    E extends Event,
    EHandler extends EventHandler<T, any> = EventHandler<T, E>
  > {
    0: (data: any, ...e: Parameters<EHandler>) => void;
    1: any;
  }
  type EventHandlerUnion<
    T,
    E extends Event,
    EHandler extends EventHandler<T, any> = EventHandler<T, E>
  > = EHandler | BoundEventHandler<T, E, EHandler>;

  interface EventHandlerWithOptions<T, E extends Event, EHandler = EventHandler<T, E>>
    extends AddEventListenerOptions,
      EventListenerOptions {
    handleEvent: EHandler;
  }

  type EventHandlerWithOptionsUnion<
    T,
    E extends Event,
    EHandler extends EventHandler<T, any> = EventHandler<T, E>
  > = EHandler | EventHandlerWithOptions<T, E, EHandler>;

  interface InputEventHandler<T, E extends InputEvent> {
    (
      e: E & {
        currentTarget: T;
        target: T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          ? T
          : DOMElement;
      }
    ): void;
  }
  type InputEventHandlerUnion<T, E extends InputEvent> = EventHandlerUnion<
    T,
    E,
    InputEventHandler<T, E>
  >;

  interface ChangeEventHandler<T, E extends Event> {
    (
      e: E & {
        currentTarget: T;
        target: T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          ? T
          : DOMElement;
      }
    ): void;
  }
  type ChangeEventHandlerUnion<T, E extends Event> = EventHandlerUnion<
    T,
    E,
    ChangeEventHandler<T, E>
  >;

  interface FocusEventHandler<T, E extends FocusEvent> {
    (
      e: E & {
        currentTarget: T;
        target: T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          ? T
          : DOMElement;
      }
    ): void;
  }
  type FocusEventHandlerUnion<T, E extends FocusEvent> = EventHandlerUnion<
    T,
    E,
    FocusEventHandler<T, E>
  >;
  // end event handlers

  const SERIALIZABLE: unique symbol;
  interface SerializableAttributeValue {
    toString(): string;
    [SERIALIZABLE]: never;
  }

  interface IntrinsicAttributes {
    ref?: unknown | ((e: unknown) => void) | undefined;
  }
  interface CustomAttributes<T> {
    ref?: T | ((el: T) => void) | undefined;
    children?: FunctionMaybe<Element | undefined>;
    classList?:
      | {
          [k: string]: boolean | undefined;
        }
      | undefined;
    $ServerOnly?: boolean | undefined;
  }
  type Accessor<T> = () => T;
  interface Directives {}
  interface DirectiveFunctions {
    [x: string]: (el: DOMElement, accessor: Accessor<any>) => void;
  }
  interface ExplicitProperties {}
  interface ExplicitAttributes {}
  interface ExplicitBoolAttributes {}
  interface CustomEvents {}
  /** @deprecated Replaced by CustomEvents */
  interface CustomCaptureEvents {}
  type DirectiveAttributes = {
    [Key in keyof Directives as `use:${Key}`]?: Directives[Key];
  };
  type DirectiveFunctionAttributes<T> = {
    [K in keyof DirectiveFunctions as string extends K
      ? never
      : `use:${K}`]?: DirectiveFunctions[K] extends (
      el: infer E, // will be unknown if not provided
      ...rest: infer R // use rest so that we can check whether it's provided or not
    ) => void
      ? T extends E // everything extends unknown if E is unknown
        ? R extends [infer A] // check if has accessor provided
          ? A extends Accessor<infer V>
            ? V // it's an accessor
            : never // it isn't, type error
          : true // no accessor provided
        : never // T is the wrong element
      : never; // it isn't a function
  };
  type PropAttributes = {
    [Key in keyof ExplicitProperties as `prop:${Key}`]?: ExplicitProperties[Key];
  };
  type AttrAttributes = {
    [Key in keyof ExplicitAttributes as `attr:${Key}`]?: ExplicitAttributes[Key];
  };
  type BoolAttributes = {
    [Key in keyof ExplicitBoolAttributes as `bool:${Key}`]?: ExplicitBoolAttributes[Key];
  };
  type OnAttributes<T> = {
    [Key in keyof CustomEvents as `on:${Key}`]?: EventHandlerWithOptionsUnion<T, CustomEvents[Key]>;
  };
  type OnCaptureAttributes<T> = {
    [Key in keyof CustomCaptureEvents as `oncapture:${Key}`]?: EventHandler<
      T,
      CustomCaptureEvents[Key]
    >;
  };

  // events

  /**
   * `Window` events, defined for `<body>`, `<svg>`, `<frameset>` tags.
   *
   * Excluding `Elements events` already defined as globals that all tags share, such as `onblur`.
   */
  interface WindowEventMap<T> {
    onAfterPrint?: EventHandlerUnion<T, Event> | undefined;
    onBeforePrint?: EventHandlerUnion<T, Event> | undefined;
    onBeforeUnload?: EventHandlerUnion<T, BeforeUnloadEvent> | undefined;
    onGamepadConnected?: EventHandlerUnion<T, GamepadEvent> | undefined;
    onGamepadDisconnected?: EventHandlerUnion<T, GamepadEvent> | undefined;
    onHashchange?: EventHandlerUnion<T, HashChangeEvent> | undefined;
    onLanguageChange?: EventHandlerUnion<T, Event> | undefined;
    onMessage?: EventHandlerUnion<T, MessageEvent> | undefined;
    onMessageError?: EventHandlerUnion<T, MessageEvent> | undefined;
    onOffline?: EventHandlerUnion<T, Event> | undefined;
    onOnline?: EventHandlerUnion<T, Event> | undefined;
    onPageHide?: EventHandlerUnion<T, PageTransitionEvent> | undefined;
    // TODO `PageRevealEvent` is currently undefined on TS
    onPageReveal?: EventHandlerUnion<T, Event> | undefined;
    onPageShow?: EventHandlerUnion<T, PageTransitionEvent> | undefined;
    // TODO `PageSwapEvent` is currently undefined on TS
    onPageSwap?: EventHandlerUnion<T, Event> | undefined;
    onPopstate?: EventHandlerUnion<T, PopStateEvent> | undefined;
    onRejectionHandled?: EventHandlerUnion<T, PromiseRejectionEvent> | undefined;
    onStorage?: EventHandlerUnion<T, StorageEvent> | undefined;
    onUnhandledRejection?: EventHandlerUnion<T, PromiseRejectionEvent> | undefined;
    onUnload?: EventHandlerUnion<T, Event> | undefined;

    onafterprint?: EventHandlerUnion<T, Event> | undefined;
    onbeforeprint?: EventHandlerUnion<T, Event> | undefined;
    onbeforeunload?: EventHandlerUnion<T, BeforeUnloadEvent> | undefined;
    ongamepadconnected?: EventHandlerUnion<T, GamepadEvent> | undefined;
    ongamepaddisconnected?: EventHandlerUnion<T, GamepadEvent> | undefined;
    onhashchange?: EventHandlerUnion<T, HashChangeEvent> | undefined;
    onlanguagechange?: EventHandlerUnion<T, Event> | undefined;
    onmessage?: EventHandlerUnion<T, MessageEvent> | undefined;
    onmessageerror?: EventHandlerUnion<T, MessageEvent> | undefined;
    onoffline?: EventHandlerUnion<T, Event> | undefined;
    ononline?: EventHandlerUnion<T, Event> | undefined;
    onpagehide?: EventHandlerUnion<T, PageTransitionEvent> | undefined;
    // TODO `PageRevealEvent` is currently undefined in TS
    onpagereveal?: EventHandlerUnion<T, Event> | undefined;
    onpageshow?: EventHandlerUnion<T, PageTransitionEvent> | undefined;
    // TODO `PageSwapEvent` is currently undefined in TS
    onpageswap?: EventHandlerUnion<T, Event> | undefined;
    onpopstate?: EventHandlerUnion<T, PopStateEvent> | undefined;
    onrejectionhandled?: EventHandlerUnion<T, PromiseRejectionEvent> | undefined;
    onstorage?: EventHandlerUnion<T, StorageEvent> | undefined;
    onunhandledrejection?: EventHandlerUnion<T, PromiseRejectionEvent> | undefined;
    onunload?: EventHandlerUnion<T, Event> | undefined;

    "on:afterprint"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:beforeprint"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:beforeunload"?: EventHandlerWithOptionsUnion<T, BeforeUnloadEvent> | undefined;
    "on:gamepadconnected"?: EventHandlerWithOptionsUnion<T, GamepadEvent> | undefined;
    "on:gamepaddisconnected"?: EventHandlerWithOptionsUnion<T, GamepadEvent> | undefined;
    "on:hashchange"?: EventHandlerWithOptionsUnion<T, HashChangeEvent> | undefined;
    "on:languagechange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:message"?: EventHandlerWithOptionsUnion<T, MessageEvent> | undefined;
    "on:messageerror"?: EventHandlerWithOptionsUnion<T, MessageEvent> | undefined;
    "on:offline"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:online"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:pagehide"?: EventHandlerWithOptionsUnion<T, PageTransitionEvent> | undefined;
    // TODO `PageRevealEvent` is currently undefined in TS
    "on:pagereveal"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:pageshow"?: EventHandlerWithOptionsUnion<T, PageTransitionEvent> | undefined;
    // TODO `PageSwapEvent` is currently undefined in TS
    "on:pageswap"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:popstate"?: EventHandlerWithOptionsUnion<T, PopStateEvent> | undefined;
    "on:rejectionhandled"?: EventHandlerWithOptionsUnion<T, PromiseRejectionEvent> | undefined;
    "on:storage"?: EventHandlerWithOptionsUnion<T, StorageEvent> | undefined;
    "on:unhandledrejection"?: EventHandlerWithOptionsUnion<T, PromiseRejectionEvent> | undefined;
    "on:unload"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
  }

  /**
   * Global `Elements events`, defined for all tags.
   *
   * That's events defined and shared by all of the `HTMLElement/SVGElement/MathMLElement`
   * interfaces.
   *
   * Includes events defined for the `Element` interface.
   */
  interface CustomEventHandlersCamelCase<T> {
    onAbort?: EventHandlerUnion<T, UIEvent> | undefined;
    onAnimationCancel?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onAnimationEnd?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onAnimationIteration?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onAnimationStart?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onAuxClick?: EventHandlerUnion<T, PointerEvent> | undefined;
    onBeforeCopy?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onBeforeCut?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onBeforeInput?: InputEventHandlerUnion<T, InputEvent> | undefined;
    onBeforeMatch?: EventHandlerUnion<T, Event> | undefined;
    onBeforePaste?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onBeforeToggle?: EventHandlerUnion<T, ToggleEvent> | undefined;
    onBeforeXRSelect?: EventHandlerUnion<T, Event> | undefined;
    onBlur?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onCancel?: EventHandlerUnion<T, Event> | undefined;
    onCanPlay?: EventHandlerUnion<T, Event> | undefined;
    onCanPlayThrough?: EventHandlerUnion<T, Event> | undefined;
    onChange?: ChangeEventHandlerUnion<T, Event> | undefined;
    onClick?: EventHandlerUnion<T, MouseEvent> | undefined;
    onClose?: EventHandlerUnion<T, Event> | undefined;
    // TODO `CommandEvent` is currently undefined in TS
    onCommand?: EventHandlerUnion<T, Event> | undefined;
    onCompositionEnd?: EventHandlerUnion<T, CompositionEvent> | undefined;
    onCompositionStart?: EventHandlerUnion<T, CompositionEvent> | undefined;
    onCompositionUpdate?: EventHandlerUnion<T, CompositionEvent> | undefined;
    onContentVisibilityAutoStateChange?:
      | EventHandlerUnion<T, ContentVisibilityAutoStateChangeEvent>
      | undefined;
    onContextLost?: EventHandlerUnion<T, Event> | undefined;
    onContextMenu?: EventHandlerUnion<T, PointerEvent> | undefined;
    onContextRestored?: EventHandlerUnion<T, Event> | undefined;
    onCopy?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onCueChange?: EventHandlerUnion<T, Event> | undefined;
    onCut?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onDblClick?: EventHandlerUnion<T, MouseEvent> | undefined;
    onDrag?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragEnd?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragEnter?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragExit?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragLeave?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragOver?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragStart?: EventHandlerUnion<T, DragEvent> | undefined;
    onDrop?: EventHandlerUnion<T, DragEvent> | undefined;
    onDurationChange?: EventHandlerUnion<T, Event> | undefined;
    onEmptied?: EventHandlerUnion<T, Event> | undefined;
    onEnded?: EventHandlerUnion<T, Event> | undefined;
    onError?: EventHandlerUnion<T, ErrorEvent> | undefined;
    onFocus?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onFocusIn?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onFocusOut?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onFormData?: EventHandlerUnion<T, FormDataEvent> | undefined;
    onFullscreenChange?: EventHandlerUnion<T, Event> | undefined;
    onFullscreenError?: EventHandlerUnion<T, Event> | undefined;
    onGotPointerCapture?: EventHandlerUnion<T, PointerEvent> | undefined;
    onInput?: InputEventHandlerUnion<T, InputEvent> | undefined;
    onInvalid?: EventHandlerUnion<T, Event> | undefined;
    onKeyDown?: EventHandlerUnion<T, KeyboardEvent> | undefined;
    onKeyPress?: EventHandlerUnion<T, KeyboardEvent> | undefined;
    onKeyUp?: EventHandlerUnion<T, KeyboardEvent> | undefined;
    onLoad?: EventHandlerUnion<T, Event> | undefined;
    onLoadedData?: EventHandlerUnion<T, Event> | undefined;
    onLoadedMetadata?: EventHandlerUnion<T, Event> | undefined;
    onLoadStart?: EventHandlerUnion<T, Event> | undefined;
    onLostPointerCapture?: EventHandlerUnion<T, PointerEvent> | undefined;
    onMouseDown?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseEnter?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseLeave?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseMove?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseOut?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseOver?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseUp?: EventHandlerUnion<T, MouseEvent> | undefined;
    onPaste?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onPause?: EventHandlerUnion<T, Event> | undefined;
    onPlay?: EventHandlerUnion<T, Event> | undefined;
    onPlaying?: EventHandlerUnion<T, Event> | undefined;
    onPointerCancel?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerDown?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerEnter?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerLeave?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerMove?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerOut?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerOver?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerRawUpdate?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerUp?: EventHandlerUnion<T, PointerEvent> | undefined;
    onProgress?: EventHandlerUnion<T, ProgressEvent> | undefined;
    onRateChange?: EventHandlerUnion<T, Event> | undefined;
    onReset?: EventHandlerUnion<T, Event> | undefined;
    onResize?: EventHandlerUnion<T, UIEvent> | undefined;
    onScroll?: EventHandlerUnion<T, Event> | undefined;
    onScrollEnd?: EventHandlerUnion<T, Event> | undefined;
    // todo `SnapEvent` is currently undefined in TS
    onScrollSnapChange?: EventHandlerUnion<T, Event> | undefined;
    // todo `SnapEvent` is currently undefined in TS
    onScrollSnapChanging?: EventHandlerUnion<T, Event> | undefined;
    onSecurityPolicyViolation?: EventHandlerUnion<T, SecurityPolicyViolationEvent> | undefined;
    onSeeked?: EventHandlerUnion<T, Event> | undefined;
    onSeeking?: EventHandlerUnion<T, Event> | undefined;
    onSelect?: EventHandlerUnion<T, Event> | undefined;
    onSelectionChange?: EventHandlerUnion<T, Event> | undefined;
    onSelectStart?: EventHandlerUnion<T, Event> | undefined;
    onSlotChange?: EventHandlerUnion<T, Event> | undefined;
    onStalled?: EventHandlerUnion<T, Event> | undefined;
    onSubmit?: EventHandlerUnion<T, SubmitEvent> | undefined;
    onSuspend?: EventHandlerUnion<T, Event> | undefined;
    onTimeUpdate?: EventHandlerUnion<T, Event> | undefined;
    onToggle?: EventHandlerUnion<T, ToggleEvent> | undefined;
    onTouchCancel?: EventHandlerUnion<T, TouchEvent> | undefined;
    onTouchEnd?: EventHandlerUnion<T, TouchEvent> | undefined;
    onTouchMove?: EventHandlerUnion<T, TouchEvent> | undefined;
    onTouchStart?: EventHandlerUnion<T, TouchEvent> | undefined;
    onTransitionCancel?: EventHandlerUnion<T, TransitionEvent> | undefined;
    onTransitionEnd?: EventHandlerUnion<T, TransitionEvent> | undefined;
    onTransitionRun?: EventHandlerUnion<T, TransitionEvent> | undefined;
    onTransitionStart?: EventHandlerUnion<T, TransitionEvent> | undefined;
    onVolumeChange?: EventHandlerUnion<T, Event> | undefined;
    onWaiting?: EventHandlerUnion<T, Event> | undefined;
    onWheel?: EventHandlerUnion<T, WheelEvent> | undefined;
  }
  /** @type {GlobalEventHandlers} */
  interface CustomEventHandlersLowerCase<T> {
    onabort?: EventHandlerUnion<T, UIEvent> | undefined;
    onanimationcancel?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onanimationend?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onanimationiteration?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onanimationstart?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onauxclick?: EventHandlerUnion<T, PointerEvent> | undefined;
    onbeforecopy?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onbeforecut?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onbeforeinput?: InputEventHandlerUnion<T, InputEvent> | undefined;
    onbeforematch?: EventHandlerUnion<T, Event> | undefined;
    onbeforepaste?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onbeforetoggle?: EventHandlerUnion<T, ToggleEvent> | undefined;
    onbeforexrselect?: EventHandlerUnion<T, Event> | undefined;
    onblur?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    oncancel?: EventHandlerUnion<T, Event> | undefined;
    oncanplay?: EventHandlerUnion<T, Event> | undefined;
    oncanplaythrough?: EventHandlerUnion<T, Event> | undefined;
    onchange?: ChangeEventHandlerUnion<T, Event> | undefined;
    onclick?: EventHandlerUnion<T, MouseEvent> | undefined;
    onclose?: EventHandlerUnion<T, Event> | undefined;
    // TODO `CommandEvent` is currently undefined in TS
    oncommand?: EventHandlerUnion<T, Event> | undefined;
    oncompositionend?: EventHandlerUnion<T, CompositionEvent> | undefined;
    oncompositionstart?: EventHandlerUnion<T, CompositionEvent> | undefined;
    oncompositionupdate?: EventHandlerUnion<T, CompositionEvent> | undefined;
    oncontentvisibilityautostatechange?:
      | EventHandlerUnion<T, ContentVisibilityAutoStateChangeEvent>
      | undefined;
    oncontextlost?: EventHandlerUnion<T, Event> | undefined;
    oncontextmenu?: EventHandlerUnion<T, PointerEvent> | undefined;
    oncontextrestored?: EventHandlerUnion<T, Event> | undefined;
    oncopy?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    oncuechange?: EventHandlerUnion<T, Event> | undefined;
    oncut?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    ondblclick?: EventHandlerUnion<T, MouseEvent> | undefined;
    ondrag?: EventHandlerUnion<T, DragEvent> | undefined;
    ondragend?: EventHandlerUnion<T, DragEvent> | undefined;
    ondragenter?: EventHandlerUnion<T, DragEvent> | undefined;
    ondragexit?: EventHandlerUnion<T, DragEvent> | undefined;
    ondragleave?: EventHandlerUnion<T, DragEvent> | undefined;
    ondragover?: EventHandlerUnion<T, DragEvent> | undefined;
    ondragstart?: EventHandlerUnion<T, DragEvent> | undefined;
    ondrop?: EventHandlerUnion<T, DragEvent> | undefined;
    ondurationchange?: EventHandlerUnion<T, Event> | undefined;
    onemptied?: EventHandlerUnion<T, Event> | undefined;
    onended?: EventHandlerUnion<T, Event> | undefined;
    onerror?: EventHandlerUnion<T, ErrorEvent> | undefined;
    onfocus?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onfocusin?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onfocusout?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onformdata?: EventHandlerUnion<T, FormDataEvent> | undefined;
    onfullscreenchange?: EventHandlerUnion<T, Event> | undefined;
    onfullscreenerror?: EventHandlerUnion<T, Event> | undefined;
    ongotpointercapture?: EventHandlerUnion<T, PointerEvent> | undefined;
    oninput?: InputEventHandlerUnion<T, InputEvent> | undefined;
    oninvalid?: EventHandlerUnion<T, Event> | undefined;
    onkeydown?: EventHandlerUnion<T, KeyboardEvent> | undefined;
    onkeypress?: EventHandlerUnion<T, KeyboardEvent> | undefined;
    onkeyup?: EventHandlerUnion<T, KeyboardEvent> | undefined;
    onload?: EventHandlerUnion<T, Event> | undefined;
    onloadeddata?: EventHandlerUnion<T, Event> | undefined;
    onloadedmetadata?: EventHandlerUnion<T, Event> | undefined;
    onloadstart?: EventHandlerUnion<T, Event> | undefined;
    onlostpointercapture?: EventHandlerUnion<T, PointerEvent> | undefined;
    onmousedown?: EventHandlerUnion<T, MouseEvent> | undefined;
    onmouseenter?: EventHandlerUnion<T, MouseEvent> | undefined;
    onmouseleave?: EventHandlerUnion<T, MouseEvent> | undefined;
    onmousemove?: EventHandlerUnion<T, MouseEvent> | undefined;
    onmouseout?: EventHandlerUnion<T, MouseEvent> | undefined;
    onmouseover?: EventHandlerUnion<T, MouseEvent> | undefined;
    onmouseup?: EventHandlerUnion<T, MouseEvent> | undefined;
    onpaste?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onpause?: EventHandlerUnion<T, Event> | undefined;
    onplay?: EventHandlerUnion<T, Event> | undefined;
    onplaying?: EventHandlerUnion<T, Event> | undefined;
    onpointercancel?: EventHandlerUnion<T, PointerEvent> | undefined;
    onpointerdown?: EventHandlerUnion<T, PointerEvent> | undefined;
    onpointerenter?: EventHandlerUnion<T, PointerEvent> | undefined;
    onpointerleave?: EventHandlerUnion<T, PointerEvent> | undefined;
    onpointermove?: EventHandlerUnion<T, PointerEvent> | undefined;
    onpointerout?: EventHandlerUnion<T, PointerEvent> | undefined;
    onpointerover?: EventHandlerUnion<T, PointerEvent> | undefined;
    onpointerrawupdate?: EventHandlerUnion<T, PointerEvent> | undefined;
    onpointerup?: EventHandlerUnion<T, PointerEvent> | undefined;
    onprogress?: EventHandlerUnion<T, ProgressEvent> | undefined;
    onratechange?: EventHandlerUnion<T, Event> | undefined;
    onreset?: EventHandlerUnion<T, Event> | undefined;
    onresize?: EventHandlerUnion<T, UIEvent> | undefined;
    onscroll?: EventHandlerUnion<T, Event> | undefined;
    onscrollend?: EventHandlerUnion<T, Event> | undefined;
    // todo `SnapEvent` is currently undefined in TS
    onscrollsnapchange?: EventHandlerUnion<T, Event> | undefined;
    // todo `SnapEvent` is currently undefined in TS
    onscrollsnapchanging?: EventHandlerUnion<T, Event> | undefined;
    onsecuritypolicyviolation?: EventHandlerUnion<T, SecurityPolicyViolationEvent> | undefined;
    onseeked?: EventHandlerUnion<T, Event> | undefined;
    onseeking?: EventHandlerUnion<T, Event> | undefined;
    onselect?: EventHandlerUnion<T, Event> | undefined;
    onselectionchange?: EventHandlerUnion<T, Event> | undefined;
    onselectstart?: EventHandlerUnion<T, Event> | undefined;
    onslotchange?: EventHandlerUnion<T, Event> | undefined;
    onstalled?: EventHandlerUnion<T, Event> | undefined;
    onsubmit?: EventHandlerUnion<T, SubmitEvent> | undefined;
    onsuspend?: EventHandlerUnion<T, Event> | undefined;
    ontimeupdate?: EventHandlerUnion<T, Event> | undefined;
    ontoggle?: EventHandlerUnion<T, ToggleEvent> | undefined;
    ontouchcancel?: EventHandlerUnion<T, TouchEvent> | undefined;
    ontouchend?: EventHandlerUnion<T, TouchEvent> | undefined;
    ontouchmove?: EventHandlerUnion<T, TouchEvent> | undefined;
    ontouchstart?: EventHandlerUnion<T, TouchEvent> | undefined;
    ontransitioncancel?: EventHandlerUnion<T, TransitionEvent> | undefined;
    ontransitionend?: EventHandlerUnion<T, TransitionEvent> | undefined;
    ontransitionrun?: EventHandlerUnion<T, TransitionEvent> | undefined;
    ontransitionstart?: EventHandlerUnion<T, TransitionEvent> | undefined;
    onvolumechange?: EventHandlerUnion<T, Event> | undefined;
    onwaiting?: EventHandlerUnion<T, Event> | undefined;
    onwheel?: EventHandlerUnion<T, WheelEvent> | undefined;
  }

  interface CustomEventHandlersNamespaced<T> {
    "on:abort"?: EventHandlerWithOptionsUnion<T, UIEvent> | undefined;
    "on:animationcancel"?: EventHandlerWithOptionsUnion<T, AnimationEvent> | undefined;
    "on:animationend"?: EventHandlerWithOptionsUnion<T, AnimationEvent> | undefined;
    "on:animationiteration"?: EventHandlerWithOptionsUnion<T, AnimationEvent> | undefined;
    "on:animationstart"?: EventHandlerWithOptionsUnion<T, AnimationEvent> | undefined;
    "on:auxclick"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:beforecopy"?: EventHandlerWithOptionsUnion<T, ClipboardEvent> | undefined;
    "on:beforecut"?: EventHandlerWithOptionsUnion<T, ClipboardEvent> | undefined;
    "on:beforeinput"?:
      | EventHandlerWithOptionsUnion<T, InputEvent, InputEventHandler<T, InputEvent>>
      | undefined;
    "on:beforematch"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:beforepaste"?: EventHandlerWithOptionsUnion<T, ClipboardEvent> | undefined;
    "on:beforetoggle"?: EventHandlerWithOptionsUnion<T, ToggleEvent> | undefined;
    "on:beforexrselect"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:blur"?:
      | EventHandlerWithOptionsUnion<T, FocusEvent, FocusEventHandler<T, FocusEvent>>
      | undefined;
    "on:cancel"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:canplay"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:canplaythrough"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:change"?: EventHandlerWithOptionsUnion<T, Event, ChangeEventHandler<T, Event>> | undefined;
    "on:click"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:close"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    // TODO `CommandEvent` is currently undefined in TS
    "on:command"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:compositionend"?: EventHandlerWithOptionsUnion<T, CompositionEvent> | undefined;
    "on:compositionstart"?: EventHandlerWithOptionsUnion<T, CompositionEvent> | undefined;
    "on:compositionupdate"?: EventHandlerWithOptionsUnion<T, CompositionEvent> | undefined;
    "on:contentvisibilityautostatechange"?:
      | EventHandlerWithOptionsUnion<T, ContentVisibilityAutoStateChangeEvent>
      | undefined;
    "on:contextlost"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:contextmenu"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:contextrestored"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:copy"?: EventHandlerWithOptionsUnion<T, ClipboardEvent> | undefined;
    "on:cuechange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:cut"?: EventHandlerWithOptionsUnion<T, ClipboardEvent> | undefined;
    "on:dblclick"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:drag"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragend"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragenter"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragexit"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragleave"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragover"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragstart"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:drop"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:durationchange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:emptied"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:ended"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:error"?: EventHandlerWithOptionsUnion<T, ErrorEvent> | undefined;
    "on:focus"?:
      | EventHandlerWithOptionsUnion<T, FocusEvent, FocusEventHandler<T, FocusEvent>>
      | undefined;
    "on:focusin"?:
      | EventHandlerWithOptionsUnion<T, FocusEvent, FocusEventHandler<T, FocusEvent>>
      | undefined;
    "on:focusout"?:
      | EventHandlerWithOptionsUnion<T, FocusEvent, FocusEventHandler<T, FocusEvent>>
      | undefined;
    "on:formdata"?: EventHandlerWithOptionsUnion<T, FormDataEvent> | undefined;
    "on:fullscreenchange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:fullscreenerror"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:gotpointercapture"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:input"?:
      | EventHandlerWithOptionsUnion<T, InputEvent, InputEventHandler<T, InputEvent>>
      | undefined;
    "on:invalid"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:keydown"?: EventHandlerWithOptionsUnion<T, KeyboardEvent> | undefined;
    "on:keypress"?: EventHandlerWithOptionsUnion<T, KeyboardEvent> | undefined;
    "on:keyup"?: EventHandlerWithOptionsUnion<T, KeyboardEvent> | undefined;
    "on:load"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:loadeddata"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:loadedmetadata"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:loadstart"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:lostpointercapture"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:mousedown"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mouseenter"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mouseleave"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mousemove"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mouseout"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mouseover"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mouseup"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:paste"?: EventHandlerWithOptionsUnion<T, ClipboardEvent> | undefined;
    "on:pause"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:play"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:playing"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:pointercancel"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerdown"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerenter"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerleave"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointermove"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerout"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerover"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerrawupdate"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerup"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:progress"?: EventHandlerWithOptionsUnion<T, ProgressEvent> | undefined;
    "on:ratechange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:reset"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:resize"?: EventHandlerWithOptionsUnion<T, UIEvent> | undefined;
    "on:scroll"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:scrollend"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    // todo `SnapEvent` is currently undefined in TS
    "on:scrollsnapchange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    // todo `SnapEvent` is currently undefined in TS
    "on:scrollsnapchanging"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:securitypolicyviolation"?:
      | EventHandlerWithOptionsUnion<T, SecurityPolicyViolationEvent>
      | undefined;
    "on:seeked"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:seeking"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:select"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:selectionchange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:selectstart"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:slotchange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:stalled"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:submit"?: EventHandlerWithOptionsUnion<T, SubmitEvent> | undefined;
    "on:suspend"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:timeupdate"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:toggle"?: EventHandlerWithOptionsUnion<T, ToggleEvent> | undefined;
    "on:touchcancel"?: EventHandlerWithOptionsUnion<T, TouchEvent> | undefined;
    "on:touchend"?: EventHandlerWithOptionsUnion<T, TouchEvent> | undefined;
    "on:touchmove"?: EventHandlerWithOptionsUnion<T, TouchEvent> | undefined;
    "on:touchstart"?: EventHandlerWithOptionsUnion<T, TouchEvent> | undefined;
    "on:transitioncancel"?: EventHandlerWithOptionsUnion<T, TransitionEvent> | undefined;
    "on:transitionend"?: EventHandlerWithOptionsUnion<T, TransitionEvent> | undefined;
    "on:transitionrun"?: EventHandlerWithOptionsUnion<T, TransitionEvent> | undefined;
    "on:transitionstart"?: EventHandlerWithOptionsUnion<T, TransitionEvent> | undefined;
    "on:volumechange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:waiting"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:wheel"?: EventHandlerWithOptionsUnion<T, WheelEvent> | undefined;
  }

  /**
   * Global `Element` keys, defined for all tags regardless of their namespace.
   *
   * That's `keys` that are defined BY ALL `HTMLElement/SVGElement/MathMLElement` interfaces.
   *
   * Includes `keys` defined for the `Element` and `Node` interfaces.
   */
  interface DOMAttributes<T>
    extends CustomAttributes<T>,
      DirectiveAttributes,
      DirectiveFunctionAttributes<T>,
      PropAttributes,
      AttrAttributes,
      BoolAttributes,
      OnAttributes<T>,
      OnCaptureAttributes<T>,
      CustomEventHandlersCamelCase<T>,
      CustomEventHandlersLowerCase<T>,
      CustomEventHandlersNamespaced<T>,
      AriaAttributes {
    // [key: ClassKeys]: boolean;

    // properties
    innerHTML?: FunctionMaybe<string>;
    textContent?: FunctionMaybe<string | number>;

    // attributes
    autofocus?: FunctionMaybe<boolean | undefined>;
    class?: FunctionMaybe<string | undefined>;
    elementtiming?: FunctionMaybe<string | undefined>;
    id?: FunctionMaybe<string | undefined>;
    nonce?: FunctionMaybe<string | undefined>;
    slot?: FunctionMaybe<string | undefined>;
    style?: FunctionMaybe<CSSProperties | string | undefined>;
    tabindex?: FunctionMaybe<number | string | undefined>;

    tabIndex?: FunctionMaybe<number | string | undefined>;
  }

  interface CSSProperties extends csstype.PropertiesHyphen {
    // Override
    [key: `-${string}`]: string | number | undefined;
  }

  type HTMLAutocapitalize = "off" | "none" | "on" | "sentences" | "words" | "characters";
  type HTMLAutocomplete =
    | "additional-name"
    | "address-level1"
    | "address-level2"
    | "address-level3"
    | "address-level4"
    | "address-line1"
    | "address-line2"
    | "address-line3"
    | "bday"
    | "bday-day"
    | "bday-month"
    | "bday-year"
    | "billing"
    | "cc-additional-name"
    | "cc-csc"
    | "cc-exp"
    | "cc-exp-month"
    | "cc-exp-year"
    | "cc-family-name"
    | "cc-given-name"
    | "cc-name"
    | "cc-number"
    | "cc-type"
    | "country"
    | "country-name"
    | "current-password"
    | "email"
    | "family-name"
    | "fax"
    | "given-name"
    | "home"
    | "honorific-prefix"
    | "honorific-suffix"
    | "impp"
    | "language"
    | "mobile"
    | "name"
    | "new-password"
    | "nickname"
    | "off"
    | "on"
    | "organization"
    | "organization-title"
    | "pager"
    | "photo"
    | "postal-code"
    | "sex"
    | "shipping"
    | "street-address"
    | "tel"
    | "tel-area-code"
    | "tel-country-code"
    | "tel-extension"
    | "tel-local"
    | "tel-local-prefix"
    | "tel-local-suffix"
    | "tel-national"
    | "transaction-amount"
    | "transaction-currency"
    | "url"
    | "username"
    | "work"
    | (string & {});
  type HTMLDir = "ltr" | "rtl" | "auto";
  type HTMLFormEncType = "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain";
  type HTMLFormMethod = "post" | "get" | "dialog";
  type HTMLCrossorigin = "anonymous" | "use-credentials" | "";
  type HTMLReferrerPolicy =
    | "no-referrer"
    | "no-referrer-when-downgrade"
    | "origin"
    | "origin-when-cross-origin"
    | "same-origin"
    | "strict-origin"
    | "strict-origin-when-cross-origin"
    | "unsafe-url";
  type HTMLIframeSandbox =
    | "allow-downloads-without-user-activation"
    | "allow-downloads"
    | "allow-forms"
    | "allow-modals"
    | "allow-orientation-lock"
    | "allow-pointer-lock"
    | "allow-popups"
    | "allow-popups-to-escape-sandbox"
    | "allow-presentation"
    | "allow-same-origin"
    | "allow-scripts"
    | "allow-storage-access-by-user-activation"
    | "allow-top-navigation"
    | "allow-top-navigation-by-user-activation"
    | "allow-top-navigation-to-custom-protocols";
  type HTMLLinkAs =
    | "audio"
    | "document"
    | "embed"
    | "fetch"
    | "font"
    | "image"
    | "object"
    | "script"
    | "style"
    | "track"
    | "video"
    | "worker";

  // All the WAI-ARIA 1.1 attributes from https://www.w3.org/TR/wai-aria-1.1/
  interface AriaAttributes {
    /**
     * Identifies the currently active element when DOM focus is on a composite widget, textbox,
     * group, or application.
     */
    "aria-activedescendant"?: FunctionMaybe<string | undefined>;
    /**
     * Indicates whether assistive technologies will present all, or only parts of, the changed
     * region based on the change notifications defined by the aria-relevant attribute.
     */
    "aria-atomic"?: FunctionMaybe<boolean | "false" | "true" | undefined>;
    /**
     * Similar to the global aria-label. Defines a string value that labels the current element,
     * which is intended to be converted into Braille.
     *
     * @see aria-label.
     */
    "aria-braillelabel"?: FunctionMaybe<string | undefined>;
    /**
     * Defines a human-readable, author-localized abbreviated description for the role of an element
     * intended to be converted into Braille. Braille is not a one-to-one transliteration of letters
     * and numbers, but rather it includes various abbreviations, contractions, and characters that
     * represent words (known as logograms).
     *
     * Instead of converting long role descriptions to Braille, the aria-brailleroledescription
     * attribute allows for providing an abbreviated version of the aria-roledescription value,
     * which is a human-readable, author-localized description for the role of an element, for
     * improved user experience with braille interfaces.
     *
     * @see aria-roledescription.
     */
    "aria-brailleroledescription"?: FunctionMaybe<string | undefined>;
    /**
     * Indicates whether inputting text could trigger display of one or more predictions of the
     * user's intended value for an input and specifies how predictions would be presented if they
     * are made.
     */
    "aria-autocomplete"?: FunctionMaybe<"none" | "inline" | "list" | "both" | undefined>;
    /**
     * Indicates an element is being modified and that assistive technologies MAY want to wait until
     * the modifications are complete before exposing them to the user.
     */
    "aria-busy"?: FunctionMaybe<boolean | "false" | "true" | undefined>;
    /**
     * Indicates the current "checked" state of checkboxes, radio buttons, and other widgets.
     *
     * @see aria-pressed @see aria-selected.
     */
    "aria-checked"?: FunctionMaybe<boolean | "false" | "mixed" | "true" | undefined>;
    /**
     * Defines the total number of columns in a table, grid, or treegrid.
     *
     * @see aria-colindex.
     */
    "aria-colcount"?: FunctionMaybe<number | string | undefined>;
    /**
     * Defines an element's column index or position with respect to the total number of columns
     * within a table, grid, or treegrid.
     *
     * @see aria-colcount @see aria-colspan.
     */
    "aria-colindex"?: FunctionMaybe<number | string | undefined>;
    /** Defines a human-readable text alternative of the numeric aria-colindex. */
    "aria-colindextext"?: FunctionMaybe<number | string | undefined>;
    /**
     * Defines the number of columns spanned by a cell or gridcell within a table, grid, or
     * treegrid.
     *
     * @see aria-colindex @see aria-rowspan.
     */
    "aria-colspan"?: FunctionMaybe<number | string | undefined>;
    /**
     * Identifies the element (or elements) whose contents or presence are controlled by the current
     * element.
     *
     * @see aria-owns.
     */
    "aria-controls"?: FunctionMaybe<string | undefined>;
    /**
     * Indicates the element that represents the current item within a container or set of related
     * elements.
     */
    "aria-current"?: FunctionMaybe<
      boolean | "false" | "true" | "page" | "step" | "location" | "date" | "time" | undefined
    >;
    /**
     * Identifies the element (or elements) that describes the object.
     *
     * @see aria-labelledby
     */
    "aria-describedby"?: FunctionMaybe<string | undefined>;
    /**
     * Defines a string value that describes or annotates the current element.
     *
     * @see aria-describedby
     */
    "aria-description"?: FunctionMaybe<string | undefined>;
    /**
     * Identifies the element that provides a detailed, extended description for the object.
     *
     * @see aria-describedby.
     */
    "aria-details"?: FunctionMaybe<string | undefined>;
    /**
     * Indicates that the element is perceivable but disabled, so it is not editable or otherwise
     * operable.
     *
     * @see aria-hidden @see aria-readonly.
     */
    "aria-disabled"?: FunctionMaybe<boolean | "false" | "true" | undefined>;
    /**
     * Indicates what functions can be performed when a dragged object is released on the drop
     * target.
     *
     * @deprecated In ARIA 1.1
     */
    "aria-dropeffect"?: FunctionMaybe<
      "none" | "copy" | "execute" | "link" | "move" | "popup" | undefined
    >;
    /**
     * Identifies the element that provides an error message for the object.
     *
     * @see aria-invalid @see aria-describedby.
     */
    "aria-errormessage"?: FunctionMaybe<string | undefined>;
    /**
     * Indicates whether the element, or another grouping element it controls, is currently expanded
     * or collapsed.
     */
    "aria-expanded"?: FunctionMaybe<boolean | "false" | "true" | undefined>;
    /**
     * Identifies the next element (or elements) in an alternate reading order of content which, at
     * the user's discretion, allows assistive technology to override the general default of reading
     * in document source order.
     */
    "aria-flowto"?: FunctionMaybe<string | undefined>;
    /**
     * Indicates an element's "grabbed" state in a drag-and-drop operation.
     *
     * @deprecated In ARIA 1.1
     */
    "aria-grabbed"?: FunctionMaybe<boolean | "false" | "true" | undefined>;
    /**
     * Indicates the availability and type of interactive popup element, such as menu or dialog,
     * that can be triggered by an element.
     */
    "aria-haspopup"?: FunctionMaybe<
      boolean | "false" | "true" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined
    >;
    /**
     * Indicates whether the element is exposed to an accessibility API.
     *
     * @see aria-disabled.
     */
    "aria-hidden"?: FunctionMaybe<boolean | "false" | "true" | undefined>;
    /**
     * Indicates the entered value does not conform to the format expected by the application.
     *
     * @see aria-errormessage.
     */
    "aria-invalid"?: FunctionMaybe<boolean | "false" | "true" | "grammar" | "spelling" | undefined>;
    /**
     * Indicates keyboard shortcuts that an author has implemented to activate or give focus to an
     * element.
     */
    "aria-keyshortcuts"?: FunctionMaybe<string | undefined>;
    /**
     * Defines a string value that labels the current element.
     *
     * @see aria-labelledby.
     */
    "aria-label"?: FunctionMaybe<string | undefined>;
    /**
     * Identifies the element (or elements) that labels the current element.
     *
     * @see aria-describedby.
     */
    "aria-labelledby"?: FunctionMaybe<string | undefined>;
    /** Defines the hierarchical level of an element within a structure. */
    "aria-level"?: FunctionMaybe<number | string | undefined>;
    /**
     * Indicates that an element will be updated, and describes the types of updates the user
     * agents, assistive technologies, and user can expect from the live region.
     */
    "aria-live"?: FunctionMaybe<"off" | "assertive" | "polite" | undefined>;
    /** Indicates whether an element is modal when displayed. */
    "aria-modal"?: FunctionMaybe<boolean | "false" | "true" | undefined>;
    /** Indicates whether a text box accepts multiple lines of input or only a single line. */
    "aria-multiline"?: FunctionMaybe<boolean | "false" | "true" | undefined>;
    /**
     * Indicates that the user may select more than one item from the current selectable
     * descendants.
     */
    "aria-multiselectable"?: FunctionMaybe<boolean | "false" | "true" | undefined>;
    /** Indicates whether the element's orientation is horizontal, vertical, or unknown/ambiguous. */
    "aria-orientation"?: FunctionMaybe<"horizontal" | "vertical" | undefined>;
    /**
     * Identifies an element (or elements) in order to define a visual, functional, or contextual
     * parent/child relationship between DOM elements where the DOM hierarchy cannot be used to
     * represent the relationship.
     *
     * @see aria-controls.
     */
    "aria-owns"?: FunctionMaybe<string | undefined>;
    /**
     * Defines a short hint (a word or short phrase) intended to aid the user with data entry when
     * the control has no value. A hint could be a sample value or a brief description of the
     * expected format.
     */
    "aria-placeholder"?: FunctionMaybe<string | undefined>;
    /**
     * Defines an element's number or position in the current set of listitems or treeitems. Not
     * required if all elements in the set are present in the DOM.
     *
     * @see aria-setsize.
     */
    "aria-posinset"?: FunctionMaybe<number | string | undefined>;
    /**
     * Indicates the current "pressed" state of toggle buttons.
     *
     * @see aria-checked @see aria-selected.
     */
    "aria-pressed"?: FunctionMaybe<boolean | "false" | "mixed" | "true" | undefined>;
    /**
     * Indicates that the element is not editable, but is otherwise operable.
     *
     * @see aria-disabled.
     */
    "aria-readonly"?: FunctionMaybe<boolean | "false" | "true" | undefined>;
    /**
     * Indicates what notifications the user agent will trigger when the accessibility tree within a
     * live region is modified.
     *
     * @see aria-atomic.
     */
    "aria-relevant"?: FunctionMaybe<
      | "additions"
      | "additions removals"
      | "additions text"
      | "all"
      | "removals"
      | "removals additions"
      | "removals text"
      | "text"
      | "text additions"
      | "text removals"
      | undefined
    >;
    /** Indicates that user input is required on the element before a form may be submitted. */
    "aria-required"?: FunctionMaybe<boolean | "false" | "true" | undefined>;
    /** Defines a human-readable, author-localized description for the role of an element. */
    "aria-roledescription"?: FunctionMaybe<string | undefined>;
    /**
     * Defines the total number of rows in a table, grid, or treegrid.
     *
     * @see aria-rowindex.
     */
    "aria-rowcount"?: FunctionMaybe<number | string | undefined>;
    /**
     * Defines an element's row index or position with respect to the total number of rows within a
     * table, grid, or treegrid.
     *
     * @see aria-rowcount @see aria-rowspan.
     */
    "aria-rowindex"?: FunctionMaybe<number | string | undefined>;
    /** Defines a human-readable text alternative of aria-rowindex. */
    "aria-rowindextext"?: FunctionMaybe<number | string | undefined>;
    /**
     * Defines the number of rows spanned by a cell or gridcell within a table, grid, or treegrid.
     *
     * @see aria-rowindex @see aria-colspan.
     */
    "aria-rowspan"?: FunctionMaybe<number | string | undefined>;
    /**
     * Indicates the current "selected" state of various widgets.
     *
     * @see aria-checked @see aria-pressed.
     */
    "aria-selected"?: FunctionMaybe<boolean | "false" | "true" | undefined>;
    /**
     * Defines the number of items in the current set of listitems or treeitems. Not required if all
     * elements in the set are present in the DOM.
     *
     * @see aria-posinset.
     */
    "aria-setsize"?: FunctionMaybe<number | string | undefined>;
    /** Indicates if items in a table or grid are sorted in ascending or descending order. */
    "aria-sort"?: FunctionMaybe<"none" | "ascending" | "descending" | "other" | undefined>;
    /** Defines the maximum allowed value for a range widget. */
    "aria-valuemax"?: FunctionMaybe<number | string | undefined>;
    /** Defines the minimum allowed value for a range widget. */
    "aria-valuemin"?: FunctionMaybe<number | string | undefined>;
    /**
     * Defines the current value for a range widget.
     *
     * @see aria-valuetext.
     */
    "aria-valuenow"?: FunctionMaybe<number | string | undefined>;
    /** Defines the human readable text alternative of aria-valuenow for a range widget. */
    "aria-valuetext"?: FunctionMaybe<string | undefined>;
    role?: FunctionMaybe<
      | "alert"
      | "alertdialog"
      | "application"
      | "article"
      | "banner"
      | "button"
      | "cell"
      | "checkbox"
      | "columnheader"
      | "combobox"
      | "complementary"
      | "contentinfo"
      | "definition"
      | "dialog"
      | "directory"
      | "document"
      | "feed"
      | "figure"
      | "form"
      | "grid"
      | "gridcell"
      | "group"
      | "heading"
      | "img"
      | "link"
      | "list"
      | "listbox"
      | "listitem"
      | "log"
      | "main"
      | "marquee"
      | "math"
      | "menu"
      | "menubar"
      | "menuitem"
      | "menuitemcheckbox"
      | "menuitemradio"
      | "meter"
      | "navigation"
      | "none"
      | "note"
      | "option"
      | "presentation"
      | "progressbar"
      | "radio"
      | "radiogroup"
      | "region"
      | "row"
      | "rowgroup"
      | "rowheader"
      | "scrollbar"
      | "search"
      | "searchbox"
      | "separator"
      | "slider"
      | "spinbutton"
      | "status"
      | "switch"
      | "tab"
      | "table"
      | "tablist"
      | "tabpanel"
      | "term"
      | "textbox"
      | "timer"
      | "toolbar"
      | "tooltip"
      | "tree"
      | "treegrid"
      | "treeitem"
      | undefined
    >;
  }

  // TODO: Should we allow this?
  // type ClassKeys = `class:${string}`;
  // type CSSKeys = Exclude<keyof csstype.PropertiesHyphen, `-${string}`>;

  // type CSSAttributes = {
  //   [key in CSSKeys as `style:${key}`]: csstype.PropertiesHyphen[key];
  // };

  /** `HTMLElement` interface keys only. (ex not svg/math) */
  interface HTMLAttributes<T> extends DOMAttributes<T> {
    innerText?: FunctionMaybe<string | number>;

    accesskey?: FunctionMaybe<string | undefined>;
    autocapitalize?: FunctionMaybe<HTMLAutocapitalize | undefined>;
    autocorrect?: FunctionMaybe<"on" | "off" | undefined>;
    contenteditable?: FunctionMaybe<
      "true" | "false" | boolean | "plaintext-only" | "inherit" | undefined
    >;
    dir?: FunctionMaybe<HTMLDir | undefined>;
    draggable?: FunctionMaybe<boolean | "false" | "true" | undefined>;
    enterkeyhint?: FunctionMaybe<
      "enter" | "done" | "go" | "next" | "previous" | "search" | "send" | undefined
    >;
    exportparts?: FunctionMaybe<string | undefined>;
    hidden?: FunctionMaybe<boolean | "hidden" | "until-found" | undefined>;
    inert?: FunctionMaybe<boolean | undefined>;
    inputmode?: FunctionMaybe<
      "decimal" | "email" | "none" | "numeric" | "search" | "tel" | "text" | "url" | undefined
    >;
    is?: FunctionMaybe<string | undefined>;
    lang?: FunctionMaybe<string | undefined>;
    part?: FunctionMaybe<string | undefined>;
    popover?: FunctionMaybe<boolean | "manual" | "auto" | undefined>;
    spellcheck?: FunctionMaybe<"true" | "false" | boolean | undefined>;
    title?: FunctionMaybe<string | undefined>;
    translate?: FunctionMaybe<"yes" | "no" | undefined>;

    accessKey?: FunctionMaybe<string | undefined>;
    autoCapitalize?: FunctionMaybe<HTMLAutocapitalize | undefined>;
    contentEditable?: FunctionMaybe<boolean | "plaintext-only" | "inherit" | undefined>;
    exportParts?: FunctionMaybe<string | undefined>;
    inputMode?: FunctionMaybe<
      "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search" | undefined
    >;

    // Microdata
    itemid?: FunctionMaybe<string | undefined>;
    itemprop?: FunctionMaybe<string | undefined>;
    itemref?: FunctionMaybe<string | undefined>;
    itemscope?: FunctionMaybe<boolean | undefined>;
    itemtype?: FunctionMaybe<string | undefined>;

    itemId?: FunctionMaybe<string | undefined>;
    itemProp?: FunctionMaybe<string | undefined>;
    itemRef?: FunctionMaybe<string | undefined>;
    itemScope?: FunctionMaybe<boolean | undefined>;
    itemType?: FunctionMaybe<string | undefined>;

    // RDFa Attributes
    about?: FunctionMaybe<string | undefined>;
    datatype?: FunctionMaybe<string | undefined>;
    inlist?: FunctionMaybe<any | undefined>;
    prefix?: FunctionMaybe<string | undefined>;
    property?: FunctionMaybe<string | undefined>;
    resource?: FunctionMaybe<string | undefined>;
    typeof?: FunctionMaybe<string | undefined>;
    vocab?: FunctionMaybe<string | undefined>;

    /** @deprecated */
    contextmenu?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    contextMenu?: FunctionMaybe<string | undefined>;
  }

  // html elements

  interface AnchorHTMLAttributes<T> extends HTMLAttributes<T> {
    download?: FunctionMaybe<string | undefined>;
    href?: FunctionMaybe<string | undefined>;
    hreflang?: FunctionMaybe<string | undefined>;
    ping?: FunctionMaybe<string | undefined>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy | undefined>;
    rel?: FunctionMaybe<string | undefined>;
    target?: FunctionMaybe<"_self" | "_blank" | "_parent" | "_top" | (string & {}) | undefined>;
    type?: FunctionMaybe<string | undefined>;

    /** @experimental */
    attributionsrc?: FunctionMaybe<string | undefined>;

    referrerPolicy?: FunctionMaybe<HTMLReferrerPolicy | undefined>;

    /** @deprecated */
    charset?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    coords?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    name?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    rev?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    shape?: FunctionMaybe<"rect" | "circle" | "poly" | "default" | undefined>;
  }
  interface AudioHTMLAttributes<T> extends MediaHTMLAttributes<T> {}
  interface AreaHTMLAttributes<T> extends HTMLAttributes<T> {
    alt?: FunctionMaybe<string | undefined>;
    coords?: FunctionMaybe<string | undefined>;
    download?: FunctionMaybe<string | undefined>;
    href?: FunctionMaybe<string | undefined>;
    ping?: FunctionMaybe<string | undefined>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy | undefined>;
    rel?: FunctionMaybe<string | undefined>;
    shape?: FunctionMaybe<"rect" | "circle" | "poly" | "default" | undefined>;
    target?: FunctionMaybe<"_self" | "_blank" | "_parent" | "_top" | (string & {}) | undefined>;

    /** @experimental */
    attributionsrc?: FunctionMaybe<string | undefined>;

    referrerPolicy?: FunctionMaybe<HTMLReferrerPolicy | undefined>;

    /** @deprecated */
    nohref?: FunctionMaybe<boolean | undefined>;
  }
  interface BaseHTMLAttributes<T> extends HTMLAttributes<T> {
    href?: FunctionMaybe<string | undefined>;
    target?: FunctionMaybe<"_self" | "_blank" | "_parent" | "_top" | (string & {}) | undefined>;
  }
  interface BdoHTMLAttributes<T> extends HTMLAttributes<T> {
    dir?: FunctionMaybe<"ltr" | "rtl" | undefined>;
  }
  interface BlockquoteHTMLAttributes<T> extends HTMLAttributes<T> {
    cite?: FunctionMaybe<string | undefined>;
  }
  interface BodyHTMLAttributes<T> extends HTMLAttributes<T>, WindowEventMap<T> {}
  interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: FunctionMaybe<boolean | undefined>;
    form?: FunctionMaybe<string | undefined>;
    formaction?: FunctionMaybe<string | SerializableAttributeValue | undefined>;
    formenctype?: FunctionMaybe<HTMLFormEncType | undefined>;
    formmethod?: FunctionMaybe<HTMLFormMethod | undefined>;
    formnovalidate?: FunctionMaybe<boolean | undefined>;
    formtarget?: FunctionMaybe<"_self" | "_blank" | "_parent" | "_top" | (string & {}) | undefined>;
    name?: FunctionMaybe<string | undefined>;
    popovertarget?: FunctionMaybe<string | undefined>;
    popovertargetaction?: FunctionMaybe<"hide" | "show" | "toggle" | undefined>;
    type?: FunctionMaybe<"submit" | "reset" | "button" | "menu" | undefined>;
    value?: FunctionMaybe<string | undefined>;

    /** @experimental */
    command?: FunctionMaybe<
      | "show-modal"
      | "close"
      | "show-popover"
      | "hide-popover"
      | "toggle-popover"
      | (string & {})
      | undefined
    >;
    /** @experimental */
    commandfor?: FunctionMaybe<string | undefined>;

    formAction?: FunctionMaybe<string | SerializableAttributeValue | undefined>;
    formEnctype?: FunctionMaybe<HTMLFormEncType | undefined>;
    formMethod?: FunctionMaybe<HTMLFormMethod | undefined>;
    formNoValidate?: FunctionMaybe<boolean | undefined>;
    formTarget?: FunctionMaybe<string | undefined>;
    popoverTarget?: FunctionMaybe<string | undefined>;
    popoverTargetAction?: FunctionMaybe<"hide" | "show" | "toggle" | undefined>;
  }
  interface CanvasHTMLAttributes<T> extends HTMLAttributes<T> {
    height?: FunctionMaybe<number | string | undefined>;
    width?: FunctionMaybe<number | string | undefined>;

    /**
     * @deprecated
     * @non-standard
     */
    "moz-opaque"?: FunctionMaybe<boolean | undefined>;
  }
  interface CaptionHTMLAttributes<T> extends HTMLAttributes<T> {
    /** @deprecated */
    align?: FunctionMaybe<"left" | "center" | "right" | undefined>;
  }
  interface ColHTMLAttributes<T> extends HTMLAttributes<T> {
    span?: FunctionMaybe<number | string | undefined>;

    /** @deprecated */
    align?: FunctionMaybe<"left" | "center" | "right" | "justify" | "char" | undefined>;
    /** @deprecated */
    bgcolor?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    char?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    charoff?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    valign?: FunctionMaybe<"baseline" | "bottom" | "middle" | "top" | undefined>;
    /** @deprecated */
    width?: FunctionMaybe<number | string | undefined>;
  }
  interface ColgroupHTMLAttributes<T> extends HTMLAttributes<T> {
    span?: FunctionMaybe<number | string | undefined>;

    /** @deprecated */
    align?: FunctionMaybe<"left" | "center" | "right" | "justify" | "char" | undefined>;
    /** @deprecated */
    bgcolor?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    char?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    charoff?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    valign?: FunctionMaybe<"baseline" | "bottom" | "middle" | "top" | undefined>;
    /** @deprecated */
    width?: FunctionMaybe<number | string | undefined>;
  }
  interface DataHTMLAttributes<T> extends HTMLAttributes<T> {
    value?: FunctionMaybe<string | string[] | number | undefined>;
  }
  interface DetailsHtmlAttributes<T> extends HTMLAttributes<T> {
    name?: FunctionMaybe<string | undefined>;
    open?: FunctionMaybe<boolean | undefined>;
  }
  interface DialogHtmlAttributes<T> extends HTMLAttributes<T> {
    open?: FunctionMaybe<boolean | undefined>;
    /**
     * Do not add the tabindex property to the <dialog> element as it is not interactive and does
     * not receive focus. The dialog's contents, including the close button contained in the dialog,
     * can receive focus and be interactive.
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog#usage_notes
     */
    tabindex?: never;

    /** @experimental */
    closedby?: FunctionMaybe<"any" | "closerequest" | "none" | undefined>;
  }
  interface EmbedHTMLAttributes<T> extends HTMLAttributes<T> {
    height?: FunctionMaybe<number | string | undefined>;
    src?: FunctionMaybe<string | undefined>;
    type?: FunctionMaybe<string | undefined>;
    width?: FunctionMaybe<number | string | undefined>;

    /** @deprecated */
    align?: FunctionMaybe<"left" | "right" | "justify" | "center" | undefined>;
    /** @deprecated */
    name?: FunctionMaybe<string | undefined>;
  }
  interface FieldsetHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: FunctionMaybe<boolean | undefined>;
    form?: FunctionMaybe<string | undefined>;
    name?: FunctionMaybe<string | undefined>;
  }
  interface FormHTMLAttributes<T> extends HTMLAttributes<T> {
    "accept-charset"?: FunctionMaybe<string | undefined>;
    action?: FunctionMaybe<string | SerializableAttributeValue | undefined>;
    autocomplete?: FunctionMaybe<"on" | "off" | undefined>;
    encoding?: FunctionMaybe<HTMLFormEncType | undefined>;
    enctype?: FunctionMaybe<HTMLFormEncType | undefined>;
    method?: FunctionMaybe<HTMLFormMethod | undefined>;
    name?: FunctionMaybe<string | undefined>;
    novalidate?: FunctionMaybe<boolean | undefined>;
    rel?: FunctionMaybe<string | undefined>;
    target?: FunctionMaybe<"_self" | "_blank" | "_parent" | "_top" | (string & {}) | undefined>;

    noValidate?: FunctionMaybe<boolean | undefined>;

    /** @deprecated */
    accept?: FunctionMaybe<string | undefined>;
  }
  interface IframeHTMLAttributes<T> extends HTMLAttributes<T> {
    allow?: FunctionMaybe<string | undefined>;
    allowfullscreen?: FunctionMaybe<boolean | undefined>;
    height?: FunctionMaybe<number | string | undefined>;
    loading?: FunctionMaybe<"eager" | "lazy" | undefined>;
    name?: FunctionMaybe<string | undefined>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy | undefined>;
    sandbox?: FunctionMaybe<HTMLIframeSandbox | string | undefined>;
    src?: FunctionMaybe<string | undefined>;
    srcdoc?: FunctionMaybe<string | undefined>;
    width?: FunctionMaybe<number | string | undefined>;

    referrerPolicy?: FunctionMaybe<HTMLReferrerPolicy | undefined>;

    /** @experimental */
    adauctionheaders?: FunctionMaybe<boolean | undefined>;
    /**
     * @non-standard
     * @experimental
     */
    browsingtopics?: FunctionMaybe<boolean | undefined>;
    /** @experimental */
    credentialless?: FunctionMaybe<boolean | undefined>;
    /** @experimental */
    csp?: FunctionMaybe<string | undefined>;
    /** @experimental */
    privatetoken?: FunctionMaybe<string | undefined>;
    /** @experimental */
    sharedstoragewritable?: FunctionMaybe<boolean | undefined>;

    /** @deprecated */
    align?: FunctionMaybe<string | undefined>;
    /**
     * @deprecated
     * @non-standard
     */
    allowpaymentrequest?: FunctionMaybe<boolean | undefined>;
    /** @deprecated */
    allowtransparency?: FunctionMaybe<boolean | undefined>;
    /** @deprecated */
    frameborder?: FunctionMaybe<number | string | undefined>;
    /** @deprecated */
    longdesc?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    marginheight?: FunctionMaybe<number | string | undefined>;
    /** @deprecated */
    marginwidth?: FunctionMaybe<number | string | undefined>;
    /** @deprecated */
    scrolling?: FunctionMaybe<"yes" | "no" | "auto" | undefined>;
    /** @deprecated */
    seamless?: FunctionMaybe<boolean | undefined>;
  }
  interface ImgHTMLAttributes<T> extends HTMLAttributes<T> {
    alt?: FunctionMaybe<string | undefined>;
    crossorigin?: FunctionMaybe<HTMLCrossorigin | undefined>;
    decoding?: FunctionMaybe<"sync" | "async" | "auto" | undefined>;
    fetchpriority?: FunctionMaybe<"high" | "low" | "auto" | undefined>;
    height?: FunctionMaybe<number | string | undefined>;
    ismap?: FunctionMaybe<boolean | undefined>;
    loading?: FunctionMaybe<"eager" | "lazy" | undefined>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy | undefined>;
    sizes?: FunctionMaybe<string | undefined>;
    src?: FunctionMaybe<string | undefined>;
    srcset?: FunctionMaybe<string | undefined>;
    usemap?: FunctionMaybe<string | undefined>;
    width?: FunctionMaybe<number | string | undefined>;

    /** @experimental */
    attributionsrc?: FunctionMaybe<string | undefined>;
    /** @experimental */
    sharedstoragewritable?: FunctionMaybe<boolean | undefined>;

    crossOrigin?: FunctionMaybe<HTMLCrossorigin | undefined>;
    isMap?: FunctionMaybe<boolean | undefined>;
    referrerPolicy?: FunctionMaybe<HTMLReferrerPolicy | undefined>;
    srcSet?: FunctionMaybe<string | undefined>;
    useMap?: FunctionMaybe<string | undefined>;

    /** @deprecated */
    align?: FunctionMaybe<"top" | "middle" | "bottom" | "left" | "right" | undefined>;
    /** @deprecated */
    border?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    hspace?: FunctionMaybe<number | string | undefined>;
    /** @deprecated */
    intrinsicsize?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    longdesc?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    lowsrc?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    name?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    vspace?: FunctionMaybe<number | string | undefined>;
  }
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    accept?: FunctionMaybe<string | undefined>;
    alpha?: FunctionMaybe<boolean | undefined>;
    alt?: FunctionMaybe<string | undefined>;
    autocomplete?: FunctionMaybe<HTMLAutocomplete | undefined>;
    capture?: FunctionMaybe<"user" | "environment" | undefined>;
    checked?: FunctionMaybe<boolean | undefined>;
    colorspace?: FunctionMaybe<string | undefined>;
    dirname?: FunctionMaybe<string | undefined>;
    disabled?: FunctionMaybe<boolean | undefined>;
    form?: FunctionMaybe<string | undefined>;
    formaction?: FunctionMaybe<string | SerializableAttributeValue | undefined>;
    formenctype?: FunctionMaybe<HTMLFormEncType | undefined>;
    formmethod?: FunctionMaybe<HTMLFormMethod | undefined>;
    formnovalidate?: FunctionMaybe<boolean | undefined>;
    formtarget?: FunctionMaybe<string | undefined>;
    height?: FunctionMaybe<number | string | undefined>;
    list?: FunctionMaybe<string | undefined>;
    max?: FunctionMaybe<number | string | undefined>;
    maxlength?: FunctionMaybe<number | string | undefined>;
    min?: FunctionMaybe<number | string | undefined>;
    minlength?: FunctionMaybe<number | string | undefined>;
    multiple?: FunctionMaybe<boolean | undefined>;
    name?: FunctionMaybe<string | undefined>;
    pattern?: FunctionMaybe<string | undefined>;
    placeholder?: FunctionMaybe<string | undefined>;
    popovertarget?: FunctionMaybe<string | undefined>;
    popovertargetaction?: FunctionMaybe<"hide" | "show" | "toggle" | undefined>;
    readonly?: FunctionMaybe<boolean | undefined>;
    required?: FunctionMaybe<boolean | undefined>;
    // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/search#results
    results?: FunctionMaybe<number | undefined>;
    size?: FunctionMaybe<number | string | undefined>;
    src?: FunctionMaybe<string | undefined>;
    step?: FunctionMaybe<number | string | undefined>;
    type?: FunctionMaybe<
      | "button"
      | "checkbox"
      | "color"
      | "date"
      | "datetime-local"
      | "email"
      | "file"
      | "hidden"
      | "image"
      | "month"
      | "number"
      | "password"
      | "radio"
      | "range"
      | "reset"
      | "search"
      | "submit"
      | "tel"
      | "text"
      | "time"
      | "url"
      | "week"
      | (string & {})
      | undefined
    >;
    value?: FunctionMaybe<string | string[] | number | undefined>;
    width?: FunctionMaybe<number | string | undefined>;

    /** @non-standard */
    incremental?: FunctionMaybe<boolean | undefined>;

    formAction?: FunctionMaybe<string | SerializableAttributeValue | undefined>;
    formEnctype?: FunctionMaybe<HTMLFormEncType | undefined>;
    formMethod?: FunctionMaybe<HTMLFormMethod | undefined>;
    formNoValidate?: FunctionMaybe<boolean | undefined>;
    formTarget?: FunctionMaybe<string | undefined>;
    maxLength?: FunctionMaybe<number | string | undefined>;
    minLength?: FunctionMaybe<number | string | undefined>;
    readOnly?: FunctionMaybe<boolean | undefined>;

    /** @deprecated */
    align?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    usemap?: FunctionMaybe<string | undefined>;
  }
  interface ModHTMLAttributes<T> extends HTMLAttributes<T> {
    cite?: FunctionMaybe<string | undefined>;
    datetime?: FunctionMaybe<string | undefined>;

    dateTime?: FunctionMaybe<string | undefined>;
  }
  interface KeygenHTMLAttributes<T> extends HTMLAttributes<T> {
    /** @deprecated */
    challenge?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    disabled?: FunctionMaybe<boolean | undefined>;
    /** @deprecated */
    form?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    keyparams?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    keytype?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    name?: FunctionMaybe<string | undefined>;
  }
  interface LabelHTMLAttributes<T> extends HTMLAttributes<T> {
    for?: FunctionMaybe<string | undefined>;
  }
  interface LiHTMLAttributes<T> extends HTMLAttributes<T> {
    value?: FunctionMaybe<number | string | undefined>;

    /** @deprecated */
    type?: FunctionMaybe<"1" | "a" | "A" | "i" | "I" | undefined>;
  }
  interface LinkHTMLAttributes<T> extends HTMLAttributes<T> {
    as?: FunctionMaybe<HTMLLinkAs | undefined>;
    blocking?: FunctionMaybe<"render" | undefined>;
    color?: FunctionMaybe<string | undefined>;
    crossorigin?: FunctionMaybe<HTMLCrossorigin | undefined>;
    disabled?: FunctionMaybe<boolean | undefined>;
    fetchpriority?: FunctionMaybe<"high" | "low" | "auto" | undefined>;
    href?: FunctionMaybe<string | undefined>;
    hreflang?: FunctionMaybe<string | undefined>;
    imagesizes?: FunctionMaybe<string | undefined>;
    imagesrcset?: FunctionMaybe<string | undefined>;
    integrity?: FunctionMaybe<string | undefined>;
    media?: FunctionMaybe<string | undefined>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy | undefined>;
    rel?: FunctionMaybe<string | undefined>;
    sizes?: FunctionMaybe<string | undefined>;
    type?: FunctionMaybe<string | undefined>;

    crossOrigin?: FunctionMaybe<HTMLCrossorigin | undefined>;
    referrerPolicy?: FunctionMaybe<HTMLReferrerPolicy | undefined>;

    /** @deprecated */
    charset?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    rev?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    target?: FunctionMaybe<string | undefined>;
  }
  interface MapHTMLAttributes<T> extends HTMLAttributes<T> {
    name?: FunctionMaybe<string | undefined>;
  }
  interface MediaHTMLAttributes<T> extends HTMLAttributes<T> {
    autoplay?: FunctionMaybe<boolean | undefined>;
    controls?: FunctionMaybe<boolean | undefined>;
    controlslist?: FunctionMaybe<
      | "nodownload"
      | "nofullscreen"
      | "noplaybackrate"
      | "noremoteplayback"
      | (string & {})
      | undefined
    >;
    crossorigin?: FunctionMaybe<HTMLCrossorigin | undefined>;
    disableremoteplayback?: FunctionMaybe<boolean | undefined>;
    loop?: FunctionMaybe<boolean | undefined>;
    muted?: FunctionMaybe<boolean | undefined>;
    preload?: FunctionMaybe<"none" | "metadata" | "auto" | "" | undefined>;
    src?: FunctionMaybe<string | undefined>;

    onEncrypted?: EventHandlerUnion<T, MediaEncryptedEvent> | undefined;
    "on:encrypted"?: EventHandlerWithOptionsUnion<T, MediaEncryptedEvent> | undefined;
    onencrypted?: EventHandlerUnion<T, MediaEncryptedEvent> | undefined;

    onWaitingForKey?: EventHandlerUnion<T, Event> | undefined;
    "on:waitingforkey"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    onwaitingforkey?: EventHandlerUnion<T, Event> | undefined;

    crossOrigin?: FunctionMaybe<HTMLCrossorigin | undefined>;

    mediaGroup?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    mediagroup?: FunctionMaybe<string | undefined>;
  }
  interface MenuHTMLAttributes<T> extends HTMLAttributes<T> {
    /** @deprecated */
    compact?: FunctionMaybe<boolean | undefined>;
    /** @deprecated */
    label?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    type?: FunctionMaybe<"context" | "toolbar" | undefined>;
  }
  interface MetaHTMLAttributes<T> extends HTMLAttributes<T> {
    "http-equiv"?: FunctionMaybe<
      | "content-security-policy"
      | "content-type"
      | "default-style"
      | "x-ua-compatible"
      | "refresh"
      | undefined
    >;
    charset?: FunctionMaybe<string | undefined>;
    content?: FunctionMaybe<string | undefined>;
    media?: FunctionMaybe<string | undefined>;
    name?: FunctionMaybe<string | undefined>;

    /** @deprecated */
    scheme?: FunctionMaybe<string | undefined>;
  }
  interface MeterHTMLAttributes<T> extends HTMLAttributes<T> {
    form?: FunctionMaybe<string | undefined>;
    high?: FunctionMaybe<number | string | undefined>;
    low?: FunctionMaybe<number | string | undefined>;
    max?: FunctionMaybe<number | string | undefined>;
    min?: FunctionMaybe<number | string | undefined>;
    optimum?: FunctionMaybe<number | string | undefined>;
    value?: FunctionMaybe<string | string[] | number | undefined>;
  }
  interface QuoteHTMLAttributes<T> extends HTMLAttributes<T> {
    cite?: FunctionMaybe<string | undefined>;
  }
  interface ObjectHTMLAttributes<T> extends HTMLAttributes<T> {
    data?: FunctionMaybe<string | undefined>;
    form?: FunctionMaybe<string | undefined>;
    height?: FunctionMaybe<number | string | undefined>;
    name?: FunctionMaybe<string | undefined>;
    type?: FunctionMaybe<string | undefined>;
    width?: FunctionMaybe<number | string | undefined>;

    useMap?: FunctionMaybe<string | undefined>;

    /** @deprecated */
    align?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    archive?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    border?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    classid?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    code?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    codebase?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    codetype?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    declare?: FunctionMaybe<boolean | undefined>;
    /** @deprecated */
    hspace?: FunctionMaybe<number | string | undefined>;
    /** @deprecated */
    standby?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    usemap?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    vspace?: FunctionMaybe<number | string | undefined>;
    /** @deprecated */
    typemustmatch?: FunctionMaybe<boolean | undefined>;
  }
  interface OlHTMLAttributes<T> extends HTMLAttributes<T> {
    reversed?: FunctionMaybe<boolean | undefined>;
    start?: FunctionMaybe<number | string | undefined>;
    type?: FunctionMaybe<"1" | "a" | "A" | "i" | "I" | undefined>;

    /**
     * @deprecated
     * @non-standard
     */
    compact?: FunctionMaybe<boolean | undefined>;
  }
  interface OptgroupHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: FunctionMaybe<boolean | undefined>;
    label?: FunctionMaybe<string | undefined>;
  }
  interface OptionHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: FunctionMaybe<boolean | undefined>;
    label?: FunctionMaybe<string | undefined>;
    selected?: FunctionMaybe<boolean | undefined>;
    value?: FunctionMaybe<string | string[] | number | undefined>;
  }
  interface OutputHTMLAttributes<T> extends HTMLAttributes<T> {
    for?: FunctionMaybe<string | undefined>;
    form?: FunctionMaybe<string | undefined>;
    name?: FunctionMaybe<string | undefined>;
  }
  interface ParamHTMLAttributes<T> extends HTMLAttributes<T> {
    /** @deprecated */
    name?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    type?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    value?: FunctionMaybe<string | number | undefined>;
    /** @deprecated */
    valuetype?: FunctionMaybe<"data" | "ref" | "object" | undefined>;
  }
  interface ProgressHTMLAttributes<T> extends HTMLAttributes<T> {
    max?: FunctionMaybe<number | string | undefined>;
    value?: FunctionMaybe<string | string[] | number | undefined>;
  }
  interface ScriptHTMLAttributes<T> extends HTMLAttributes<T> {
    async?: FunctionMaybe<boolean | undefined>;
    blocking?: FunctionMaybe<"render" | undefined>;
    crossorigin?: FunctionMaybe<HTMLCrossorigin | undefined>;
    defer?: FunctionMaybe<boolean | undefined>;
    fetchpriority?: FunctionMaybe<"high" | "low" | "auto" | undefined>;
    integrity?: FunctionMaybe<string | undefined>;
    nomodule?: FunctionMaybe<boolean | undefined>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy | undefined>;
    src?: FunctionMaybe<string | undefined>;
    type?: FunctionMaybe<"importmap" | "module" | "speculationrules" | (string & {}) | undefined>;

    /** @experimental */
    attributionsrc?: FunctionMaybe<string | undefined>;

    crossOrigin?: FunctionMaybe<HTMLCrossorigin | undefined>;
    noModule?: FunctionMaybe<boolean | undefined>;
    referrerPolicy?: FunctionMaybe<HTMLReferrerPolicy | undefined>;

    /** @deprecated */
    charset?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    event?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    language?: FunctionMaybe<string | undefined>;
  }
  interface SelectHTMLAttributes<T> extends HTMLAttributes<T> {
    autocomplete?: FunctionMaybe<HTMLAutocomplete | undefined>;
    disabled?: FunctionMaybe<boolean | undefined>;
    form?: FunctionMaybe<string | undefined>;
    multiple?: FunctionMaybe<boolean | undefined>;
    name?: FunctionMaybe<string | undefined>;
    required?: FunctionMaybe<boolean | undefined>;
    size?: FunctionMaybe<number | string | undefined>;
    value?: FunctionMaybe<string | string[] | number | undefined>;
  }
  interface HTMLSlotElementAttributes<T> extends HTMLAttributes<T> {
    name?: FunctionMaybe<string | undefined>;
  }
  interface SourceHTMLAttributes<T> extends HTMLAttributes<T> {
    height?: FunctionMaybe<number | string | undefined>;
    media?: FunctionMaybe<string | undefined>;
    sizes?: FunctionMaybe<string | undefined>;
    src?: FunctionMaybe<string | undefined>;
    srcset?: FunctionMaybe<string | undefined>;
    type?: FunctionMaybe<string | undefined>;
    width?: FunctionMaybe<number | string | undefined>;
  }
  interface StyleHTMLAttributes<T> extends HTMLAttributes<T> {
    blocking?: FunctionMaybe<"render" | undefined>;
    media?: FunctionMaybe<string | undefined>;

    /** @deprecated */
    scoped?: FunctionMaybe<boolean | undefined>;
    /** @deprecated */
    type?: FunctionMaybe<string | undefined>;
  }
  interface TdHTMLAttributes<T> extends HTMLAttributes<T> {
    colspan?: FunctionMaybe<number | string | undefined>;
    headers?: FunctionMaybe<string | undefined>;
    rowspan?: FunctionMaybe<number | string | undefined>;

    colSpan?: FunctionMaybe<number | string | undefined>;
    rowSpan?: FunctionMaybe<number | string | undefined>;

    /** @deprecated */
    abbr?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    align?: FunctionMaybe<"left" | "center" | "right" | "justify" | "char" | undefined>;
    /** @deprecated */
    axis?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    bgcolor?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    char?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    charoff?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    height?: FunctionMaybe<number | string | undefined>;
    /** @deprecated */
    nowrap?: FunctionMaybe<boolean | undefined>;
    /** @deprecated */
    scope?: FunctionMaybe<"col" | "row" | "rowgroup" | "colgroup" | undefined>;
    /** @deprecated */
    valign?: FunctionMaybe<"baseline" | "bottom" | "middle" | "top" | undefined>;
    /** @deprecated */
    width?: FunctionMaybe<number | string | undefined>;
  }
  interface TemplateHTMLAttributes<T> extends HTMLAttributes<T> {
    shadowrootclonable?: FunctionMaybe<boolean | undefined>;
    shadowrootcustomelementregistry?: FunctionMaybe<boolean | undefined>;
    shadowrootdelegatesfocus?: FunctionMaybe<boolean | undefined>;
    shadowrootmode?: FunctionMaybe<"open" | "closed" | undefined>;

    /** @experimental */
    shadowrootserializable?: FunctionMaybe<boolean | undefined>;
  }
  interface TextareaHTMLAttributes<T> extends HTMLAttributes<T> {
    autocomplete?: FunctionMaybe<HTMLAutocomplete | undefined>;
    cols?: FunctionMaybe<number | string | undefined>;
    dirname?: FunctionMaybe<string | undefined>;
    disabled?: FunctionMaybe<boolean | undefined>;
    form?: FunctionMaybe<string | undefined>;
    maxlength?: FunctionMaybe<number | string | undefined>;
    minlength?: FunctionMaybe<number | string | undefined>;
    name?: FunctionMaybe<string | undefined>;
    placeholder?: FunctionMaybe<string | undefined>;
    readonly?: FunctionMaybe<boolean | undefined>;
    required?: FunctionMaybe<boolean | undefined>;
    rows?: FunctionMaybe<number | string | undefined>;
    value?: FunctionMaybe<string | string[] | number | undefined>;
    wrap?: FunctionMaybe<"hard" | "soft" | "off" | undefined>;

    maxLength?: FunctionMaybe<number | string | undefined>;
    minLength?: FunctionMaybe<number | string | undefined>;
    readOnly?: FunctionMaybe<boolean | undefined>;
  }
  interface ThHTMLAttributes<T> extends HTMLAttributes<T> {
    abbr?: FunctionMaybe<string | undefined>;
    colspan?: FunctionMaybe<number | string | undefined>;
    headers?: FunctionMaybe<string | undefined>;
    rowspan?: FunctionMaybe<number | string | undefined>;
    scope?: FunctionMaybe<"col" | "row" | "rowgroup" | "colgroup" | undefined>;

    colSpan?: FunctionMaybe<number | string | undefined>;
    rowSpan?: FunctionMaybe<number | string | undefined>;

    /** @deprecated */
    align?: FunctionMaybe<"left" | "center" | "right" | "justify" | "char" | undefined>;
    /** @deprecated */
    axis?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    bgcolor?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    char?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    charoff?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    height?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    nowrap?: FunctionMaybe<boolean | undefined>;
    /** @deprecated */
    valign?: FunctionMaybe<"baseline" | "bottom" | "middle" | "top" | undefined>;
    /** @deprecated */
    width?: FunctionMaybe<number | string | undefined>;
  }
  interface TimeHTMLAttributes<T> extends HTMLAttributes<T> {
    datetime?: FunctionMaybe<string | undefined>;

    dateTime?: FunctionMaybe<string | undefined>;
  }
  interface TrackHTMLAttributes<T> extends HTMLAttributes<T> {
    default?: FunctionMaybe<boolean | undefined>;
    kind?: FunctionMaybe<
      | "alternative"
      | "descriptions"
      | "main"
      | "main-desc"
      | "translation"
      | "commentary"
      | "subtitles"
      | "captions"
      | "chapters"
      | "metadata"
      | undefined
    >;
    label?: FunctionMaybe<string | undefined>;
    src?: FunctionMaybe<string | undefined>;
    srclang?: FunctionMaybe<string | undefined>;

    mediaGroup?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    mediagroup?: FunctionMaybe<string | undefined>;
  }
  interface VideoHTMLAttributes<T> extends MediaHTMLAttributes<T> {
    disablepictureinpicture?: FunctionMaybe<boolean | undefined>;
    height?: FunctionMaybe<number | string | undefined>;
    playsinline?: FunctionMaybe<boolean | undefined>;
    poster?: FunctionMaybe<string | undefined>;
    width?: FunctionMaybe<number | string | undefined>;

    onEnterPictureInPicture?: EventHandlerUnion<T, PictureInPictureEvent> | undefined;
    "on:enterpictureinpicture"?: EventHandlerWithOptionsUnion<T, PictureInPictureEvent> | undefined;
    onenterpictureinpicture?: EventHandlerUnion<T, PictureInPictureEvent> | undefined;

    onLeavePictureInPicture?: EventHandlerUnion<T, PictureInPictureEvent> | undefined;
    "on:leavepictureinpicture"?: EventHandlerWithOptionsUnion<T, PictureInPictureEvent> | undefined;
    onleavepictureinpicture?: EventHandlerUnion<T, PictureInPictureEvent> | undefined;
  }

  interface WebViewHTMLAttributes<T> extends HTMLAttributes<T> {
    allowpopups?: FunctionMaybe<boolean | undefined>;
    disableblinkfeatures?: FunctionMaybe<string | undefined>;
    disablewebsecurity?: FunctionMaybe<boolean | undefined>;
    enableblinkfeatures?: FunctionMaybe<string | undefined>;
    httpreferrer?: FunctionMaybe<string | undefined>;
    nodeintegration?: FunctionMaybe<boolean | undefined>;
    nodeintegrationinsubframes?: FunctionMaybe<boolean | undefined>;
    partition?: FunctionMaybe<string | undefined>;
    plugins?: FunctionMaybe<boolean | undefined>;
    preload?: FunctionMaybe<string | undefined>;
    src?: FunctionMaybe<string | undefined>;
    useragent?: FunctionMaybe<string | undefined>;
    webpreferences?: FunctionMaybe<string | undefined>;

    // does this exists?
    allowfullscreen?: FunctionMaybe<boolean | undefined>;
    autosize?: FunctionMaybe<boolean | undefined>;

    /** @deprecated */
    blinkfeatures?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    disableguestresize?: FunctionMaybe<boolean | undefined>;
    /** @deprecated */
    guestinstance?: FunctionMaybe<string | undefined>;
  }

  // svg elements
  type SVGPreserveAspectRatio =
    | "none"
    | "xMinYMin"
    | "xMidYMin"
    | "xMaxYMin"
    | "xMinYMid"
    | "xMidYMid"
    | "xMaxYMid"
    | "xMinYMax"
    | "xMidYMax"
    | "xMaxYMax"
    | "xMinYMin meet"
    | "xMidYMin meet"
    | "xMaxYMin meet"
    | "xMinYMid meet"
    | "xMidYMid meet"
    | "xMaxYMid meet"
    | "xMinYMax meet"
    | "xMidYMax meet"
    | "xMaxYMax meet"
    | "xMinYMin slice"
    | "xMidYMin slice"
    | "xMaxYMin slice"
    | "xMinYMid slice"
    | "xMidYMid slice"
    | "xMaxYMid slice"
    | "xMinYMax slice"
    | "xMidYMax slice"
    | "xMaxYMax slice";
  type ImagePreserveAspectRatio =
    | SVGPreserveAspectRatio
    | "defer none"
    | "defer xMinYMin"
    | "defer xMidYMin"
    | "defer xMaxYMin"
    | "defer xMinYMid"
    | "defer xMidYMid"
    | "defer xMaxYMid"
    | "defer xMinYMax"
    | "defer xMidYMax"
    | "defer xMaxYMax"
    | "defer xMinYMin meet"
    | "defer xMidYMin meet"
    | "defer xMaxYMin meet"
    | "defer xMinYMid meet"
    | "defer xMidYMid meet"
    | "defer xMaxYMid meet"
    | "defer xMinYMax meet"
    | "defer xMidYMax meet"
    | "defer xMaxYMax meet"
    | "defer xMinYMin slice"
    | "defer xMidYMin slice"
    | "defer xMaxYMin slice"
    | "defer xMinYMid slice"
    | "defer xMidYMid slice"
    | "defer xMaxYMid slice"
    | "defer xMinYMax slice"
    | "defer xMidYMax slice"
    | "defer xMaxYMax slice";
  type SVGUnits = "userSpaceOnUse" | "objectBoundingBox";

  /** Global `SVGElement` interface keys only. (ex not html/math) */
  interface CoreSVGAttributes<T> extends DOMAttributes<T> {
    lang?: FunctionMaybe<string | undefined>;
    tabindex?: FunctionMaybe<number | string | undefined>;
    xmlns?: FunctionMaybe<string | undefined>;

    tabIndex?: FunctionMaybe<number | string | undefined>;
  }

  interface StylableSVGAttributes {
    class?: FunctionMaybe<string | undefined>;
    style?: FunctionMaybe<CSSProperties | string | undefined>;
  }
  interface TransformableSVGAttributes {
    transform?: FunctionMaybe<string | undefined>;
  }
  interface ConditionalProcessingSVGAttributes {
    requiredExtensions?: FunctionMaybe<string | undefined>;
    requiredFeatures?: FunctionMaybe<string | undefined>;
    systemLanguage?: FunctionMaybe<string | undefined>;
  }
  interface ExternalResourceSVGAttributes {
    externalResourcesRequired?: FunctionMaybe<"true" | "false" | undefined>;
  }
  interface AnimationTimingSVGAttributes {
    begin?: FunctionMaybe<string | undefined>;
    dur?: FunctionMaybe<string | undefined>;
    end?: FunctionMaybe<string | undefined>;
    fill?: FunctionMaybe<"freeze" | "remove" | undefined>;
    max?: FunctionMaybe<string | undefined>;
    min?: FunctionMaybe<string | undefined>;
    repeatCount?: FunctionMaybe<number | "indefinite" | undefined>;
    repeatDur?: FunctionMaybe<string | undefined>;
    restart?: FunctionMaybe<"always" | "whenNotActive" | "never" | undefined>;
  }
  interface AnimationValueSVGAttributes {
    by?: FunctionMaybe<number | string | undefined>;
    calcMode?: FunctionMaybe<"discrete" | "linear" | "paced" | "spline" | undefined>;
    from?: FunctionMaybe<number | string | undefined>;
    keySplines?: FunctionMaybe<string | undefined>;
    keyTimes?: FunctionMaybe<string | undefined>;
    to?: FunctionMaybe<number | string | undefined>;
    values?: FunctionMaybe<string | undefined>;
  }
  interface AnimationAdditionSVGAttributes {
    accumulate?: FunctionMaybe<"none" | "sum" | undefined>;
    additive?: FunctionMaybe<"replace" | "sum" | undefined>;
    attributeName?: FunctionMaybe<string | undefined>;
  }
  interface AnimationAttributeTargetSVGAttributes {
    attributeName?: FunctionMaybe<string | undefined>;
    attributeType?: FunctionMaybe<"CSS" | "XML" | "auto" | undefined>;
  }
  interface PresentationSVGAttributes {
    "alignment-baseline"?: FunctionMaybe<
      | "auto"
      | "baseline"
      | "before-edge"
      | "text-before-edge"
      | "middle"
      | "central"
      | "after-edge"
      | "text-after-edge"
      | "ideographic"
      | "alphabetic"
      | "hanging"
      | "mathematical"
      | "inherit"
      | undefined
    >;
    "baseline-shift"?: FunctionMaybe<number | string | undefined>;
    "clip-path"?: FunctionMaybe<string | undefined>;
    "clip-rule"?: FunctionMaybe<"nonzero" | "evenodd" | "inherit" | undefined>;
    "color-interpolation"?: FunctionMaybe<"auto" | "sRGB" | "linearRGB" | "inherit" | undefined>;
    "color-interpolation-filters"?: FunctionMaybe<
      "auto" | "sRGB" | "linearRGB" | "inherit" | undefined
    >;
    "color-profile"?: FunctionMaybe<string | undefined>;
    "color-rendering"?: FunctionMaybe<
      "auto" | "optimizeSpeed" | "optimizeQuality" | "inherit" | undefined
    >;
    "dominant-baseline"?: FunctionMaybe<
      | "auto"
      | "text-bottom"
      | "alphabetic"
      | "ideographic"
      | "middle"
      | "central"
      | "mathematical"
      | "hanging"
      | "text-top"
      | "inherit"
      | undefined
    >;
    "enable-background"?: FunctionMaybe<string | undefined>;
    "fill-opacity"?: FunctionMaybe<number | string | "inherit" | undefined>;
    "fill-rule"?: FunctionMaybe<"nonzero" | "evenodd" | "inherit" | undefined>;
    "flood-color"?: FunctionMaybe<string | undefined>;
    "flood-opacity"?: FunctionMaybe<number | string | "inherit" | undefined>;
    "font-family"?: FunctionMaybe<string | undefined>;
    "font-size"?: FunctionMaybe<string | undefined>;
    "font-size-adjust"?: FunctionMaybe<number | string | undefined>;
    "font-stretch"?: FunctionMaybe<string | undefined>;
    "font-style"?: FunctionMaybe<"normal" | "italic" | "oblique" | "inherit" | undefined>;
    "font-variant"?: FunctionMaybe<string | undefined>;
    "font-weight"?: FunctionMaybe<number | string | undefined>;
    "glyph-orientation-horizontal"?: FunctionMaybe<string | undefined>;
    "glyph-orientation-vertical"?: FunctionMaybe<string | undefined>;
    "image-rendering"?: FunctionMaybe<
      "auto" | "optimizeQuality" | "optimizeSpeed" | "inherit" | undefined
    >;
    "letter-spacing"?: FunctionMaybe<number | string | undefined>;
    "lighting-color"?: FunctionMaybe<string | undefined>;
    "marker-end"?: FunctionMaybe<string | undefined>;
    "marker-mid"?: FunctionMaybe<string | undefined>;
    "marker-start"?: FunctionMaybe<string | undefined>;
    "pointer-events"?: FunctionMaybe<
      | "bounding-box"
      | "visiblePainted"
      | "visibleFill"
      | "visibleStroke"
      | "visible"
      | "painted"
      | "color"
      | "fill"
      | "stroke"
      | "all"
      | "none"
      | "inherit"
      | undefined
    >;
    "shape-rendering"?: FunctionMaybe<
      "auto" | "optimizeSpeed" | "crispEdges" | "geometricPrecision" | "inherit" | undefined
    >;
    "stop-color"?: FunctionMaybe<string | undefined>;
    "stop-opacity"?: FunctionMaybe<number | string | "inherit" | undefined>;
    "stroke-dasharray"?: FunctionMaybe<string | undefined>;
    "stroke-dashoffset"?: FunctionMaybe<number | string | undefined>;
    "stroke-linecap"?: FunctionMaybe<"butt" | "round" | "square" | "inherit" | undefined>;
    "stroke-linejoin"?: FunctionMaybe<
      "arcs" | "bevel" | "miter" | "miter-clip" | "round" | "inherit" | undefined
    >;
    "stroke-miterlimit"?: FunctionMaybe<number | string | "inherit" | undefined>;
    "stroke-opacity"?: FunctionMaybe<number | string | "inherit" | undefined>;
    "stroke-width"?: FunctionMaybe<number | string | undefined>;
    "text-anchor"?: FunctionMaybe<"start" | "middle" | "end" | "inherit" | undefined>;
    "text-decoration"?: FunctionMaybe<
      "none" | "underline" | "overline" | "line-through" | "blink" | "inherit" | undefined
    >;
    "text-rendering"?: FunctionMaybe<
      "auto" | "optimizeSpeed" | "optimizeLegibility" | "geometricPrecision" | "inherit" | undefined
    >;
    "unicode-bidi"?: FunctionMaybe<string | undefined>;
    "word-spacing"?: FunctionMaybe<number | string | undefined>;
    "writing-mode"?: FunctionMaybe<
      "lr-tb" | "rl-tb" | "tb-rl" | "lr" | "rl" | "tb" | "inherit" | undefined
    >;
    clip?: FunctionMaybe<string | undefined>;
    color?: FunctionMaybe<string | undefined>;
    cursor?: FunctionMaybe<string | undefined>;
    direction?: FunctionMaybe<"ltr" | "rtl" | "inherit" | undefined>;
    display?: FunctionMaybe<string | undefined>;
    fill?: FunctionMaybe<string | undefined>;
    filter?: FunctionMaybe<string | undefined>;
    kerning?: FunctionMaybe<string | undefined>;
    mask?: FunctionMaybe<string | undefined>;
    opacity?: FunctionMaybe<number | string | "inherit" | undefined>;
    overflow?: FunctionMaybe<"visible" | "hidden" | "scroll" | "auto" | "inherit" | undefined>;
    pathLength?: FunctionMaybe<string | number | undefined>;
    stroke?: FunctionMaybe<string | undefined>;
    visibility?: FunctionMaybe<"visible" | "hidden" | "collapse" | "inherit" | undefined>;
  }
  interface AnimationElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      ConditionalProcessingSVGAttributes {
    // TODO TimeEvent is currently undefined on TS
    onBegin?: EventHandlerUnion<T, Event> | undefined;
    onbegin?: EventHandlerUnion<T, Event> | undefined;
    "on:begin"?: EventHandlerWithOptionsUnion<T, Event> | undefined;

    // TODO TimeEvent is currently undefined on TS
    onEnd?: EventHandlerUnion<T, Event> | undefined;
    onend?: EventHandlerUnion<T, Event> | undefined;
    "on:end"?: EventHandlerWithOptionsUnion<T, Event> | undefined;

    // TODO TimeEvent is currently undefined on TS
    onRepeat?: EventHandlerUnion<T, Event> | undefined;
    onrepeat?: EventHandlerUnion<T, Event> | undefined;
    "on:repeat"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
  }

  interface ContainerElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      Pick<
        PresentationSVGAttributes,
        | "clip-path"
        | "mask"
        | "cursor"
        | "opacity"
        | "filter"
        | "enable-background"
        | "color-interpolation"
        | "color-rendering"
      > {}
  interface FilterPrimitiveElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      Pick<PresentationSVGAttributes, "color-interpolation-filters"> {
    height?: FunctionMaybe<number | string | undefined>;
    result?: FunctionMaybe<string | undefined>;
    width?: FunctionMaybe<number | string | undefined>;
    x?: FunctionMaybe<number | string | undefined>;
    y?: FunctionMaybe<number | string | undefined>;
  }
  interface SingleInputFilterSVGAttributes {
    in?: FunctionMaybe<string | undefined>;
  }
  interface DoubleInputFilterSVGAttributes {
    in?: FunctionMaybe<string | undefined>;
    in2?: FunctionMaybe<string | undefined>;
  }
  interface FitToViewBoxSVGAttributes {
    preserveAspectRatio?: FunctionMaybe<SVGPreserveAspectRatio | undefined>;
    viewBox?: FunctionMaybe<string | undefined>;
  }
  interface GradientElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes {
    gradientTransform?: FunctionMaybe<string | undefined>;
    gradientUnits?: FunctionMaybe<SVGUnits | undefined>;
    href?: FunctionMaybe<string | undefined>;
    spreadMethod?: FunctionMaybe<"pad" | "reflect" | "repeat" | undefined>;
  }
  interface GraphicsElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      Pick<
        PresentationSVGAttributes,
        | "clip-rule"
        | "mask"
        | "pointer-events"
        | "cursor"
        | "opacity"
        | "filter"
        | "display"
        | "visibility"
        | "color-interpolation"
        | "color-rendering"
      > {}
  interface LightSourceElementSVGAttributes<T> extends CoreSVGAttributes<T> {}
  interface NewViewportSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      Pick<PresentationSVGAttributes, "overflow" | "clip"> {
    viewBox?: FunctionMaybe<string | undefined>;
  }
  interface ShapeElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      Pick<
        PresentationSVGAttributes,
        | "color"
        | "fill"
        | "fill-rule"
        | "fill-opacity"
        | "stroke"
        | "stroke-width"
        | "stroke-linecap"
        | "stroke-linejoin"
        | "stroke-miterlimit"
        | "stroke-dasharray"
        | "stroke-dashoffset"
        | "stroke-opacity"
        | "shape-rendering"
        | "pathLength"
      > {}
  interface TextContentElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      Pick<
        PresentationSVGAttributes,
        | "font-family"
        | "font-style"
        | "font-variant"
        | "font-weight"
        | "font-stretch"
        | "font-size"
        | "font-size-adjust"
        | "kerning"
        | "letter-spacing"
        | "word-spacing"
        | "text-decoration"
        | "glyph-orientation-horizontal"
        | "glyph-orientation-vertical"
        | "direction"
        | "unicode-bidi"
        | "text-anchor"
        | "dominant-baseline"
        | "color"
        | "fill"
        | "fill-rule"
        | "fill-opacity"
        | "stroke"
        | "stroke-width"
        | "stroke-linecap"
        | "stroke-linejoin"
        | "stroke-miterlimit"
        | "stroke-dasharray"
        | "stroke-dashoffset"
        | "stroke-opacity"
      > {}
  interface ZoomAndPanSVGAttributes {
    /**
     * @deprecated
     * @non-standard
     */
    zoomAndPan?: FunctionMaybe<"disable" | "magnify" | undefined>;
  }
  interface AnimateSVGAttributes<T>
    extends AnimationElementSVGAttributes<T>,
      AnimationAttributeTargetSVGAttributes,
      AnimationTimingSVGAttributes,
      AnimationValueSVGAttributes,
      AnimationAdditionSVGAttributes,
      Pick<PresentationSVGAttributes, "color-interpolation" | "color-rendering"> {}
  interface AnimateMotionSVGAttributes<T>
    extends AnimationElementSVGAttributes<T>,
      AnimationTimingSVGAttributes,
      AnimationValueSVGAttributes,
      AnimationAdditionSVGAttributes {
    keyPoints?: FunctionMaybe<string | undefined>;
    origin?: FunctionMaybe<"default" | undefined>;
    path?: FunctionMaybe<string | undefined>;
    rotate?: FunctionMaybe<number | string | "auto" | "auto-reverse" | undefined>;
  }
  interface AnimateTransformSVGAttributes<T>
    extends AnimationElementSVGAttributes<T>,
      AnimationAttributeTargetSVGAttributes,
      AnimationTimingSVGAttributes,
      AnimationValueSVGAttributes,
      AnimationAdditionSVGAttributes {
    type?: FunctionMaybe<"translate" | "scale" | "rotate" | "skewX" | "skewY" | undefined>;
  }
  interface CircleSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    cx?: FunctionMaybe<number | string | undefined>;
    cy?: FunctionMaybe<number | string | undefined>;
    r?: FunctionMaybe<number | string | undefined>;
  }
  interface ClipPathSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    clipPathUnits?: FunctionMaybe<SVGUnits | undefined>;
  }
  interface DefsSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes {}
  interface DescSVGAttributes<T> extends CoreSVGAttributes<T>, StylableSVGAttributes {}
  interface EllipseSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    cx?: FunctionMaybe<number | string | undefined>;
    cy?: FunctionMaybe<number | string | undefined>;
    rx?: FunctionMaybe<number | string | undefined>;
    ry?: FunctionMaybe<number | string | undefined>;
  }
  interface FeBlendSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      DoubleInputFilterSVGAttributes,
      StylableSVGAttributes {
    mode?: FunctionMaybe<"normal" | "multiply" | "screen" | "darken" | "lighten" | undefined>;
  }
  interface FeColorMatrixSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    type?: FunctionMaybe<"matrix" | "saturate" | "hueRotate" | "luminanceToAlpha" | undefined>;
    values?: FunctionMaybe<string | undefined>;
  }
  interface FeComponentTransferSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {}
  interface FeCompositeSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      DoubleInputFilterSVGAttributes,
      StylableSVGAttributes {
    k1?: FunctionMaybe<number | string | undefined>;
    k2?: FunctionMaybe<number | string | undefined>;
    k3?: FunctionMaybe<number | string | undefined>;
    k4?: FunctionMaybe<number | string | undefined>;
    operator?: FunctionMaybe<"over" | "in" | "out" | "atop" | "xor" | "arithmetic" | undefined>;
  }
  interface FeConvolveMatrixSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    bias?: FunctionMaybe<number | string | undefined>;
    divisor?: FunctionMaybe<number | string | undefined>;
    edgeMode?: FunctionMaybe<"duplicate" | "wrap" | "none" | undefined>;
    kernelMatrix?: FunctionMaybe<string | undefined>;
    kernelUnitLength?: FunctionMaybe<number | string | undefined>;
    order?: FunctionMaybe<number | string | undefined>;
    preserveAlpha?: FunctionMaybe<"true" | "false" | undefined>;
    targetX?: FunctionMaybe<number | string | undefined>;
    targetY?: FunctionMaybe<number | string | undefined>;
  }
  interface FeDiffuseLightingSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "lighting-color"> {
    diffuseConstant?: FunctionMaybe<number | string | undefined>;
    kernelUnitLength?: FunctionMaybe<number | string | undefined>;
    surfaceScale?: FunctionMaybe<number | string | undefined>;
  }
  interface FeDisplacementMapSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      DoubleInputFilterSVGAttributes,
      StylableSVGAttributes {
    scale?: FunctionMaybe<number | string | undefined>;
    xChannelSelector?: FunctionMaybe<"R" | "G" | "B" | "A" | undefined>;
    yChannelSelector?: FunctionMaybe<"R" | "G" | "B" | "A" | undefined>;
  }
  interface FeDistantLightSVGAttributes<T> extends LightSourceElementSVGAttributes<T> {
    azimuth?: FunctionMaybe<number | string | undefined>;
    elevation?: FunctionMaybe<number | string | undefined>;
  }
  interface FeDropShadowSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      FilterPrimitiveElementSVGAttributes<T>,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "flood-color" | "flood-opacity"> {
    dx?: FunctionMaybe<number | string | undefined>;
    dy?: FunctionMaybe<number | string | undefined>;
    stdDeviation?: FunctionMaybe<number | string | undefined>;
  }
  interface FeFloodSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "flood-color" | "flood-opacity"> {}
  interface FeFuncSVGAttributes<T> extends CoreSVGAttributes<T> {
    amplitude?: FunctionMaybe<number | string | undefined>;
    exponent?: FunctionMaybe<number | string | undefined>;
    intercept?: FunctionMaybe<number | string | undefined>;
    offset?: FunctionMaybe<number | string | undefined>;
    slope?: FunctionMaybe<number | string | undefined>;
    tableValues?: FunctionMaybe<string | undefined>;
    type?: FunctionMaybe<"identity" | "table" | "discrete" | "linear" | "gamma" | undefined>;
  }
  interface FeGaussianBlurSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    stdDeviation?: FunctionMaybe<number | string | undefined>;
  }
  interface FeImageSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes {
    href?: FunctionMaybe<string | undefined>;
    preserveAspectRatio?: FunctionMaybe<SVGPreserveAspectRatio | undefined>;
  }
  interface FeMergeSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      StylableSVGAttributes {}
  interface FeMergeNodeSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      SingleInputFilterSVGAttributes {}
  interface FeMorphologySVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    operator?: FunctionMaybe<"erode" | "dilate" | undefined>;
    radius?: FunctionMaybe<number | string | undefined>;
  }
  interface FeOffsetSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    dx?: FunctionMaybe<number | string | undefined>;
    dy?: FunctionMaybe<number | string | undefined>;
  }
  interface FePointLightSVGAttributes<T> extends LightSourceElementSVGAttributes<T> {
    x?: FunctionMaybe<number | string | undefined>;
    y?: FunctionMaybe<number | string | undefined>;
    z?: FunctionMaybe<number | string | undefined>;
  }
  interface FeSpecularLightingSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "lighting-color"> {
    kernelUnitLength?: FunctionMaybe<number | string | undefined>;
    specularConstant?: FunctionMaybe<string | undefined>;
    specularExponent?: FunctionMaybe<string | undefined>;
    surfaceScale?: FunctionMaybe<string | undefined>;
  }
  interface FeSpotLightSVGAttributes<T> extends LightSourceElementSVGAttributes<T> {
    limitingConeAngle?: FunctionMaybe<number | string | undefined>;
    pointsAtX?: FunctionMaybe<number | string | undefined>;
    pointsAtY?: FunctionMaybe<number | string | undefined>;
    pointsAtZ?: FunctionMaybe<number | string | undefined>;
    specularExponent?: FunctionMaybe<number | string | undefined>;
    x?: FunctionMaybe<number | string | undefined>;
    y?: FunctionMaybe<number | string | undefined>;
    z?: FunctionMaybe<number | string | undefined>;
  }
  interface FeTileSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {}
  interface FeTurbulanceSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      StylableSVGAttributes {
    baseFrequency?: FunctionMaybe<number | string | undefined>;
    numOctaves?: FunctionMaybe<number | string | undefined>;
    seed?: FunctionMaybe<number | string | undefined>;
    stitchTiles?: FunctionMaybe<"stitch" | "noStitch" | undefined>;
    type?: FunctionMaybe<"fractalNoise" | "turbulence" | undefined>;
  }
  interface FilterSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes {
    filterRes?: FunctionMaybe<number | string | undefined>;
    filterUnits?: FunctionMaybe<SVGUnits | undefined>;
    height?: FunctionMaybe<number | string | undefined>;
    primitiveUnits?: FunctionMaybe<SVGUnits | undefined>;
    width?: FunctionMaybe<number | string | undefined>;
    x?: FunctionMaybe<number | string | undefined>;
    y?: FunctionMaybe<number | string | undefined>;
  }
  interface ForeignObjectSVGAttributes<T>
    extends NewViewportSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "display" | "visibility"> {
    height?: FunctionMaybe<number | string | undefined>;
    width?: FunctionMaybe<number | string | undefined>;
    x?: FunctionMaybe<number | string | undefined>;
    y?: FunctionMaybe<number | string | undefined>;
  }
  interface GSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "display" | "visibility"> {}
  interface ImageSVGAttributes<T>
    extends NewViewportSVGAttributes<T>,
      GraphicsElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "color-profile" | "image-rendering"> {
    height?: FunctionMaybe<number | string | undefined>;
    href?: FunctionMaybe<string | undefined>;
    preserveAspectRatio?: FunctionMaybe<ImagePreserveAspectRatio | undefined>;
    width?: FunctionMaybe<number | string | undefined>;
    x?: FunctionMaybe<number | string | undefined>;
    y?: FunctionMaybe<number | string | undefined>;
  }
  interface LineSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "marker-start" | "marker-mid" | "marker-end"> {
    x1?: FunctionMaybe<number | string | undefined>;
    x2?: FunctionMaybe<number | string | undefined>;
    y1?: FunctionMaybe<number | string | undefined>;
    y2?: FunctionMaybe<number | string | undefined>;
  }
  interface LinearGradientSVGAttributes<T> extends GradientElementSVGAttributes<T> {
    x1?: FunctionMaybe<number | string | undefined>;
    x2?: FunctionMaybe<number | string | undefined>;
    y1?: FunctionMaybe<number | string | undefined>;
    y2?: FunctionMaybe<number | string | undefined>;
  }
  interface MarkerSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      FitToViewBoxSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "overflow" | "clip"> {
    markerHeight?: FunctionMaybe<number | string | undefined>;
    markerUnits?: FunctionMaybe<"strokeWidth" | "userSpaceOnUse" | undefined>;
    markerWidth?: FunctionMaybe<number | string | undefined>;
    orient?: FunctionMaybe<string | undefined>;
    refX?: FunctionMaybe<number | string | undefined>;
    refY?: FunctionMaybe<number | string | undefined>;
  }
  interface MaskSVGAttributes<T>
    extends Omit<ContainerElementSVGAttributes<T>, "opacity" | "filter">,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    height?: FunctionMaybe<number | string | undefined>;
    maskContentUnits?: FunctionMaybe<SVGUnits | undefined>;
    maskUnits?: FunctionMaybe<SVGUnits | undefined>;
    width?: FunctionMaybe<number | string | undefined>;
    x?: FunctionMaybe<number | string | undefined>;
    y?: FunctionMaybe<number | string | undefined>;
  }
  interface MetadataSVGAttributes<T> extends CoreSVGAttributes<T> {}
  interface MPathSVGAttributes<T> extends CoreSVGAttributes<T> {}
  interface PathSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "marker-start" | "marker-mid" | "marker-end"> {
    d?: FunctionMaybe<string | undefined>;
    pathLength?: FunctionMaybe<number | string | undefined>;
  }
  interface PatternSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      FitToViewBoxSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "overflow" | "clip"> {
    height?: FunctionMaybe<number | string | undefined>;
    href?: FunctionMaybe<string | undefined>;
    patternContentUnits?: FunctionMaybe<SVGUnits | undefined>;
    patternTransform?: FunctionMaybe<string | undefined>;
    patternUnits?: FunctionMaybe<SVGUnits | undefined>;
    width?: FunctionMaybe<number | string | undefined>;
    x?: FunctionMaybe<number | string | undefined>;
    y?: FunctionMaybe<number | string | undefined>;
  }
  interface PolygonSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "marker-start" | "marker-mid" | "marker-end"> {
    points?: FunctionMaybe<string | undefined>;
  }
  interface PolylineSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "marker-start" | "marker-mid" | "marker-end"> {
    points?: FunctionMaybe<string | undefined>;
  }
  interface RadialGradientSVGAttributes<T> extends GradientElementSVGAttributes<T> {
    cx?: FunctionMaybe<number | string | undefined>;
    cy?: FunctionMaybe<number | string | undefined>;
    fx?: FunctionMaybe<number | string | undefined>;
    fy?: FunctionMaybe<number | string | undefined>;
    r?: FunctionMaybe<number | string | undefined>;
  }
  interface RectSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    height?: FunctionMaybe<number | string | undefined>;
    rx?: FunctionMaybe<number | string | undefined>;
    ry?: FunctionMaybe<number | string | undefined>;
    width?: FunctionMaybe<number | string | undefined>;
    x?: FunctionMaybe<number | string | undefined>;
    y?: FunctionMaybe<number | string | undefined>;
  }
  interface SetSVGAttributes<T>
    extends AnimationElementSVGAttributes<T>,
      StylableSVGAttributes,
      AnimationTimingSVGAttributes {}
  interface StopSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "stop-color" | "stop-opacity"> {
    offset?: FunctionMaybe<number | string | undefined>;
  }
  interface SvgSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      NewViewportSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      FitToViewBoxSVGAttributes,
      ZoomAndPanSVGAttributes,
      PresentationSVGAttributes,
      WindowEventMap<T> {
    "xmlns:xlink"?: FunctionMaybe<string | undefined>;
    contentScriptType?: FunctionMaybe<string | undefined>;
    contentStyleType?: FunctionMaybe<string | undefined>;
    height?: FunctionMaybe<number | string | undefined>;
    width?: FunctionMaybe<number | string | undefined>;
    x?: FunctionMaybe<number | string | undefined>;
    xmlns?: FunctionMaybe<string | undefined>;
    y?: FunctionMaybe<number | string | undefined>;

    /** @deprecated */
    baseProfile?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    version?: FunctionMaybe<string | undefined>;
  }
  interface SwitchSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "display" | "visibility"> {}
  interface SymbolSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      NewViewportSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      FitToViewBoxSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    height?: FunctionMaybe<number | string | undefined>;
    preserveAspectRatio?: FunctionMaybe<SVGPreserveAspectRatio | undefined>;
    refX?: FunctionMaybe<number | string | undefined>;
    refY?: FunctionMaybe<number | string | undefined>;
    viewBox?: FunctionMaybe<string | undefined>;
    width?: FunctionMaybe<number | string | undefined>;
    x?: FunctionMaybe<number | string | undefined>;
    y?: FunctionMaybe<number | string | undefined>;
  }
  interface TextSVGAttributes<T>
    extends TextContentElementSVGAttributes<T>,
      GraphicsElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "writing-mode" | "text-rendering"> {
    dx?: FunctionMaybe<number | string | undefined>;
    dy?: FunctionMaybe<number | string | undefined>;
    lengthAdjust?: FunctionMaybe<"spacing" | "spacingAndGlyphs" | undefined>;
    rotate?: FunctionMaybe<number | string | undefined>;
    textLength?: FunctionMaybe<number | string | undefined>;
    x?: FunctionMaybe<number | string | undefined>;
    y?: FunctionMaybe<number | string | undefined>;
  }
  interface TextPathSVGAttributes<T>
    extends TextContentElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      Pick<
        PresentationSVGAttributes,
        "alignment-baseline" | "baseline-shift" | "display" | "visibility"
      > {
    href?: FunctionMaybe<string | undefined>;
    method?: FunctionMaybe<"align" | "stretch" | undefined>;
    spacing?: FunctionMaybe<"auto" | "exact" | undefined>;
    startOffset?: FunctionMaybe<number | string | undefined>;
  }
  interface TSpanSVGAttributes<T>
    extends TextContentElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      Pick<
        PresentationSVGAttributes,
        "alignment-baseline" | "baseline-shift" | "display" | "visibility"
      > {
    dx?: FunctionMaybe<number | string | undefined>;
    dy?: FunctionMaybe<number | string | undefined>;
    lengthAdjust?: FunctionMaybe<"spacing" | "spacingAndGlyphs" | undefined>;
    rotate?: FunctionMaybe<number | string | undefined>;
    textLength?: FunctionMaybe<number | string | undefined>;
    x?: FunctionMaybe<number | string | undefined>;
    y?: FunctionMaybe<number | string | undefined>;
  }
  /** @see https://developer.mozilla.org/en-US/docs/Web/SVG/Element/use */
  interface UseSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      StylableSVGAttributes,
      ConditionalProcessingSVGAttributes,
      GraphicsElementSVGAttributes<T>,
      PresentationSVGAttributes,
      ExternalResourceSVGAttributes,
      TransformableSVGAttributes {
    height?: FunctionMaybe<number | string | undefined>;
    href?: FunctionMaybe<string | undefined>;
    width?: FunctionMaybe<number | string | undefined>;
    x?: FunctionMaybe<number | string | undefined>;
    y?: FunctionMaybe<number | string | undefined>;
  }
  interface ViewSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      FitToViewBoxSVGAttributes,
      ZoomAndPanSVGAttributes {
    viewTarget?: FunctionMaybe<string | undefined>;
  }

  // math elements

  /** Global `MathMLElement` interface keys only. (ex not html/svg) */
  interface MathMLAttributes<T> extends DOMAttributes<T> {
    dir?: FunctionMaybe<HTMLDir | undefined>;
    displaystyle?: FunctionMaybe<boolean | undefined>;
    scriptlevel?: FunctionMaybe<string | undefined>;
    xmlns?: FunctionMaybe<string | undefined>;

    /** @deprecated */
    href?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    mathbackground?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    mathcolor?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    mathsize?: FunctionMaybe<string | undefined>;
  }

  interface MathMLAnnotationElementAttributes<T> extends MathMLAttributes<T> {
    encoding?: FunctionMaybe<string | undefined>;

    /** @deprecated */
    src?: FunctionMaybe<string | undefined>;
  }
  interface MathMLAnnotationXmlElementAttributes<T> extends MathMLAttributes<T> {
    encoding?: FunctionMaybe<string | undefined>;

    /** @deprecated */
    src?: FunctionMaybe<string | undefined>;
  }
  interface MathMLMactionElementAttributes<T> extends MathMLAttributes<T> {
    /**
     * @deprecated
     * @non-standard
     */
    actiontype?: FunctionMaybe<"statusline" | "toggle" | undefined>;
    /**
     * @deprecated
     * @non-standard
     */
    selection?: FunctionMaybe<string | undefined>;
  }
  interface MathMLMathElementAttributes<T> extends MathMLAttributes<T> {
    display?: FunctionMaybe<"block" | "inline" | undefined>;
  }
  interface MathMLMerrorElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMfracElementAttributes<T> extends MathMLAttributes<T> {
    linethickness?: FunctionMaybe<string | undefined>;

    /**
     * @deprecated
     * @non-standard
     */
    denomalign?: FunctionMaybe<"center" | "left" | "right" | undefined>;
    /**
     * @deprecated
     * @non-standard
     */
    numalign?: FunctionMaybe<"center" | "left" | "right" | undefined>;
  }
  interface MathMLMiElementAttributes<T> extends MathMLAttributes<T> {
    mathvariant?: FunctionMaybe<"normal" | undefined>;
  }

  interface MathMLMmultiscriptsElementAttributes<T> extends MathMLAttributes<T> {
    /**
     * @deprecated
     * @non-standard
     */
    subscriptshift?: FunctionMaybe<string | undefined>;
    /**
     * @deprecated
     * @non-standard
     */
    superscriptshift?: FunctionMaybe<string | undefined>;
  }
  interface MathMLMnElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMoElementAttributes<T> extends MathMLAttributes<T> {
    fence?: FunctionMaybe<boolean | undefined>;
    form?: FunctionMaybe<"prefix" | "infix" | "postfix" | undefined>;
    largeop?: FunctionMaybe<boolean | undefined>;
    lspace?: FunctionMaybe<string | undefined>;
    maxsize?: FunctionMaybe<string | undefined>;
    minsize?: FunctionMaybe<string | undefined>;
    movablelimits?: FunctionMaybe<boolean | undefined>;
    rspace?: FunctionMaybe<string | undefined>;
    separator?: FunctionMaybe<boolean | undefined>;
    stretchy?: FunctionMaybe<boolean | undefined>;
    symmetric?: FunctionMaybe<boolean | undefined>;

    /** @non-standard */
    accent?: FunctionMaybe<boolean | undefined>;
  }
  interface MathMLMoverElementAttributes<T> extends MathMLAttributes<T> {
    accent?: FunctionMaybe<boolean | undefined>;
  }
  interface MathMLMpaddedElementAttributes<T> extends MathMLAttributes<T> {
    depth?: FunctionMaybe<string | undefined>;
    height?: FunctionMaybe<string | undefined>;
    lspace?: FunctionMaybe<string | undefined>;
    voffset?: FunctionMaybe<string | undefined>;
    width?: FunctionMaybe<string | undefined>;
  }
  interface MathMLMphantomElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMprescriptsElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMrootElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMrowElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMsElementAttributes<T> extends MathMLAttributes<T> {
    /** @deprecated */
    lquote?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    rquote?: FunctionMaybe<string | undefined>;
  }
  interface MathMLMspaceElementAttributes<T> extends MathMLAttributes<T> {
    depth?: FunctionMaybe<string | undefined>;
    height?: FunctionMaybe<string | undefined>;
    width?: FunctionMaybe<string | undefined>;
  }
  interface MathMLMsqrtElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMstyleElementAttributes<T> extends MathMLAttributes<T> {
    /**
     * @deprecated
     * @non-standard
     */
    background?: FunctionMaybe<string | undefined>;
    /**
     * @deprecated
     * @non-standard
     */
    color?: FunctionMaybe<string | undefined>;
    /**
     * @deprecated
     * @non-standard
     */
    fontsize?: FunctionMaybe<string | undefined>;
    /**
     * @deprecated
     * @non-standard
     */
    fontstyle?: FunctionMaybe<string | undefined>;
    /**
     * @deprecated
     * @non-standard
     */
    fontweight?: FunctionMaybe<string | undefined>;

    /** @deprecated */
    scriptminsize?: FunctionMaybe<string | undefined>;
    /** @deprecated */
    scriptsizemultiplier?: FunctionMaybe<string | undefined>;
  }
  interface MathMLMsubElementAttributes<T> extends MathMLAttributes<T> {
    /**
     * @deprecated
     * @non-standard
     */
    subscriptshift?: FunctionMaybe<string | undefined>;
  }
  interface MathMLMsubsupElementAttributes<T> extends MathMLAttributes<T> {
    /**
     * @deprecated
     * @non-standard
     */
    subscriptshift?: FunctionMaybe<string | undefined>;
    /**
     * @deprecated
     * @non-standard
     */
    superscriptshift?: FunctionMaybe<string | undefined>;
  }
  interface MathMLMsupElementAttributes<T> extends MathMLAttributes<T> {
    /**
     * @deprecated
     * @non-standard
     */
    superscriptshift?: FunctionMaybe<string | undefined>;
  }
  interface MathMLMtableElementAttributes<T> extends MathMLAttributes<T> {
    /** @non-standard */
    align?: FunctionMaybe<"axis" | "baseline" | "bottom" | "center" | "top" | undefined>;
    /** @non-standard */
    columnalign?: FunctionMaybe<"center" | "left" | "right" | undefined>;
    /** @non-standard */
    columnlines?: FunctionMaybe<"dashed" | "none" | "solid" | undefined>;
    /** @non-standard */
    columnspacing?: FunctionMaybe<string | undefined>;
    /** @non-standard */
    frame?: FunctionMaybe<"dashed" | "none" | "solid" | undefined>;
    /** @non-standard */
    framespacing?: FunctionMaybe<string | undefined>;
    /** @non-standard */
    rowalign?: FunctionMaybe<"axis" | "baseline" | "bottom" | "center" | "top" | undefined>;
    /** @non-standard */
    rowlines?: FunctionMaybe<"dashed" | "none" | "solid" | undefined>;
    /** @non-standard */
    rowspacing?: FunctionMaybe<string | undefined>;
    /** @non-standard */
    width?: FunctionMaybe<string | undefined>;
  }
  interface MathMLMtdElementAttributes<T> extends MathMLAttributes<T> {
    columnspan?: FunctionMaybe<number | string | undefined>;
    rowspan?: FunctionMaybe<number | string | undefined>;
    /** @non-standard */
    columnalign?: FunctionMaybe<"center" | "left" | "right" | undefined>;
    /** @non-standard */
    rowalign?: FunctionMaybe<"axis" | "baseline" | "bottom" | "center" | "top" | undefined>;
  }
  interface MathMLMtextElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMtrElementAttributes<T> extends MathMLAttributes<T> {
    /** @non-standard */
    columnalign?: FunctionMaybe<"center" | "left" | "right" | undefined>;
    /** @non-standard */
    rowalign?: FunctionMaybe<"axis" | "baseline" | "bottom" | "center" | "top" | undefined>;
  }
  interface MathMLMunderElementAttributes<T> extends MathMLAttributes<T> {
    accentunder?: FunctionMaybe<"" | boolean | undefined>;
  }
  interface MathMLMunderoverElementAttributes<T> extends MathMLAttributes<T> {
    accent?: FunctionMaybe<"" | boolean | undefined>;
    accentunder?: FunctionMaybe<"" | boolean | undefined>;
  }
  interface MathMLSemanticsElementAttributes<T> extends MathMLAttributes<T> {}

  /* MathMLDeprecatedElements */

  interface MathMLMencloseElementAttributes<T> extends MathMLAttributes<T> {
    /** @non-standard */
    notation?: FunctionMaybe<string | undefined>;
  }
  interface MathMLMfencedElementAttributes<T> extends MathMLAttributes<T> {
    close?: FunctionMaybe<string | undefined>;
    open?: FunctionMaybe<string | undefined>;
    separators?: FunctionMaybe<string | undefined>;
  }

  /** @type {HTMLElementTagNameMap} */
  interface HTMLElementTags {
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLAnchorElement
     */
    a: AnchorHTMLAttributes<HTMLAnchorElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/abbr
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    abbr: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/address
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    address: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/area
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLAreaElement
     */
    area: AreaHTMLAttributes<HTMLAreaElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/article
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    article: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/aside
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    aside: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLAudioElement
     */
    audio: AudioHTMLAttributes<HTMLAudioElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/b
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    b: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/base
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLBaseElement
     */
    base: BaseHTMLAttributes<HTMLBaseElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/bdi
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    bdi: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/bdo
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    bdo: BdoHTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/blockquote
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLQuoteElement
     */
    blockquote: BlockquoteHTMLAttributes<HTMLQuoteElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/body
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLBodyElement
     */
    body: BodyHTMLAttributes<HTMLBodyElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/br
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLBRElement
     */
    br: HTMLAttributes<HTMLBRElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLButtonElement
     */
    button: ButtonHTMLAttributes<HTMLButtonElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement
     */
    canvas: CanvasHTMLAttributes<HTMLCanvasElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/caption
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableCaptionElement
     */
    caption: CaptionHTMLAttributes<HTMLTableCaptionElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/cite
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    cite: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/code
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    code: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/col
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableColElement
     */
    col: ColHTMLAttributes<HTMLTableColElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/colgroup
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableColElement
     */
    colgroup: ColgroupHTMLAttributes<HTMLTableColElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/data
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLDataElement
     */
    data: DataHTMLAttributes<HTMLDataElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/datalist
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLDataListElement
     */
    datalist: HTMLAttributes<HTMLDataListElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dd
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    dd: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/del
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLModElement
     */
    del: ModHTMLAttributes<HTMLModElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/details
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLDetailsElement
     */
    details: DetailsHtmlAttributes<HTMLDetailsElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dfn
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    dfn: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement
     */
    dialog: DialogHtmlAttributes<HTMLDialogElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/div
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLDivElement
     */
    div: HTMLAttributes<HTMLDivElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dl
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLDListElement
     */
    dl: HTMLAttributes<HTMLDListElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dt
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    dt: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/em
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    em: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/embed
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLEmbedElement
     */
    embed: EmbedHTMLAttributes<HTMLEmbedElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/fieldset
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLFieldSetElement
     */
    fieldset: FieldsetHTMLAttributes<HTMLFieldSetElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/figcaption
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    figcaption: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/figure
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    figure: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/footer
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    footer: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement
     */
    form: FormHTMLAttributes<HTMLFormElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/h1
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHeadingElement
     */
    h1: HTMLAttributes<HTMLHeadingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/h2
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHeadingElement
     */
    h2: HTMLAttributes<HTMLHeadingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/h3
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHeadingElement
     */
    h3: HTMLAttributes<HTMLHeadingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/h4
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHeadingElement
     */
    h4: HTMLAttributes<HTMLHeadingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/h5
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHeadingElement
     */
    h5: HTMLAttributes<HTMLHeadingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/h6
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHeadingElement
     */
    h6: HTMLAttributes<HTMLHeadingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/head
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHeadElement
     */
    head: HTMLAttributes<HTMLHeadElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/header
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    header: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/hgroup
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    hgroup: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/hr
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHRElement
     */
    hr: HTMLAttributes<HTMLHRElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/html
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHtmlElement
     */
    html: HTMLAttributes<HTMLHtmlElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/i
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    i: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement
     */
    iframe: IframeHTMLAttributes<HTMLIFrameElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/img
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement
     */
    img: ImgHTMLAttributes<HTMLImageElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement
     */
    input: InputHTMLAttributes<HTMLInputElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ins
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLModElement
     */
    ins: ModHTMLAttributes<HTMLModElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/kbd
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    kbd: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/label
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLLabelElement
     */
    label: LabelHTMLAttributes<HTMLLabelElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/legend
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLLegendElement
     */
    legend: HTMLAttributes<HTMLLegendElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/li
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLLIElement
     */
    li: LiHTMLAttributes<HTMLLIElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLLinkElement
     */
    link: LinkHTMLAttributes<HTMLLinkElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/main
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    main: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/map
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLMapElement
     */
    map: MapHTMLAttributes<HTMLMapElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/mark
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    mark: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/menu
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLMenuElement
     */
    menu: MenuHTMLAttributes<HTMLMenuElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLMetaElement
     */
    meta: MetaHTMLAttributes<HTMLMetaElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meter
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLMeterElement
     */
    meter: MeterHTMLAttributes<HTMLMeterElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/nav
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    nav: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/noscript
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    noscript: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/object
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLObjectElement
     */
    object: ObjectHTMLAttributes<HTMLObjectElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ol
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLOListElement
     */
    ol: OlHTMLAttributes<HTMLOListElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/optgroup
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLOptGroupElement
     */
    optgroup: OptgroupHTMLAttributes<HTMLOptGroupElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/option
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLOptionElement
     */
    option: OptionHTMLAttributes<HTMLOptionElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/output
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLOutputElement
     */
    output: OutputHTMLAttributes<HTMLOutputElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/p
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLParagraphElement
     */
    p: HTMLAttributes<HTMLParagraphElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/picture
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLPictureElement
     */
    picture: HTMLAttributes<HTMLPictureElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/pre
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLPreElement
     */
    pre: HTMLAttributes<HTMLPreElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/progress
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLProgressElement
     */
    progress: ProgressHTMLAttributes<HTMLProgressElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/q
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLQuoteElement
     */
    q: QuoteHTMLAttributes<HTMLQuoteElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/rp
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    rp: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/rt
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    rt: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ruby
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    ruby: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/s
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    s: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/samp
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    samp: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLScriptElement
     */
    script: ScriptHTMLAttributes<HTMLScriptElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/search
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    search: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/section
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    section: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/select
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLSelectElement
     */
    select: SelectHTMLAttributes<HTMLSelectElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/slot
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLSlotElement
     */
    slot: HTMLSlotElementAttributes<HTMLSlotElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/small
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    small: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/source
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLSourceElement
     */
    source: SourceHTMLAttributes<HTMLSourceElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/span
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLSpanElement
     */
    span: HTMLAttributes<HTMLSpanElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/strong
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    strong: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/style
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLStyleElement
     */
    style: StyleHTMLAttributes<HTMLStyleElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/sub
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    sub: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/summary
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    summary: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/sup
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    sup: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/table
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableElement
     */
    table: HTMLAttributes<HTMLTableElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/tbody
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableSectionElement
     */
    tbody: HTMLAttributes<HTMLTableSectionElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/td
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableCellElement
     */
    td: TdHTMLAttributes<HTMLTableCellElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTemplateElement
     */
    template: TemplateHTMLAttributes<HTMLTemplateElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/textarea
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTextAreaElement
     */
    textarea: TextareaHTMLAttributes<HTMLTextAreaElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/tfoot
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableSectionElement
     */
    tfoot: HTMLAttributes<HTMLTableSectionElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/th
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableCellElement
     */
    th: ThHTMLAttributes<HTMLTableCellElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/thead
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableSectionElement
     */
    thead: HTMLAttributes<HTMLTableSectionElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/time
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTimeElement
     */
    time: TimeHTMLAttributes<HTMLTimeElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/title
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTitleElement
     */
    title: HTMLAttributes<HTMLTitleElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/tr
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableRowElement
     */
    tr: HTMLAttributes<HTMLTableRowElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/track
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTrackElement
     */
    track: TrackHTMLAttributes<HTMLTrackElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/u
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    u: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ul
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLUListElement
     */
    ul: HTMLAttributes<HTMLUListElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/var
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    var: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement
     */
    video: VideoHTMLAttributes<HTMLVideoElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/wbr
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    wbr: HTMLAttributes<HTMLElement>;
    /** @url https://www.electronjs.org/docs/latest/api/webview-tag */
    webview: WebViewHTMLAttributes<HTMLElement>;
  }
  /** @type {HTMLElementDeprecatedTagNameMap} */
  interface HTMLElementDeprecatedTags {
    /**
     * @deprecated
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/big
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    big: HTMLAttributes<HTMLElement>;
    /**
     * @deprecated
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/keygen
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLUnknownElement
     */
    keygen: KeygenHTMLAttributes<HTMLUnknownElement>;
    /**
     * @deprecated
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/menuitem
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLUnknownElement
     */
    menuitem: HTMLAttributes<HTMLUnknownElement>;
    /**
     * @deprecated
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/param
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLParamElement
     */
    param: ParamHTMLAttributes<HTMLParamElement>;
  }
  /** @type {SVGElementTagNameMap} */
  interface SVGElementTags {
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/animate
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGAnimateElement
     */
    animate: AnimateSVGAttributes<SVGAnimateElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/animateMotion
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGAnimateMotionElement
     */
    animateMotion: AnimateMotionSVGAttributes<SVGAnimateMotionElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/animateTransform
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGAnimateTransformElement
     */
    animateTransform: AnimateTransformSVGAttributes<SVGAnimateTransformElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/circle
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGCircleElement
     */
    circle: CircleSVGAttributes<SVGCircleElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/clipPath
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGClipPathElement
     */
    clipPath: ClipPathSVGAttributes<SVGClipPathElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/defs
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGDefsElement
     */
    defs: DefsSVGAttributes<SVGDefsElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/desc
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGDescElement
     */
    desc: DescSVGAttributes<SVGDescElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/ellipse
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGEllipseElement
     */
    ellipse: EllipseSVGAttributes<SVGEllipseElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feBlend
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEBlendElement
     */
    feBlend: FeBlendSVGAttributes<SVGFEBlendElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feColorMatrix
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEColorMatrixElement
     */
    feColorMatrix: FeColorMatrixSVGAttributes<SVGFEColorMatrixElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feComponentTransfer
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEComponentTransferElemen
     */
    feComponentTransfer: FeComponentTransferSVGAttributes<SVGFEComponentTransferElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feComposite
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFECompositeElement
     */
    feComposite: FeCompositeSVGAttributes<SVGFECompositeElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feConvolveMatrix
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEConvolveMatrixElement
     */
    feConvolveMatrix: FeConvolveMatrixSVGAttributes<SVGFEConvolveMatrixElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feDiffuseLighting
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEDiffuseLightingElement
     */
    feDiffuseLighting: FeDiffuseLightingSVGAttributes<SVGFEDiffuseLightingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feDisplacementMap
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEDisplacementMapElement
     */
    feDisplacementMap: FeDisplacementMapSVGAttributes<SVGFEDisplacementMapElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feDistantLight
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEDistantLightElement
     */
    feDistantLight: FeDistantLightSVGAttributes<SVGFEDistantLightElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feDropShadow
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEDropShadowElement
     */
    feDropShadow: FeDropShadowSVGAttributes<SVGFEDropShadowElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feFlood
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEFloodElement
     */
    feFlood: FeFloodSVGAttributes<SVGFEFloodElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feFuncA
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEFuncAElement
     */
    feFuncA: FeFuncSVGAttributes<SVGFEFuncAElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feFuncB
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEFuncBElement
     */
    feFuncB: FeFuncSVGAttributes<SVGFEFuncBElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feFuncG
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEFuncGElement
     */
    feFuncG: FeFuncSVGAttributes<SVGFEFuncGElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feFuncR
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEFuncRElement
     */
    feFuncR: FeFuncSVGAttributes<SVGFEFuncRElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feGaussianBlur
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEGaussianBlurElement
     */
    feGaussianBlur: FeGaussianBlurSVGAttributes<SVGFEGaussianBlurElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feImage
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEImageElement
     */
    feImage: FeImageSVGAttributes<SVGFEImageElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feMerge
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEMergeElement
     */
    feMerge: FeMergeSVGAttributes<SVGFEMergeElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feMergeNode
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEMergeNodeElement
     */
    feMergeNode: FeMergeNodeSVGAttributes<SVGFEMergeNodeElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feMorphology
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEMorphologyElement
     */
    feMorphology: FeMorphologySVGAttributes<SVGFEMorphologyElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feOffset
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEOffsetElement
     */
    feOffset: FeOffsetSVGAttributes<SVGFEOffsetElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/fePointLight
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEPointLightElement
     */
    fePointLight: FePointLightSVGAttributes<SVGFEPointLightElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feSpecularLighting
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFESpecularLightingElement
     */
    feSpecularLighting: FeSpecularLightingSVGAttributes<SVGFESpecularLightingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feSpotLight
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFESpotLightElement
     */
    feSpotLight: FeSpotLightSVGAttributes<SVGFESpotLightElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feTile
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFETileElement
     */
    feTile: FeTileSVGAttributes<SVGFETileElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feTurbulence
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFETurbulenceElement
     */
    feTurbulence: FeTurbulanceSVGAttributes<SVGFETurbulenceElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/filter
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFilterElement
     */
    filter: FilterSVGAttributes<SVGFilterElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/foreignObject
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGForeignObjectElement
     */
    foreignObject: ForeignObjectSVGAttributes<SVGForeignObjectElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/g
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGGElement
     */
    g: GSVGAttributes<SVGGElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/image
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGImageElement
     */
    image: ImageSVGAttributes<SVGImageElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/line
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGLineElement
     */
    line: LineSVGAttributes<SVGLineElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/linearGradient
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGLinearGradientElement
     */
    linearGradient: LinearGradientSVGAttributes<SVGLinearGradientElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/marker
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGMarkerElement
     */
    marker: MarkerSVGAttributes<SVGMarkerElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/mask
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGMaskElement
     */
    mask: MaskSVGAttributes<SVGMaskElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/metadata
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGMetadataElement
     */
    metadata: MetadataSVGAttributes<SVGMetadataElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/mpath
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGMPathElement
     */
    mpath: MPathSVGAttributes<SVGMPathElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/path
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGPathElement
     */
    path: PathSVGAttributes<SVGPathElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/pattern
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGPatternElement
     */
    pattern: PatternSVGAttributes<SVGPatternElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/polygon
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGPolygonElement
     */
    polygon: PolygonSVGAttributes<SVGPolygonElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/polyline
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGPolylineElement
     */
    polyline: PolylineSVGAttributes<SVGPolylineElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/radialGradient
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGRadialGradientElement
     */
    radialGradient: RadialGradientSVGAttributes<SVGRadialGradientElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/rect
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGRectElement
     */
    rect: RectSVGAttributes<SVGRectElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/set
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGSetElement
     */
    set: SetSVGAttributes<SVGSetElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/stop
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGStopElement
     */
    stop: StopSVGAttributes<SVGStopElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/svg
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGSVGElement
     */
    svg: SvgSVGAttributes<SVGSVGElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/switch
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGSwitchElement
     */
    switch: SwitchSVGAttributes<SVGSwitchElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/symbol
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGSymbolElement
     */
    symbol: SymbolSVGAttributes<SVGSymbolElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/text
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGTextElement
     */
    text: TextSVGAttributes<SVGTextElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/textPath
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGTextPathElement
     */
    textPath: TextPathSVGAttributes<SVGTextPathElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/tspan
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGTSpanElement
     */
    tspan: TSpanSVGAttributes<SVGTSpanElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/use
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGUseElement
     */
    use: UseSVGAttributes<SVGUseElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/view
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGViewElement
     */
    view: ViewSVGAttributes<SVGViewElement>;
  }

  interface MathMLElementTags {
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/annotation
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    annotation: MathMLAnnotationElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/annotation-xml
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    "annotation-xml": MathMLAnnotationXmlElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/math
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    math: MathMLMathElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/merror
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    merror: MathMLMerrorElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mfrac
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mfrac: MathMLMfracElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mi
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mi: MathMLMiElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mmultiscripts
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mmultiscripts: MathMLMmultiscriptsElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mn
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mn: MathMLMnElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mo
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mo: MathMLMoElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mover
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mover: MathMLMoverElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mpadded
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mpadded: MathMLMpaddedElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mphantom
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mphantom: MathMLMphantomElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mprescripts
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mprescripts: MathMLMprescriptsElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mroot
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mroot: MathMLMrootElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mrow
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mrow: MathMLMrowElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/ms
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    ms: MathMLMsElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mspace
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mspace: MathMLMspaceElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/msqrt
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    msqrt: MathMLMsqrtElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mstyle
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mstyle: MathMLMstyleElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/msub
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    msub: MathMLMsubElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/msubsup
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    msubsup: MathMLMsubsupElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/msup
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    msup: MathMLMsupElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mtable
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mtable: MathMLMtableElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mtd
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mtd: MathMLMtdElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mtext
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mtext: MathMLMtextElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mtr
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mtr: MathMLMtrElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/munder
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    munder: MathMLMunderElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/munderover
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    munderover: MathMLMunderoverElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/semantics
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    semantics: MathMLSemanticsElementAttributes<MathMLElement>;
    /**
     * @non-standard
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/menclose
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    menclose: MathMLMencloseElementAttributes<MathMLElement>;
    /**
     * @deprecated
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/maction
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    maction: MathMLMactionElementAttributes<MathMLElement>;
    /**
     * @deprecated
     * @non-standard
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mfenced
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mfenced: MathMLMfencedElementAttributes<MathMLElement>;
  }

  interface IntrinsicElements
    extends HTMLElementTags,
      HTMLElementDeprecatedTags,
      SVGElementTags,
      MathMLElementTags {}
}
