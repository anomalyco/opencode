import {
  Clipboard,
  InternalKeyHandler,
  KeyHandler,
  NativeMeasureTargetKind,
  OptimizedBuffer,
  RGBA,
  Selection,
  SpanInfoStruct,
  StdinParser,
  StyledText,
  SystemClock,
  TextBuffer,
  borderCharsToArray,
  buildTerminalPaletteSignature,
  convertGlobalToLocalSelection,
  createExtmarksController,
  createTerminalPalette,
  createTextAttributes,
  destroyTreeSitterClient,
  env,
  getBorderSides,
  getTreeSitterClient,
  isStyledText,
  normalizeTerminalPalette,
  parseAlign,
  parseAlignItems,
  parseBorderStyle,
  parseColor,
  parseFlexDirection,
  parseJustify,
  parseOverflow,
  parsePositionType,
  parseWrap,
  registerEnvVar,
  resolveRenderLib,
  singleton,
  sleep,
  stringToStyledText,
  toArrayBuffer,
  treeSitterToTextChunks,
  yoga_default
} from "./chunk-node-q0cwyvm9.js";

// src/Renderable.ts
import { EventEmitter } from "events";

// src/lib/renderable.validations.ts
function validateOptions(id, options) {
  if (typeof options.width === "number") {
    if (options.width < 0) {
      throw new TypeError(`Invalid width for Renderable ${id}: ${options.width}`);
    }
  }
  if (typeof options.height === "number") {
    if (options.height < 0) {
      throw new TypeError(`Invalid height for Renderable ${id}: ${options.height}`);
    }
  }
}
function isValidPercentage(value) {
  if (typeof value === "string" && value.endsWith("%")) {
    const numPart = value.slice(0, -1);
    const num = parseFloat(numPart);
    return !Number.isNaN(num);
  }
  return false;
}
function isMarginType(value) {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return true;
  }
  if (value === "auto") {
    return true;
  }
  return isValidPercentage(value);
}
function isPaddingType(value) {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return true;
  }
  return isValidPercentage(value);
}
function isPositionType(value) {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return true;
  }
  if (value === "auto") {
    return true;
  }
  return isValidPercentage(value);
}
function isPositionTypeType(value) {
  return value === "relative" || value === "absolute";
}
function isOverflowType(value) {
  return value === "visible" || value === "hidden" || value === "scroll";
}
function isDimensionType(value) {
  return isPositionType(value);
}
function isFlexBasisType(value) {
  if (value === undefined || value === "auto") {
    return true;
  }
  if (typeof value === "number" && !Number.isNaN(value)) {
    return true;
  }
  return false;
}
function isSizeType(value) {
  if (value === undefined) {
    return true;
  }
  if (typeof value === "number" && !Number.isNaN(value)) {
    return true;
  }
  return isValidPercentage(value);
}

// src/Renderable.ts
var BrandedRenderable = Symbol.for("@opentui/core/Renderable");
var LayoutEvents;
((LayoutEvents2) => {
  LayoutEvents2["LAYOUT_CHANGED"] = "layout-changed";
  LayoutEvents2["RESIZED"] = "resized";
})(LayoutEvents ||= {});
var RenderableEvents;
((RenderableEvents2) => {
  RenderableEvents2["FOCUSED"] = "focused";
  RenderableEvents2["BLURRED"] = "blurred";
  RenderableEvents2["DESTROYED"] = "destroyed";
})(RenderableEvents ||= {});
function isRenderable(obj) {
  return !!obj?.[BrandedRenderable];
}

class BaseRenderable extends EventEmitter {
  [BrandedRenderable] = true;
  static renderableNumber = 1;
  _id;
  num;
  _dirty = false;
  parent = null;
  _visible = true;
  constructor(options) {
    super();
    this.num = BaseRenderable.renderableNumber++;
    this._id = options.id ?? `renderable-${this.num}`;
  }
  get id() {
    return this._id;
  }
  set id(value) {
    this._id = value;
  }
  get isDirty() {
    return this._dirty;
  }
  markClean() {
    this._dirty = false;
  }
  markDirty() {
    this._dirty = true;
  }
  destroy() {}
  destroyRecursively() {}
  get visible() {
    return this._visible;
  }
  set visible(value) {
    this._visible = value;
  }
}
function getLayoutGeneration(ctx) {
  return ctx.__otuiLayoutGeneration ?? 0;
}
function bumpLayoutGeneration(ctx) {
  const next = getLayoutGeneration(ctx) + 1;
  const generationContext = ctx;
  generationContext.__otuiLayoutGeneration = next;
  return next;
}
function getRenderListRevision(ctx) {
  return ctx.__otuiRenderListRevision ?? 0;
}
function bumpRenderListRevision(ctx) {
  const generationContext = ctx;
  generationContext.__otuiRenderListRevision = getRenderListRevision(ctx) + 1;
}

class Renderable extends BaseRenderable {
  static renderablesByNumber = new Map;
  _isDestroyed = false;
  _ctx;
  _translateX = 0;
  _translateY = 0;
  _x = 0;
  _y = 0;
  _screenX = 0;
  _screenY = 0;
  _width;
  _height;
  _widthValue = 0;
  _heightValue = 0;
  _zIndex;
  selectable = false;
  buffered;
  frameBuffer = null;
  _focusable = false;
  _focused = false;
  _hasFocusedDescendant = false;
  keypressHandler = null;
  pasteHandler = null;
  _live = false;
  _liveCount = 0;
  _sizeChangeListener = undefined;
  _mouseListener = null;
  _mouseListeners = {};
  _pasteListener = undefined;
  _keyListeners = {};
  yogaNode;
  _positionType = "relative";
  _overflow = "visible";
  _position = {};
  _opacity = 1;
  _flexShrink = 1;
  _childrenInLayoutOrder = [];
  _childrenInZIndexOrder = [];
  needsZIndexSort = false;
  parent = null;
  childrenPrimarySortDirty = true;
  childrenSortedByPrimaryAxis = [];
  _shouldUpdateBefore = new Set;
  _lastLayoutFrame = -1;
  onLifecyclePass = null;
  renderBefore;
  renderAfter;
  constructor(ctx, options) {
    super(options);
    this._ctx = ctx;
    Renderable.renderablesByNumber.set(this.num, this);
    validateOptions(this.id, options);
    this.renderBefore = options.renderBefore;
    this.renderAfter = options.renderAfter;
    this._width = options.width ?? "auto";
    this._height = options.height ?? "auto";
    if (typeof this._width === "number") {
      this._widthValue = this._width;
    }
    if (typeof this._height === "number") {
      this._heightValue = this._height;
    }
    this._zIndex = options.zIndex ?? 0;
    this._visible = options.visible !== false;
    this.buffered = options.buffered ?? false;
    this._live = options.live ?? false;
    this._liveCount = this._live && this._visible ? 1 : 0;
    this._opacity = options.opacity !== undefined ? Math.max(0, Math.min(1, options.opacity)) : 1;
    this.yogaNode = yoga_default.Node.createForOpenTUI();
    this.yogaNode.setDisplay(this._visible ? 0 /* Flex */ : 1 /* None */);
    this.setupYogaProperties(options);
    this.applyEventOptions(options);
    if (this.buffered) {
      this.createFrameBuffer();
    }
  }
  get focusable() {
    return this._focusable;
  }
  set focusable(value) {
    this._focusable = value;
  }
  get ctx() {
    return this._ctx;
  }
  get visible() {
    return this._visible;
  }
  get primaryAxis() {
    const dir = this.yogaNode.getFlexDirection();
    return dir === 2 || dir === 3 ? "row" : "column";
  }
  set visible(value) {
    if (this._visible === value)
      return;
    const wasVisible = this._visible;
    this._visible = value;
    this.yogaNode.setDisplay(value ? 0 /* Flex */ : 1 /* None */);
    bumpRenderListRevision(this._ctx);
    if (this._live) {
      if (!wasVisible && value) {
        this.propagateLiveCount(1);
      } else if (wasVisible && !value) {
        this.propagateLiveCount(-1);
      }
    }
    if (this._focused) {
      this.blur();
    }
    this.requestRender();
  }
  get opacity() {
    return this._opacity;
  }
  set opacity(value) {
    const clamped = Math.max(0, Math.min(1, value));
    if (this._opacity !== clamped) {
      this._opacity = clamped;
      bumpRenderListRevision(this._ctx);
      this.requestRender();
    }
  }
  hasSelection() {
    return false;
  }
  onSelectionChanged(selection) {
    return false;
  }
  getSelectedText() {
    return "";
  }
  shouldStartSelection(x, y) {
    return false;
  }
  focus() {
    if (this._isDestroyed || this._focused || !this._focusable)
      return;
    this._focused = true;
    this._ctx.focusRenderable(this);
    this.requestRender();
    this.keypressHandler = (key) => {
      if (this._isDestroyed)
        return;
      this._keyListeners["down"]?.(key);
      if (this._isDestroyed)
        return;
      if (!key.defaultPrevented && this.handleKeyPress) {
        this.handleKeyPress(key);
      }
    };
    this.pasteHandler = (event) => {
      if (this._isDestroyed)
        return;
      this._pasteListener?.call(this, event);
      if (this._isDestroyed)
        return;
      if (!event.defaultPrevented && this.handlePaste) {
        this.handlePaste(event);
      }
    };
    this.ctx._internalKeyInput.onInternal("keypress", this.keypressHandler);
    this.ctx._internalKeyInput.onInternal("paste", this.pasteHandler);
    this.propagateFocusChange(true);
    this.emit("focused" /* FOCUSED */);
  }
  propagateFocusChange(hasFocus) {
    let parent = this.parent;
    while (parent) {
      if (parent._hasFocusedDescendant !== hasFocus) {
        parent._hasFocusedDescendant = hasFocus;
        parent.markDirty();
      }
      parent = parent.parent;
    }
    this.requestRender();
  }
  blur() {
    if (!this._focused || !this._focusable)
      return;
    this._ctx.blurRenderable(this);
    this._focused = false;
    this.requestRender();
    if (this.keypressHandler) {
      this.ctx._internalKeyInput.offInternal("keypress", this.keypressHandler);
      this.keypressHandler = null;
    }
    if (this.pasteHandler) {
      this.ctx._internalKeyInput.offInternal("paste", this.pasteHandler);
      this.pasteHandler = null;
    }
    this.propagateFocusChange(false);
    this.emit("blurred" /* BLURRED */);
  }
  get focused() {
    return this._focused;
  }
  get hasFocusedDescendant() {
    return this._hasFocusedDescendant;
  }
  get live() {
    return this._live;
  }
  get liveCount() {
    return this._liveCount;
  }
  set live(value) {
    if (this._live === value)
      return;
    this._live = value;
    if (this._visible) {
      const delta = value ? 1 : -1;
      this.propagateLiveCount(delta);
    }
  }
  propagateLiveCount(delta) {
    this._liveCount += delta;
    this.parent?.propagateLiveCount(delta);
  }
  findDescendantById(id) {
    for (const child of this._childrenInLayoutOrder) {
      if (child.id === id)
        return child;
      if (isRenderable(child)) {
        const found = child.findDescendantById(id);
        if (found)
          return found;
      }
    }
    return;
  }
  requestRender() {
    this.markDirty();
    this._ctx.requestRender();
  }
  get translateX() {
    return this._translateX;
  }
  set translateX(value) {
    if (this._translateX === value)
      return;
    this._translateX = value;
    const parentScreenX = this.parent ? this.parent._screenX : 0;
    this._screenX = parentScreenX + this._x + this._translateX;
    if (this.parent)
      this.parent.childrenPrimarySortDirty = true;
    bumpRenderListRevision(this._ctx);
    this.requestRender();
  }
  get translateY() {
    return this._translateY;
  }
  set translateY(value) {
    if (this._translateY === value)
      return;
    this._translateY = value;
    const parentScreenY = this.parent ? this.parent._screenY : 0;
    this._screenY = parentScreenY + this._y + this._translateY;
    if (this.parent)
      this.parent.childrenPrimarySortDirty = true;
    bumpRenderListRevision(this._ctx);
    this.requestRender();
  }
  get screenX() {
    const parentScreenX = this.parent ? this.parent._screenX : 0;
    return parentScreenX + this._x + this._translateX;
  }
  get screenY() {
    const parentScreenY = this.parent ? this.parent._screenY : 0;
    return parentScreenY + this._y + this._translateY;
  }
  get x() {
    if (this.parent) {
      return this.parent.x + this._x + this._translateX;
    }
    return this._x + this._translateX;
  }
  set x(value) {
    this.left = value;
  }
  get top() {
    return this._position.top;
  }
  set top(value) {
    if (isPositionType(value) || value === undefined) {
      this.setPosition({ top: value });
    }
  }
  get right() {
    return this._position.right;
  }
  set right(value) {
    if (isPositionType(value) || value === undefined) {
      this.setPosition({ right: value });
    }
  }
  get bottom() {
    return this._position.bottom;
  }
  set bottom(value) {
    if (isPositionType(value) || value === undefined) {
      this.setPosition({ bottom: value });
    }
  }
  get left() {
    return this._position.left;
  }
  set left(value) {
    if (isPositionType(value) || value === undefined) {
      this.setPosition({ left: value });
    }
  }
  get y() {
    if (this.parent) {
      return this.parent.y + this._y + this._translateY;
    }
    return this._y + this._translateY;
  }
  set y(value) {
    this.top = value;
  }
  get width() {
    return this._widthValue;
  }
  set width(value) {
    if (!isDimensionType(value) || this._width === value) {
      return;
    }
    this._width = value;
    this.yogaNode.setWidth(value);
    if (typeof value === "number" && this._flexShrink === 1) {
      this._flexShrink = 0;
      this.yogaNode.setFlexShrink(0);
    }
    this.requestRender();
  }
  get height() {
    return this._heightValue;
  }
  set height(value) {
    if (!isDimensionType(value) || this._height === value) {
      return;
    }
    this._height = value;
    this.yogaNode.setHeight(value);
    if (typeof value === "number" && this._flexShrink === 1) {
      this._flexShrink = 0;
      this.yogaNode.setFlexShrink(0);
    }
    this.requestRender();
  }
  get zIndex() {
    return this._zIndex;
  }
  set zIndex(value) {
    if (this._zIndex !== value) {
      this._zIndex = value;
      this.parent?.requestZIndexSort();
      bumpRenderListRevision(this._ctx);
      this.requestRender();
    }
  }
  requestZIndexSort() {
    this.needsZIndexSort = true;
  }
  ensureZIndexSorted() {
    if (this.needsZIndexSort) {
      this._childrenInZIndexOrder.sort((a, b) => a.zIndex > b.zIndex ? 1 : a.zIndex < b.zIndex ? -1 : 0);
      this.needsZIndexSort = false;
    }
  }
  getChildrenSortedByPrimaryAxis() {
    if (!this.childrenPrimarySortDirty && this.childrenSortedByPrimaryAxis.length === this._childrenInLayoutOrder.length) {
      return this.childrenSortedByPrimaryAxis;
    }
    const dir = this.yogaNode.getFlexDirection();
    const axis = dir === 2 || dir === 3 ? "x" : "y";
    const sorted = [...this._childrenInLayoutOrder];
    sorted.sort((a, b) => {
      const va = axis === "y" ? a.screenY : a.screenX;
      const vb = axis === "y" ? b.screenY : b.screenX;
      return va - vb;
    });
    this.childrenSortedByPrimaryAxis = sorted;
    this.childrenPrimarySortDirty = false;
    return this.childrenSortedByPrimaryAxis;
  }
  setupYogaProperties(options) {
    const node = this.yogaNode;
    if (isFlexBasisType(options.flexBasis)) {
      node.setFlexBasis(options.flexBasis);
    }
    if (isSizeType(options.minWidth)) {
      node.setMinWidth(options.minWidth);
    }
    if (isSizeType(options.minHeight)) {
      node.setMinHeight(options.minHeight);
    }
    if (options.flexGrow !== undefined) {
      node.setFlexGrow(options.flexGrow);
    } else {
      node.setFlexGrow(0);
    }
    if (options.flexShrink !== undefined) {
      this._flexShrink = options.flexShrink;
      node.setFlexShrink(options.flexShrink);
    } else {
      const hasExplicitWidth = typeof options.width === "number";
      const hasExplicitHeight = typeof options.height === "number";
      this._flexShrink = hasExplicitWidth || hasExplicitHeight ? 0 : 1;
      node.setFlexShrink(this._flexShrink);
    }
    node.setFlexDirection(parseFlexDirection(options.flexDirection));
    node.setFlexWrap(parseWrap(options.flexWrap));
    node.setAlignItems(parseAlignItems(options.alignItems));
    node.setJustifyContent(parseJustify(options.justifyContent));
    node.setAlignSelf(parseAlign(options.alignSelf));
    if (isDimensionType(options.width)) {
      this._width = options.width;
      this.yogaNode.setWidth(options.width);
    }
    if (isDimensionType(options.height)) {
      this._height = options.height;
      this.yogaNode.setHeight(options.height);
    }
    this._positionType = options.position === "absolute" ? "absolute" : "relative";
    if (this._positionType !== "relative") {
      node.setPositionType(parsePositionType(this._positionType));
    }
    this._overflow = options.overflow === "hidden" ? "hidden" : options.overflow === "scroll" ? "scroll" : "visible";
    if (this._overflow !== "visible") {
      node.setOverflow(parseOverflow(this._overflow));
    }
    const hasPositionProps = options.top !== undefined || options.right !== undefined || options.bottom !== undefined || options.left !== undefined;
    if (hasPositionProps) {
      this._position = {
        top: options.top,
        right: options.right,
        bottom: options.bottom,
        left: options.left
      };
      this.updateYogaPosition(this._position);
    }
    if (isSizeType(options.maxWidth)) {
      node.setMaxWidth(options.maxWidth);
    }
    if (isSizeType(options.maxHeight)) {
      node.setMaxHeight(options.maxHeight);
    }
    this.setupMarginAndPadding(options);
  }
  setupMarginAndPadding(options) {
    const node = this.yogaNode;
    if (isMarginType(options.margin)) {
      node.setMargin(8 /* All */, options.margin);
    }
    if (isMarginType(options.marginX)) {
      node.setMargin(6 /* Horizontal */, options.marginX);
    }
    if (isMarginType(options.marginY)) {
      node.setMargin(7 /* Vertical */, options.marginY);
    }
    if (isMarginType(options.marginTop)) {
      node.setMargin(1 /* Top */, options.marginTop);
    }
    if (isMarginType(options.marginRight)) {
      node.setMargin(2 /* Right */, options.marginRight);
    }
    if (isMarginType(options.marginBottom)) {
      node.setMargin(3 /* Bottom */, options.marginBottom);
    }
    if (isMarginType(options.marginLeft)) {
      node.setMargin(0 /* Left */, options.marginLeft);
    }
    if (isPaddingType(options.padding)) {
      node.setPadding(8 /* All */, options.padding);
    }
    if (isPaddingType(options.paddingX)) {
      node.setPadding(6 /* Horizontal */, options.paddingX);
    }
    if (isPaddingType(options.paddingY)) {
      node.setPadding(7 /* Vertical */, options.paddingY);
    }
    if (isPaddingType(options.paddingTop)) {
      node.setPadding(1 /* Top */, options.paddingTop);
    }
    if (isPaddingType(options.paddingRight)) {
      node.setPadding(2 /* Right */, options.paddingRight);
    }
    if (isPaddingType(options.paddingBottom)) {
      node.setPadding(3 /* Bottom */, options.paddingBottom);
    }
    if (isPaddingType(options.paddingLeft)) {
      node.setPadding(0 /* Left */, options.paddingLeft);
    }
  }
  set position(positionType) {
    if (!isPositionTypeType(positionType) || this._positionType === positionType)
      return;
    this._positionType = positionType;
    this.yogaNode.setPositionType(parsePositionType(positionType));
    this.requestRender();
  }
  get overflow() {
    return this._overflow;
  }
  set overflow(overflow) {
    if (!isOverflowType(overflow) || this._overflow === overflow)
      return;
    this._overflow = overflow;
    this.yogaNode.setOverflow(parseOverflow(overflow));
    bumpRenderListRevision(this._ctx);
    this.requestRender();
  }
  setPosition(position) {
    this._position = { ...this._position, ...position };
    this.updateYogaPosition(position);
  }
  updateYogaPosition(position) {
    const node = this.yogaNode;
    const { top, right, bottom, left } = position;
    if (isPositionType(top)) {
      if (top === "auto") {
        node.setPositionAuto(1 /* Top */);
      } else {
        node.setPosition(1 /* Top */, top);
      }
    }
    if (isPositionType(right)) {
      if (right === "auto") {
        node.setPositionAuto(2 /* Right */);
      } else {
        node.setPosition(2 /* Right */, right);
      }
    }
    if (isPositionType(bottom)) {
      if (bottom === "auto") {
        node.setPositionAuto(3 /* Bottom */);
      } else {
        node.setPosition(3 /* Bottom */, bottom);
      }
    }
    if (isPositionType(left)) {
      if (left === "auto") {
        node.setPositionAuto(0 /* Left */);
      } else {
        node.setPosition(0 /* Left */, left);
      }
    }
    this.requestRender();
  }
  set flexGrow(grow) {
    if (grow == null) {
      this.yogaNode.setFlexGrow(0);
    } else {
      this.yogaNode.setFlexGrow(grow);
    }
    this.requestRender();
  }
  set flexShrink(shrink) {
    const value = shrink == null ? 1 : shrink;
    this._flexShrink = value;
    this.yogaNode.setFlexShrink(value);
    this.requestRender();
  }
  set flexDirection(direction) {
    this.yogaNode.setFlexDirection(parseFlexDirection(direction));
    this.requestRender();
  }
  set flexWrap(wrap) {
    this.yogaNode.setFlexWrap(parseWrap(wrap));
    this.requestRender();
  }
  set alignItems(alignItems) {
    this.yogaNode.setAlignItems(parseAlignItems(alignItems));
    this.requestRender();
  }
  set justifyContent(justifyContent) {
    this.yogaNode.setJustifyContent(parseJustify(justifyContent));
    this.requestRender();
  }
  set alignSelf(alignSelf) {
    this.yogaNode.setAlignSelf(parseAlign(alignSelf));
    this.requestRender();
  }
  set flexBasis(basis) {
    if (isFlexBasisType(basis)) {
      this.yogaNode.setFlexBasis(basis);
      this.requestRender();
    }
  }
  set minWidth(minWidth) {
    if (isSizeType(minWidth)) {
      this.yogaNode.setMinWidth(minWidth);
      this.requestRender();
    }
  }
  set maxWidth(maxWidth) {
    if (isSizeType(maxWidth)) {
      this.yogaNode.setMaxWidth(maxWidth);
      this.requestRender();
    }
  }
  set minHeight(minHeight) {
    if (isSizeType(minHeight)) {
      this.yogaNode.setMinHeight(minHeight);
      this.requestRender();
    }
  }
  set maxHeight(maxHeight) {
    if (isSizeType(maxHeight)) {
      this.yogaNode.setMaxHeight(maxHeight);
      this.requestRender();
    }
  }
  set margin(margin) {
    if (isMarginType(margin)) {
      this.yogaNode.setMargin(8 /* All */, margin);
      this.requestRender();
    }
  }
  set marginX(marginX) {
    if (isMarginType(marginX)) {
      this.yogaNode.setMargin(6 /* Horizontal */, marginX);
      this.requestRender();
    }
  }
  set marginY(marginY) {
    if (isMarginType(marginY)) {
      this.yogaNode.setMargin(7 /* Vertical */, marginY);
      this.requestRender();
    }
  }
  set marginTop(margin) {
    if (isMarginType(margin)) {
      this.yogaNode.setMargin(1 /* Top */, margin);
      this.requestRender();
    }
  }
  get marginTop() {
    const margin = this.yogaNode.getMargin(1 /* Top */);
    if (typeof margin === "number")
      return margin;
    if (typeof margin === "object" && margin && "value" in margin && typeof margin.value === "number")
      return margin.value;
    return 0;
  }
  set marginRight(margin) {
    if (isMarginType(margin)) {
      this.yogaNode.setMargin(2 /* Right */, margin);
      this.requestRender();
    }
  }
  set marginBottom(margin) {
    if (isMarginType(margin)) {
      this.yogaNode.setMargin(3 /* Bottom */, margin);
      this.requestRender();
    }
  }
  set marginLeft(margin) {
    if (isMarginType(margin)) {
      this.yogaNode.setMargin(0 /* Left */, margin);
      this.requestRender();
    }
  }
  set padding(padding) {
    if (isPaddingType(padding)) {
      this.yogaNode.setPadding(8 /* All */, padding);
      this.requestRender();
    }
  }
  set paddingX(paddingX) {
    if (isPaddingType(paddingX)) {
      this.yogaNode.setPadding(6 /* Horizontal */, paddingX);
      this.requestRender();
    }
  }
  set paddingY(paddingY) {
    if (isPaddingType(paddingY)) {
      this.yogaNode.setPadding(7 /* Vertical */, paddingY);
      this.requestRender();
    }
  }
  set paddingTop(padding) {
    if (isPaddingType(padding)) {
      this.yogaNode.setPadding(1 /* Top */, padding);
      this.requestRender();
    }
  }
  set paddingRight(padding) {
    if (isPaddingType(padding)) {
      this.yogaNode.setPadding(2 /* Right */, padding);
      this.requestRender();
    }
  }
  set paddingBottom(padding) {
    if (isPaddingType(padding)) {
      this.yogaNode.setPadding(3 /* Bottom */, padding);
      this.requestRender();
    }
  }
  set paddingLeft(padding) {
    if (isPaddingType(padding)) {
      this.yogaNode.setPadding(0 /* Left */, padding);
      this.requestRender();
    }
  }
  getLayoutNode() {
    return this.yogaNode;
  }
  updateFromLayout() {
    const frameId = this._ctx.frameId;
    if (this._lastLayoutFrame === frameId)
      return;
    this._lastLayoutFrame = frameId;
    const layout = this.yogaNode.getComputedLayout();
    const oldX = this._x;
    const oldY = this._y;
    const oldWidth = this._widthValue;
    const oldHeight = this._heightValue;
    this._x = layout.left;
    this._y = layout.top;
    const parentScreenX = this.parent ? this.parent._screenX : 0;
    const parentScreenY = this.parent ? this.parent._screenY : 0;
    this._screenX = parentScreenX + this._x + this._translateX;
    this._screenY = parentScreenY + this._y + this._translateY;
    const newWidth = Math.max(layout.width, 1);
    const newHeight = Math.max(layout.height, 1);
    const sizeChanged = oldWidth !== newWidth || oldHeight !== newHeight;
    this._widthValue = newWidth;
    this._heightValue = newHeight;
    if (sizeChanged) {
      this.onLayoutResize(newWidth, newHeight);
    }
    const positionChanged = oldX !== this._x || oldY !== this._y;
    if (positionChanged) {
      if (this.parent)
        this.parent.childrenPrimarySortDirty = true;
    }
  }
  onLayoutResize(width, height) {
    if (this._visible) {
      this.handleFrameBufferResize(width, height);
      this.onResize(width, height);
      this.requestRender();
    }
  }
  handleFrameBufferResize(width, height) {
    if (!this.buffered)
      return;
    if (width <= 0 || height <= 0) {
      return;
    }
    if (this.frameBuffer) {
      this.frameBuffer.resize(width, height);
    } else {
      this.createFrameBuffer();
    }
  }
  createFrameBuffer() {
    const w = this.width;
    const h = this.height;
    if (w <= 0 || h <= 0) {
      return;
    }
    try {
      const widthMethod = this._ctx.widthMethod;
      this.frameBuffer = OptimizedBuffer.create(w, h, widthMethod, {
        respectAlpha: true,
        id: `framebuffer-${this.id}`
      });
    } catch (error) {
      console.error(`Failed to create frame buffer for ${this.id}:`, error);
      this.frameBuffer = null;
    }
  }
  onResize(width, height) {
    this.onSizeChange?.();
    this.emit("resize");
  }
  replaceParent(obj) {
    if (obj.parent) {
      obj.parent.remove(obj);
    }
    obj.parent = this;
  }
  add(obj, index) {
    if (!obj) {
      return -1;
    }
    const renderable = maybeMakeRenderable(this._ctx, obj);
    if (!renderable) {
      return -1;
    }
    if (renderable.isDestroyed) {
      if (true) {
        console.warn(`Renderable with id ${renderable.id} was already destroyed, skipping add`);
      }
      return -1;
    }
    const anchorRenderable = index !== undefined ? this._childrenInLayoutOrder[index] : undefined;
    if (anchorRenderable) {
      return this.insertBefore(renderable, anchorRenderable);
    }
    if (renderable.parent === this) {
      this.yogaNode.removeChild(renderable.getLayoutNode());
      this._childrenInLayoutOrder.splice(this._childrenInLayoutOrder.indexOf(renderable), 1);
    } else {
      this.replaceParent(renderable);
      this.needsZIndexSort = true;
      this._childrenInZIndexOrder.push(renderable);
      if (typeof renderable.onLifecyclePass === "function") {
        this._ctx.registerLifecyclePass(renderable);
      }
      if (renderable._liveCount > 0) {
        this.propagateLiveCount(renderable._liveCount);
      }
    }
    const childLayoutNode = renderable.getLayoutNode();
    const insertedIndex = this._childrenInLayoutOrder.length;
    this._childrenInLayoutOrder.push(renderable);
    this.yogaNode.insertChild(childLayoutNode, insertedIndex);
    this.childrenPrimarySortDirty = true;
    this._shouldUpdateBefore.add(renderable);
    bumpRenderListRevision(this._ctx);
    this.requestRender();
    return insertedIndex;
  }
  insertBefore(obj, anchor) {
    if (!anchor) {
      return this.add(obj);
    }
    if (!obj) {
      return -1;
    }
    const renderable = maybeMakeRenderable(this._ctx, obj);
    if (!renderable) {
      return -1;
    }
    if (renderable.isDestroyed) {
      if (true) {
        console.warn(`Renderable with id ${renderable.id} was already destroyed, skipping insertBefore`);
      }
      return -1;
    }
    if (!isRenderable(anchor)) {
      throw new Error("Anchor must be a Renderable");
    }
    if (anchor.isDestroyed) {
      if (true) {
        console.warn(`Anchor with id ${anchor.id} was already destroyed, skipping insertBefore`);
      }
      return -1;
    }
    if (this._childrenInLayoutOrder.indexOf(anchor) === -1) {
      if (true) {
        console.warn(`Anchor with id ${anchor.id} does not exist within the parent ${this.id}, skipping insertBefore`);
      }
      return -1;
    }
    if (renderable === anchor) {
      if (true) {
        console.warn(`Anchor is the same as the node ${renderable.id} being inserted, skipping insertBefore`);
      }
      return -1;
    }
    if (renderable.parent === this) {
      this.yogaNode.removeChild(renderable.getLayoutNode());
      this._childrenInLayoutOrder.splice(this._childrenInLayoutOrder.indexOf(renderable), 1);
    } else {
      this.replaceParent(renderable);
      this.needsZIndexSort = true;
      this._childrenInZIndexOrder.push(renderable);
      if (typeof renderable.onLifecyclePass === "function") {
        this._ctx.registerLifecyclePass(renderable);
      }
      if (renderable._liveCount > 0) {
        this.propagateLiveCount(renderable._liveCount);
      }
    }
    this.childrenPrimarySortDirty = true;
    const anchorIndex = this._childrenInLayoutOrder.indexOf(anchor);
    const insertedIndex = Math.max(0, Math.min(anchorIndex, this._childrenInLayoutOrder.length));
    this._childrenInLayoutOrder.splice(insertedIndex, 0, renderable);
    this.yogaNode.insertChild(renderable.getLayoutNode(), insertedIndex);
    this._shouldUpdateBefore.add(renderable);
    bumpRenderListRevision(this._ctx);
    this.requestRender();
    return insertedIndex;
  }
  getRenderable(id) {
    return this._childrenInLayoutOrder.find((child) => child.id === id);
  }
  remove(child) {
    if (!(child instanceof BaseRenderable)) {
      throw new Error("remove expects a renderable child object");
    }
    const index = this._childrenInLayoutOrder.indexOf(child);
    if (index === -1) {
      if (true) {
        console.warn(`Renderable with id ${child.id} is not a child of ${this.id}, skipping remove`);
      }
      return;
    }
    const renderable = this._childrenInLayoutOrder[index];
    if (renderable._liveCount > 0) {
      this.propagateLiveCount(-renderable._liveCount);
    }
    this.yogaNode.removeChild(renderable.getLayoutNode());
    this._childrenInLayoutOrder.splice(index, 1);
    const zIndexIndex = this._childrenInZIndexOrder.indexOf(renderable);
    if (zIndexIndex !== -1) {
      this._childrenInZIndexOrder.splice(zIndexIndex, 1);
    }
    this._shouldUpdateBefore.delete(renderable);
    this.requestRender();
    renderable.onRemove();
    renderable.parent = null;
    this._ctx.unregisterLifecyclePass(renderable);
    this.childrenPrimarySortDirty = true;
    bumpRenderListRevision(this._ctx);
  }
  onRemove() {}
  getChildren() {
    return [...this._childrenInLayoutOrder];
  }
  getChildrenCount() {
    return this._childrenInLayoutOrder.length;
  }
  updateLayout(deltaTime, renderList = []) {
    if (!this.visible)
      return;
    this.onUpdate(deltaTime);
    if (this._isDestroyed)
      return;
    this.updateFromLayout();
    if (this._shouldUpdateBefore.size > 0) {
      for (const child of this._shouldUpdateBefore) {
        if (!child.isDestroyed) {
          child.updateFromLayout();
        }
      }
      this._shouldUpdateBefore.clear();
    }
    if (this._isDestroyed)
      return;
    const shouldPushOpacity = this._opacity < 1;
    if (shouldPushOpacity) {
      renderList.push({ action: "pushOpacity", opacity: this._opacity });
    }
    renderList.push({ action: "render", renderable: this });
    this.ensureZIndexSorted();
    const shouldPushScissor = this._overflow !== "visible" && this.width > 0 && this.height > 0;
    if (shouldPushScissor) {
      const scissorRect = this.getScissorRect();
      renderList.push({
        action: "pushScissorRect",
        x: scissorRect.x,
        y: scissorRect.y,
        width: scissorRect.width,
        height: scissorRect.height,
        screenX: this._screenX,
        screenY: this._screenY
      });
    }
    if (!this._hasVisibleChildFilter()) {
      for (const child of this._childrenInZIndexOrder) {
        child.updateLayout(deltaTime, renderList);
      }
    } else {
      for (const child of this._childrenInZIndexOrder) {
        if (child.isDestroyed)
          continue;
        child.updateFromLayout();
      }
      const visibleChildren = this._getVisibleChildren();
      const visibleChildSet = new Set(visibleChildren);
      for (const child of this._childrenInZIndexOrder) {
        if (!visibleChildSet.has(child.num))
          continue;
        child.updateLayout(deltaTime, renderList);
      }
    }
    if (shouldPushScissor) {
      renderList.push({ action: "popScissorRect" });
    }
    if (shouldPushOpacity) {
      renderList.push({ action: "popOpacity" });
    }
  }
  render(buffer, deltaTime) {
    let renderBuffer = buffer;
    if (this.buffered && this.frameBuffer) {
      renderBuffer = this.frameBuffer;
    }
    if (this.renderBefore) {
      this.renderBefore.call(this, renderBuffer, deltaTime);
    }
    this.renderSelf(renderBuffer, deltaTime);
    if (this.renderAfter) {
      this.renderAfter.call(this, renderBuffer, deltaTime);
    }
    const screenX = this._screenX;
    const screenY = this._screenY;
    this.markClean();
    this._ctx.addToHitGrid(screenX, screenY, this.width, this.height, this.num);
    if (this.buffered && this.frameBuffer) {
      buffer.drawFrameBuffer(screenX, screenY, this.frameBuffer);
    }
  }
  _hasVisibleChildFilter() {
    return this._getVisibleChildren !== Renderable.prototype._getVisibleChildren;
  }
  _getVisibleChildren() {
    return this._childrenInZIndexOrder.map((child) => child.num);
  }
  canReuseRenderCommandList() {
    return this.onUpdate === Renderable.prototype.onUpdate && (this._overflow === "visible" || this.getScissorRect === Renderable.prototype.getScissorRect) && !this._hasVisibleChildFilter();
  }
  onUpdate(deltaTime) {}
  getScissorRect() {
    return {
      x: this.buffered ? 0 : this._screenX,
      y: this.buffered ? 0 : this._screenY,
      width: this.width,
      height: this.height
    };
  }
  renderSelf(buffer, deltaTime) {}
  get isDestroyed() {
    return this._isDestroyed;
  }
  destroy() {
    if (this._isDestroyed) {
      return;
    }
    this._isDestroyed = true;
    this.emit("destroyed" /* DESTROYED */);
    if (this.parent) {
      this.parent.remove(this);
    }
    if (this.frameBuffer) {
      this.frameBuffer.destroy();
      this.frameBuffer = null;
    }
    for (const child of [...this._childrenInLayoutOrder]) {
      this.remove(child);
    }
    this._childrenInLayoutOrder = [];
    this._childrenInZIndexOrder = [];
    this._shouldUpdateBefore.clear();
    Renderable.renderablesByNumber.delete(this.num);
    this.blur();
    this.removeAllListeners();
    this.destroySelf();
    try {
      this.yogaNode.free();
    } catch (e) {}
  }
  destroyRecursively() {
    const children = [...this._childrenInLayoutOrder];
    for (const child of children) {
      child.destroyRecursively();
    }
    this.destroy();
  }
  destroySelf() {}
  processMouseEvent(event) {
    this._mouseListener?.call(this, event);
    this._mouseListeners[event.type]?.call(this, event);
    this.onMouseEvent(event);
    if (this.parent && !event.propagationStopped) {
      this.parent.processMouseEvent(event);
    }
  }
  onMouseEvent(event) {}
  set onMouse(handler) {
    if (handler)
      this._mouseListener = handler;
    else
      this._mouseListener = null;
  }
  set onMouseDown(handler) {
    if (handler)
      this._mouseListeners["down"] = handler;
    else
      delete this._mouseListeners["down"];
  }
  set onMouseUp(handler) {
    if (handler)
      this._mouseListeners["up"] = handler;
    else
      delete this._mouseListeners["up"];
  }
  set onMouseMove(handler) {
    if (handler)
      this._mouseListeners["move"] = handler;
    else
      delete this._mouseListeners["move"];
  }
  set onMouseDrag(handler) {
    if (handler)
      this._mouseListeners["drag"] = handler;
    else
      delete this._mouseListeners["drag"];
  }
  set onMouseDragEnd(handler) {
    if (handler)
      this._mouseListeners["drag-end"] = handler;
    else
      delete this._mouseListeners["drag-end"];
  }
  set onMouseDrop(handler) {
    if (handler)
      this._mouseListeners["drop"] = handler;
    else
      delete this._mouseListeners["drop"];
  }
  set onMouseOver(handler) {
    if (handler)
      this._mouseListeners["over"] = handler;
    else
      delete this._mouseListeners["over"];
  }
  set onMouseOut(handler) {
    if (handler)
      this._mouseListeners["out"] = handler;
    else
      delete this._mouseListeners["out"];
  }
  set onMouseScroll(handler) {
    if (handler)
      this._mouseListeners["scroll"] = handler;
    else
      delete this._mouseListeners["scroll"];
  }
  set onPaste(handler) {
    this._pasteListener = handler;
  }
  get onPaste() {
    return this._pasteListener;
  }
  set onKeyDown(handler) {
    if (handler)
      this._keyListeners["down"] = handler;
    else
      delete this._keyListeners["down"];
  }
  get onKeyDown() {
    return this._keyListeners["down"];
  }
  set onSizeChange(handler) {
    this._sizeChangeListener = handler;
  }
  get onSizeChange() {
    return this._sizeChangeListener;
  }
  applyEventOptions(options) {
    this.onMouse = options.onMouse;
    this.onMouseDown = options.onMouseDown;
    this.onMouseUp = options.onMouseUp;
    this.onMouseMove = options.onMouseMove;
    this.onMouseDrag = options.onMouseDrag;
    this.onMouseDragEnd = options.onMouseDragEnd;
    this.onMouseDrop = options.onMouseDrop;
    this.onMouseOver = options.onMouseOver;
    this.onMouseOut = options.onMouseOut;
    this.onMouseScroll = options.onMouseScroll;
    this.onPaste = options.onPaste;
    this.onKeyDown = options.onKeyDown;
    this.onSizeChange = options.onSizeChange;
  }
}

class RootRenderable extends Renderable {
  renderList = [];
  appliedLayoutGeneration = -1;
  appliedRenderListRevision = -1;
  renderListReusable = false;
  constructor(ctx) {
    super(ctx, {
      id: "__root__",
      zIndex: 0,
      visible: true,
      width: ctx.width,
      height: ctx.height,
      enableLayout: true
    });
    if (this.yogaNode) {
      this.yogaNode.free();
    }
    this.yogaNode = yoga_default.Node.createForOpenTUI();
    this.yogaNode.setWidth(ctx.width);
    this.yogaNode.setHeight(ctx.height);
    this.yogaNode.setFlexDirection(0 /* Column */);
    this.calculateLayout();
  }
  render(buffer, deltaTime) {
    if (!this.visible)
      return;
    for (const renderable of this._ctx.getLifecyclePasses()) {
      if (!renderable.isDestroyed) {
        renderable.onLifecyclePass?.call(renderable);
      }
    }
    if (this.yogaNode.isDirty()) {
      this.calculateLayout();
    } else {
      this.syncExternalLayoutGeneration();
    }
    const layoutGeneration = getLayoutGeneration(this._ctx);
    const renderListRevision = getRenderListRevision(this._ctx);
    const canReuseRenderList = this.renderListReusable && this.appliedLayoutGeneration === layoutGeneration && this.appliedRenderListRevision === renderListRevision;
    if (!canReuseRenderList) {
      this.renderList.length = 0;
      super.updateLayout(deltaTime, this.renderList);
      this.appliedLayoutGeneration = layoutGeneration;
      this.appliedRenderListRevision = getRenderListRevision(this._ctx);
      this.renderListReusable = this.canReuseCurrentRenderList();
    }
    this._ctx.clearHitGridScissorRects();
    for (let i = 1;i < this.renderList.length; i++) {
      const command = this.renderList[i];
      switch (command.action) {
        case "render":
          if (!command.renderable.isDestroyed) {
            command.renderable.render(buffer, deltaTime);
          }
          break;
        case "pushScissorRect":
          buffer.pushScissorRect(command.x, command.y, command.width, command.height);
          this._ctx.pushHitGridScissorRect(command.screenX, command.screenY, command.width, command.height);
          break;
        case "popScissorRect":
          buffer.popScissorRect();
          this._ctx.popHitGridScissorRect();
          break;
        case "pushOpacity":
          buffer.pushOpacity(command.opacity);
          break;
        case "popOpacity":
          buffer.popOpacity();
          break;
      }
    }
  }
  propagateLiveCount(delta) {
    const oldCount = this._liveCount;
    this._liveCount += delta;
    if (oldCount === 0 && this._liveCount > 0) {
      this._ctx.requestLive();
    } else if (oldCount > 0 && this._liveCount === 0) {
      this._ctx.dropLive();
    }
  }
  calculateLayout() {
    this.yogaNode.calculateLayout(this.width, this.height, 1 /* LTR */);
    bumpLayoutGeneration(this._ctx);
    this.yogaNode.markLayoutSeen();
    this.emit("layout-changed" /* LAYOUT_CHANGED */);
  }
  syncExternalLayoutGeneration() {
    if (!this.yogaNode.hasNewLayout())
      return;
    bumpLayoutGeneration(this._ctx);
    this.yogaNode.markLayoutSeen();
  }
  canReuseCurrentRenderList() {
    if (this._liveCount > 0)
      return false;
    for (const command of this.renderList) {
      if (command.action !== "render")
        continue;
      if (!command.renderable.canReuseRenderCommandList())
        return false;
    }
    return true;
  }
  resize(width, height) {
    this.width = width;
    this.height = height;
    this.emit("resized" /* RESIZED */, { width, height });
  }
}

// src/renderables/composition/vnode.ts
import util from "node:util";
var BrandedVNode = Symbol.for("@opentui/core/VNode");
function isRenderableConstructor(value) {
  return typeof value === "function" && value.prototype && Renderable.prototype.isPrototypeOf(value.prototype);
}
function flattenChildren(children) {
  const result = [];
  for (const child of children) {
    if (Array.isArray(child)) {
      result.push(...flattenChildren(child));
    } else if (child !== null && child !== undefined && child !== false) {
      result.push(child);
    }
  }
  return result;
}
function h(type, props, ...children) {
  if (typeof type !== "function") {
    throw new TypeError("h() received an invalid vnode type");
  }
  const vnode = {
    [BrandedVNode]: true,
    type,
    props,
    children: flattenChildren(children),
    __pendingCalls: []
  };
  if (isRenderableConstructor(type)) {
    return new Proxy(vnode, {
      get(target, prop, receiver) {
        if (prop in target) {
          return Reflect.get(target, prop, receiver);
        }
        if (typeof prop === "string") {
          const prototype = type.prototype;
          const hasMethod = prototype && (typeof prototype[prop] === "function" || Object.getOwnPropertyDescriptor(prototype, prop) || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(prototype), prop));
          if (hasMethod) {
            return (...args) => {
              target.__pendingCalls = target.__pendingCalls || [];
              target.__pendingCalls.push({ method: prop, args });
              return target;
            };
          }
        }
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver) {
        if (typeof prop === "string" && isRenderableConstructor(type)) {
          const prototype = type.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(prototype, prop) || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(prototype), prop);
          if (descriptor && descriptor.set) {
            target.__pendingCalls = target.__pendingCalls || [];
            target.__pendingCalls.push({ method: prop, args: [value], isProperty: true });
            return true;
          }
        }
        return Reflect.set(target, prop, value, receiver);
      }
    });
  }
  return vnode;
}
function isVNode(node) {
  return node && node[BrandedVNode];
}
function maybeMakeRenderable(ctx, node) {
  if (isRenderable(node))
    return node;
  if (isVNode(node))
    return instantiate(ctx, node);
  if (true) {
    console.warn("maybeMakeRenderable received an invalid node", util.inspect(node, { depth: 2 }));
  }
  return null;
}
function wrapWithDelegates(instance, delegateMap) {
  if (!delegateMap || Object.keys(delegateMap).length === 0)
    return instance;
  const getDescendant = (id) => {
    return instance.findDescendantById(id);
  };
  const proxy = new Proxy(instance, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && delegateMap[prop]) {
        const host = getDescendant(delegateMap[prop]);
        if (host) {
          const value = host[prop];
          if (typeof value === "function") {
            return value.bind(host);
          }
          return value;
        }
      }
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      if (typeof prop === "string" && delegateMap[prop]) {
        const host = getDescendant(delegateMap[prop]);
        if (host) {
          return Reflect.set(host, prop, value);
        }
      }
      return Reflect.set(target, prop, value, receiver);
    }
  });
  return proxy;
}
function instantiate(ctx, node) {
  if (isRenderable(node))
    return node;
  if (!node || typeof node !== "object") {
    throw new TypeError("mount() received an invalid vnode");
  }
  const vnode = node;
  const { type, props } = vnode;
  const children = flattenChildren(vnode.children || []);
  const delegateMap = vnode.__delegateMap;
  if (isRenderableConstructor(type)) {
    const instance = new type(ctx, props || {});
    for (const child of children) {
      if (isRenderable(child)) {
        instance.add(child);
      } else {
        const mounted = instantiate(ctx, child);
        instance.add(mounted);
      }
    }
    const delegatedInstance = wrapWithDelegates(instance, delegateMap);
    const pendingCalls = vnode.__pendingCalls;
    if (pendingCalls) {
      for (const call of pendingCalls) {
        if (call.isProperty) {
          delegatedInstance[call.method] = call.args[0];
        } else {
          delegatedInstance[call.method].apply(delegatedInstance, call.args);
        }
      }
    }
    return delegatedInstance;
  }
  const resolved = type(props || {}, children);
  const inst = instantiate(ctx, resolved);
  return wrapWithDelegates(inst, delegateMap);
}
function delegate(mapping, vnode) {
  if (isRenderable(vnode)) {
    return wrapWithDelegates(vnode, mapping);
  }
  if (!vnode || typeof vnode !== "object")
    return vnode;
  vnode.__delegateMap = { ...vnode.__delegateMap || {}, ...mapping };
  return vnode;
}

// src/text-buffer-view.ts
class TextBufferView {
  lib;
  viewPtr;
  textBuffer;
  _destroyed = false;
  constructor(lib, ptr, textBuffer) {
    this.lib = lib;
    this.viewPtr = ptr;
    this.textBuffer = textBuffer;
  }
  static create(textBuffer) {
    const lib = resolveRenderLib();
    const viewPtr = lib.createTextBufferView(textBuffer.ptr);
    return new TextBufferView(lib, viewPtr, textBuffer);
  }
  guard() {
    if (this._destroyed)
      throw new Error("TextBufferView is destroyed");
  }
  get ptr() {
    this.guard();
    return this.viewPtr;
  }
  setSelection(start, end, bgColor, fgColor) {
    this.guard();
    this.lib.textBufferViewSetSelection(this.viewPtr, start, end, bgColor || null, fgColor || null);
  }
  updateSelection(end, bgColor, fgColor) {
    this.guard();
    this.lib.textBufferViewUpdateSelection(this.viewPtr, end, bgColor || null, fgColor || null);
  }
  resetSelection() {
    this.guard();
    this.lib.textBufferViewResetSelection(this.viewPtr);
  }
  getSelection() {
    this.guard();
    return this.lib.textBufferViewGetSelection(this.viewPtr);
  }
  hasSelection() {
    this.guard();
    return this.getSelection() !== null;
  }
  setLocalSelection(anchorX, anchorY, focusX, focusY, bgColor, fgColor) {
    this.guard();
    return this.lib.textBufferViewSetLocalSelection(this.viewPtr, anchorX, anchorY, focusX, focusY, bgColor || null, fgColor || null);
  }
  updateLocalSelection(anchorX, anchorY, focusX, focusY, bgColor, fgColor) {
    this.guard();
    return this.lib.textBufferViewUpdateLocalSelection(this.viewPtr, anchorX, anchorY, focusX, focusY, bgColor || null, fgColor || null);
  }
  resetLocalSelection() {
    this.guard();
    this.lib.textBufferViewResetLocalSelection(this.viewPtr);
  }
  setWrapWidth(width) {
    this.guard();
    this.lib.textBufferViewSetWrapWidth(this.viewPtr, width ?? 0);
  }
  setWrapMode(mode) {
    this.guard();
    this.lib.textBufferViewSetWrapMode(this.viewPtr, mode);
  }
  setFirstLineOffset(offset) {
    this.guard();
    this.lib.textBufferViewSetFirstLineOffset(this.viewPtr, offset);
  }
  setViewportSize(width, height) {
    this.guard();
    this.lib.textBufferViewSetViewportSize(this.viewPtr, width, height);
  }
  setViewport(x, y, width, height) {
    this.guard();
    this.lib.textBufferViewSetViewport(this.viewPtr, x, y, width, height);
  }
  get lineInfo() {
    this.guard();
    return this.lib.textBufferViewGetLineInfo(this.viewPtr);
  }
  get logicalLineInfo() {
    this.guard();
    return this.lib.textBufferViewGetLogicalLineInfo(this.viewPtr);
  }
  getSelectedText() {
    this.guard();
    const byteSize = this.textBuffer.byteSize;
    if (byteSize === 0)
      return "";
    const selectedBytes = this.lib.textBufferViewGetSelectedTextBytes(this.viewPtr, byteSize);
    if (!selectedBytes)
      return "";
    return this.lib.decoder.decode(selectedBytes);
  }
  getPlainText() {
    this.guard();
    const byteSize = this.textBuffer.byteSize;
    if (byteSize === 0)
      return "";
    const plainBytes = this.lib.textBufferViewGetPlainTextBytes(this.viewPtr, byteSize);
    if (!plainBytes)
      return "";
    return this.lib.decoder.decode(plainBytes);
  }
  setTabIndicator(indicator) {
    this.guard();
    const codePoint = typeof indicator === "string" ? indicator.codePointAt(0) ?? 0 : indicator;
    this.lib.textBufferViewSetTabIndicator(this.viewPtr, codePoint);
  }
  setTabIndicatorColor(color) {
    this.guard();
    this.lib.textBufferViewSetTabIndicatorColor(this.viewPtr, color);
  }
  setTruncate(truncate) {
    this.guard();
    this.lib.textBufferViewSetTruncate(this.viewPtr, truncate);
  }
  measureForDimensions(width, height) {
    this.guard();
    return this.lib.textBufferViewMeasureForDimensions(this.viewPtr, width, height);
  }
  getVirtualLineCount() {
    this.guard();
    return this.lib.textBufferViewGetVirtualLineCount(this.viewPtr);
  }
  destroy() {
    if (this._destroyed)
      return;
    this._destroyed = true;
    this.lib.destroyTextBufferView(this.viewPtr);
  }
}

// src/edit-buffer.ts
import { EventEmitter as EventEmitter2 } from "events";

class EditBuffer extends EventEmitter2 {
  static registry = new Map;
  static nativeEventsSubscribed = false;
  lib;
  bufferPtr;
  textBufferPtr;
  id;
  _destroyed = false;
  _textBytes = [];
  _singleTextBytes = null;
  _singleTextMemId = null;
  _syntaxStyle;
  constructor(lib, ptr) {
    super();
    this.lib = lib;
    this.bufferPtr = ptr;
    this.textBufferPtr = lib.editBufferGetTextBuffer(ptr);
    this.id = lib.editBufferGetId(ptr);
    EditBuffer.registry.set(this.id, this);
    EditBuffer.subscribeToNativeEvents(lib);
  }
  static create(widthMethod) {
    const lib = resolveRenderLib();
    const ptr = lib.createEditBuffer(widthMethod);
    return new EditBuffer(lib, ptr);
  }
  static subscribeToNativeEvents(lib) {
    if (EditBuffer.nativeEventsSubscribed)
      return;
    EditBuffer.nativeEventsSubscribed = true;
    lib.onAnyNativeEvent((name, data) => {
      const buffer = new Uint16Array(data);
      if (name.startsWith("eb_") && buffer.length >= 1) {
        const id = buffer[0];
        const instance = EditBuffer.registry.get(id);
        if (instance) {
          const eventName = name.slice(3);
          const eventData = data.slice(2);
          instance.emit(eventName, eventData);
        }
      }
    });
  }
  guard() {
    if (this._destroyed)
      throw new Error("EditBuffer is destroyed");
  }
  get ptr() {
    this.guard();
    return this.bufferPtr;
  }
  setText(text) {
    this.guard();
    const textBytes = this.lib.encoder.encode(text);
    if (this._singleTextMemId !== null) {
      this.lib.textBufferReplaceMemBuffer(this.textBufferPtr, this._singleTextMemId, textBytes, false);
    } else {
      this._singleTextMemId = this.lib.textBufferRegisterMemBuffer(this.textBufferPtr, textBytes, false);
    }
    this._singleTextBytes = textBytes;
    this.lib.editBufferSetTextFromMem(this.bufferPtr, this._singleTextMemId);
  }
  setTextOwned(text) {
    this.guard();
    const textBytes = this.lib.encoder.encode(text);
    this.lib.editBufferSetText(this.bufferPtr, textBytes);
  }
  replaceText(text) {
    this.guard();
    const textBytes = this.lib.encoder.encode(text);
    this._textBytes.push(textBytes);
    const memId = this.lib.textBufferRegisterMemBuffer(this.textBufferPtr, textBytes, false);
    this.lib.editBufferReplaceTextFromMem(this.bufferPtr, memId);
  }
  replaceTextOwned(text) {
    this.guard();
    const textBytes = this.lib.encoder.encode(text);
    this.lib.editBufferReplaceText(this.bufferPtr, textBytes);
  }
  getLineCount() {
    this.guard();
    return this.lib.textBufferGetLineCount(this.textBufferPtr);
  }
  getText() {
    this.guard();
    const maxSize = 1024 * 1024;
    const textBytes = this.lib.editBufferGetText(this.bufferPtr, maxSize);
    if (!textBytes)
      return "";
    return this.lib.decoder.decode(textBytes);
  }
  insertChar(char) {
    this.guard();
    this.lib.editBufferInsertChar(this.bufferPtr, char);
  }
  insertText(text) {
    this.guard();
    this.lib.editBufferInsertText(this.bufferPtr, text);
  }
  deleteChar() {
    this.guard();
    this.lib.editBufferDeleteChar(this.bufferPtr);
  }
  deleteCharBackward() {
    this.guard();
    this.lib.editBufferDeleteCharBackward(this.bufferPtr);
  }
  deleteRange(startLine, startCol, endLine, endCol) {
    this.guard();
    this.lib.editBufferDeleteRange(this.bufferPtr, startLine, startCol, endLine, endCol);
  }
  newLine() {
    this.guard();
    this.lib.editBufferNewLine(this.bufferPtr);
  }
  deleteLine() {
    this.guard();
    this.lib.editBufferDeleteLine(this.bufferPtr);
  }
  moveCursorLeft() {
    this.guard();
    this.lib.editBufferMoveCursorLeft(this.bufferPtr);
  }
  moveCursorRight() {
    this.guard();
    this.lib.editBufferMoveCursorRight(this.bufferPtr);
  }
  moveCursorUp() {
    this.guard();
    this.lib.editBufferMoveCursorUp(this.bufferPtr);
  }
  moveCursorDown() {
    this.guard();
    this.lib.editBufferMoveCursorDown(this.bufferPtr);
  }
  gotoLine(line) {
    this.guard();
    this.lib.editBufferGotoLine(this.bufferPtr, line);
  }
  setCursor(line, col) {
    this.guard();
    this.lib.editBufferSetCursor(this.bufferPtr, line, col);
  }
  setCursorToLineCol(line, col) {
    this.guard();
    this.lib.editBufferSetCursorToLineCol(this.bufferPtr, line, col);
  }
  setCursorByOffset(offset) {
    this.guard();
    this.lib.editBufferSetCursorByOffset(this.bufferPtr, offset);
  }
  getCursorPosition() {
    this.guard();
    return this.lib.editBufferGetCursorPosition(this.bufferPtr);
  }
  getNextWordBoundary() {
    this.guard();
    const boundary = this.lib.editBufferGetNextWordBoundary(this.bufferPtr);
    return {
      row: boundary.row,
      col: boundary.col,
      offset: boundary.offset
    };
  }
  getPrevWordBoundary() {
    this.guard();
    const boundary = this.lib.editBufferGetPrevWordBoundary(this.bufferPtr);
    return {
      row: boundary.row,
      col: boundary.col,
      offset: boundary.offset
    };
  }
  getEOL() {
    this.guard();
    const boundary = this.lib.editBufferGetEOL(this.bufferPtr);
    return {
      row: boundary.row,
      col: boundary.col,
      offset: boundary.offset
    };
  }
  offsetToPosition(offset) {
    this.guard();
    const result = this.lib.editBufferOffsetToPosition(this.bufferPtr, offset);
    if (!result)
      return null;
    return { row: result.row, col: result.col };
  }
  positionToOffset(row, col) {
    this.guard();
    return this.lib.editBufferPositionToOffset(this.bufferPtr, row, col);
  }
  getLineStartOffset(row) {
    this.guard();
    return this.lib.editBufferGetLineStartOffset(this.bufferPtr, row);
  }
  getTextRange(startOffset, endOffset) {
    this.guard();
    if (startOffset >= endOffset)
      return "";
    const maxSize = 1024 * 1024;
    const textBytes = this.lib.editBufferGetTextRange(this.bufferPtr, startOffset, endOffset, maxSize);
    if (!textBytes)
      return "";
    return this.lib.decoder.decode(textBytes);
  }
  getTextRangeByCoords(startRow, startCol, endRow, endCol) {
    this.guard();
    const maxSize = 1024 * 1024;
    const textBytes = this.lib.editBufferGetTextRangeByCoords(this.bufferPtr, startRow, startCol, endRow, endCol, maxSize);
    if (!textBytes)
      return "";
    return this.lib.decoder.decode(textBytes);
  }
  debugLogRope() {
    this.guard();
    this.lib.editBufferDebugLogRope(this.bufferPtr);
  }
  undo() {
    this.guard();
    const maxSize = 256;
    const metaBytes = this.lib.editBufferUndo(this.bufferPtr, maxSize);
    if (!metaBytes)
      return null;
    return this.lib.decoder.decode(metaBytes);
  }
  redo() {
    this.guard();
    const maxSize = 256;
    const metaBytes = this.lib.editBufferRedo(this.bufferPtr, maxSize);
    if (!metaBytes)
      return null;
    return this.lib.decoder.decode(metaBytes);
  }
  canUndo() {
    this.guard();
    return this.lib.editBufferCanUndo(this.bufferPtr);
  }
  canRedo() {
    this.guard();
    return this.lib.editBufferCanRedo(this.bufferPtr);
  }
  clearHistory() {
    this.guard();
    this.lib.editBufferClearHistory(this.bufferPtr);
  }
  setDefaultFg(fg) {
    this.guard();
    this.lib.textBufferSetDefaultFg(this.textBufferPtr, fg);
  }
  setDefaultBg(bg) {
    this.guard();
    this.lib.textBufferSetDefaultBg(this.textBufferPtr, bg);
  }
  setDefaultAttributes(attributes) {
    this.guard();
    this.lib.textBufferSetDefaultAttributes(this.textBufferPtr, attributes);
  }
  resetDefaults() {
    this.guard();
    this.lib.textBufferResetDefaults(this.textBufferPtr);
  }
  setSyntaxStyle(style) {
    this.guard();
    if (this.lib.textBufferSetSyntaxStyle(this.textBufferPtr, style?.ptr ?? null)) {
      this._syntaxStyle = style ?? undefined;
    }
  }
  getSyntaxStyle() {
    this.guard();
    return this._syntaxStyle ?? null;
  }
  addHighlight(lineIdx, highlight) {
    this.guard();
    this.lib.textBufferAddHighlight(this.textBufferPtr, lineIdx, highlight);
  }
  addHighlightByCharRange(highlight) {
    this.guard();
    this.lib.textBufferAddHighlightByCharRange(this.textBufferPtr, highlight);
  }
  removeHighlightsByRef(hlRef) {
    this.guard();
    this.lib.textBufferRemoveHighlightsByRef(this.textBufferPtr, hlRef);
  }
  clearLineHighlights(lineIdx) {
    this.guard();
    this.lib.textBufferClearLineHighlights(this.textBufferPtr, lineIdx);
  }
  clearAllHighlights() {
    this.guard();
    this.lib.textBufferClearAllHighlights(this.textBufferPtr);
  }
  getLineHighlights(lineIdx) {
    this.guard();
    return this.lib.textBufferGetLineHighlights(this.textBufferPtr, lineIdx);
  }
  clear() {
    this.guard();
    this.lib.editBufferClear(this.bufferPtr);
  }
  destroy() {
    if (this._destroyed)
      return;
    this._destroyed = true;
    EditBuffer.registry.delete(this.id);
    this.lib.destroyEditBuffer(this.bufferPtr);
  }
}

// src/editor-view.ts
class EditorView {
  lib;
  viewPtr;
  editBuffer;
  _destroyed = false;
  _extmarksController;
  _textBufferViewPtr;
  constructor(lib, ptr, editBuffer) {
    this.lib = lib;
    this.viewPtr = ptr;
    this.editBuffer = editBuffer;
  }
  static create(editBuffer, viewportWidth, viewportHeight) {
    const lib = resolveRenderLib();
    const viewPtr = lib.createEditorView(editBuffer.ptr, viewportWidth, viewportHeight);
    return new EditorView(lib, viewPtr, editBuffer);
  }
  guard() {
    if (this._destroyed)
      throw new Error("EditorView is destroyed");
  }
  get ptr() {
    this.guard();
    return this.viewPtr;
  }
  setViewportSize(width, height) {
    this.guard();
    this.lib.editorViewSetViewportSize(this.viewPtr, width, height);
  }
  setViewport(x, y, width, height, moveCursor = true) {
    this.guard();
    this.lib.editorViewSetViewport(this.viewPtr, x, y, width, height, moveCursor);
  }
  getViewport() {
    this.guard();
    return this.lib.editorViewGetViewport(this.viewPtr);
  }
  setScrollMargin(margin) {
    this.guard();
    this.lib.editorViewSetScrollMargin(this.viewPtr, margin);
  }
  setWrapMode(mode) {
    this.guard();
    this.lib.editorViewSetWrapMode(this.viewPtr, mode);
  }
  getVirtualLineCount() {
    this.guard();
    return this.lib.editorViewGetVirtualLineCount(this.viewPtr);
  }
  getTotalVirtualLineCount() {
    this.guard();
    return this.lib.editorViewGetTotalVirtualLineCount(this.viewPtr);
  }
  setSelection(start, end, bgColor, fgColor) {
    this.guard();
    this.lib.editorViewSetSelection(this.viewPtr, start, end, bgColor || null, fgColor || null);
  }
  updateSelection(end, bgColor, fgColor) {
    this.guard();
    this.lib.editorViewUpdateSelection(this.viewPtr, end, bgColor || null, fgColor || null);
  }
  resetSelection() {
    this.guard();
    this.lib.editorViewResetSelection(this.viewPtr);
  }
  getSelection() {
    this.guard();
    return this.lib.editorViewGetSelection(this.viewPtr);
  }
  hasSelection() {
    this.guard();
    return this.getSelection() !== null;
  }
  setLocalSelection(anchorX, anchorY, focusX, focusY, bgColor, fgColor, updateCursor, followCursor) {
    this.guard();
    return this.lib.editorViewSetLocalSelection(this.viewPtr, anchorX, anchorY, focusX, focusY, bgColor || null, fgColor || null, updateCursor ?? false, followCursor ?? false);
  }
  updateLocalSelection(anchorX, anchorY, focusX, focusY, bgColor, fgColor, updateCursor, followCursor) {
    this.guard();
    return this.lib.editorViewUpdateLocalSelection(this.viewPtr, anchorX, anchorY, focusX, focusY, bgColor || null, fgColor || null, updateCursor ?? false, followCursor ?? false);
  }
  resetLocalSelection() {
    this.guard();
    this.lib.editorViewResetLocalSelection(this.viewPtr);
  }
  getSelectedText() {
    this.guard();
    const maxLength = 1024 * 1024;
    const selectedBytes = this.lib.editorViewGetSelectedTextBytes(this.viewPtr, maxLength);
    if (!selectedBytes)
      return "";
    return this.lib.decoder.decode(selectedBytes);
  }
  getCursor() {
    this.guard();
    return this.lib.editorViewGetCursor(this.viewPtr);
  }
  getText() {
    this.guard();
    const maxLength = 1024 * 1024;
    const textBytes = this.lib.editorViewGetText(this.viewPtr, maxLength);
    if (!textBytes)
      return "";
    return this.lib.decoder.decode(textBytes);
  }
  getVisualCursor() {
    this.guard();
    return this.lib.editorViewGetVisualCursor(this.viewPtr);
  }
  moveUpVisual() {
    this.guard();
    this.lib.editorViewMoveUpVisual(this.viewPtr);
  }
  moveDownVisual() {
    this.guard();
    this.lib.editorViewMoveDownVisual(this.viewPtr);
  }
  deleteSelectedText() {
    this.guard();
    this.lib.editorViewDeleteSelectedText(this.viewPtr);
  }
  setCursorByOffset(offset) {
    this.guard();
    this.lib.editorViewSetCursorByOffset(this.viewPtr, offset);
  }
  getNextWordBoundary() {
    this.guard();
    return this.lib.editorViewGetNextWordBoundary(this.viewPtr);
  }
  getPrevWordBoundary() {
    this.guard();
    return this.lib.editorViewGetPrevWordBoundary(this.viewPtr);
  }
  getEOL() {
    this.guard();
    return this.lib.editorViewGetEOL(this.viewPtr);
  }
  getVisualSOL() {
    this.guard();
    return this.lib.editorViewGetVisualSOL(this.viewPtr);
  }
  getVisualEOL() {
    this.guard();
    return this.lib.editorViewGetVisualEOL(this.viewPtr);
  }
  getLineInfo() {
    this.guard();
    return this.lib.editorViewGetLineInfo(this.viewPtr);
  }
  getLogicalLineInfo() {
    this.guard();
    return this.lib.editorViewGetLogicalLineInfo(this.viewPtr);
  }
  get extmarks() {
    if (!this._extmarksController) {
      this._extmarksController = createExtmarksController(this.editBuffer, this);
    }
    return this._extmarksController;
  }
  setPlaceholderStyledText(chunks) {
    this.guard();
    this.lib.editorViewSetPlaceholderStyledText(this.viewPtr, chunks);
  }
  setTabIndicator(indicator) {
    this.guard();
    const codePoint = typeof indicator === "string" ? indicator.codePointAt(0) ?? 0 : indicator;
    this.lib.editorViewSetTabIndicator(this.viewPtr, codePoint);
  }
  setTabIndicatorColor(color) {
    this.guard();
    this.lib.editorViewSetTabIndicatorColor(this.viewPtr, color);
  }
  measureForDimensions(width, height) {
    this.guard();
    if (!this._textBufferViewPtr) {
      this._textBufferViewPtr = this.lib.editorViewGetTextBufferView(this.viewPtr);
    }
    return this.lib.textBufferViewMeasureForDimensions(this._textBufferViewPtr, width, height);
  }
  destroy() {
    if (this._destroyed)
      return;
    if (this._extmarksController) {
      this._extmarksController.destroy();
      this._extmarksController = undefined;
    }
    this._destroyed = true;
    this.lib.destroyEditorView(this.viewPtr);
  }
}

// src/syntax-style.ts
function convertThemeToStyles(theme) {
  const flatStyles = {};
  for (const tokenStyle of theme) {
    const styleDefinition = {};
    if (tokenStyle.style.foreground) {
      styleDefinition.fg = parseColor(tokenStyle.style.foreground);
    }
    if (tokenStyle.style.background) {
      styleDefinition.bg = parseColor(tokenStyle.style.background);
    }
    if (tokenStyle.style.bold !== undefined) {
      styleDefinition.bold = tokenStyle.style.bold;
    }
    if (tokenStyle.style.italic !== undefined) {
      styleDefinition.italic = tokenStyle.style.italic;
    }
    if (tokenStyle.style.underline !== undefined) {
      styleDefinition.underline = tokenStyle.style.underline;
    }
    if (tokenStyle.style.dim !== undefined) {
      styleDefinition.dim = tokenStyle.style.dim;
    }
    for (const scope of tokenStyle.scope) {
      flatStyles[scope] = styleDefinition;
    }
  }
  return flatStyles;
}

class SyntaxStyle {
  lib;
  stylePtr;
  _destroyed = false;
  nameCache = new Map;
  styleDefs = new Map;
  mergedCache = new Map;
  constructor(lib, ptr) {
    this.lib = lib;
    this.stylePtr = ptr;
  }
  static create() {
    const lib = resolveRenderLib();
    const ptr = lib.createSyntaxStyle();
    return new SyntaxStyle(lib, ptr);
  }
  static fromTheme(theme) {
    const style = SyntaxStyle.create();
    const flatStyles = convertThemeToStyles(theme);
    for (const [name, styleDef] of Object.entries(flatStyles)) {
      style.registerStyle(name, styleDef);
    }
    return style;
  }
  static fromStyles(styles) {
    const style = SyntaxStyle.create();
    for (const [name, styleDef] of Object.entries(styles)) {
      style.registerStyle(name, styleDef);
    }
    return style;
  }
  guard() {
    if (this._destroyed)
      throw new Error("NativeSyntaxStyle is destroyed");
  }
  registerStyle(name, style) {
    this.guard();
    const attributes = createTextAttributes({
      bold: style.bold,
      italic: style.italic,
      underline: style.underline,
      dim: style.dim
    });
    const fg = style.fg ? parseColor(style.fg) : null;
    const bg = style.bg ? parseColor(style.bg) : null;
    const id = this.lib.syntaxStyleRegister(this.stylePtr, name, fg, bg, attributes);
    this.nameCache.set(name, id);
    this.styleDefs.set(name, { ...style, fg: fg ?? undefined, bg: bg ?? undefined });
    return id;
  }
  resolveStyleId(name) {
    this.guard();
    const cached = this.nameCache.get(name);
    if (cached !== undefined)
      return cached;
    const id = this.lib.syntaxStyleResolveByName(this.stylePtr, name);
    if (id !== null) {
      this.nameCache.set(name, id);
    }
    return id;
  }
  getStyleId(name) {
    this.guard();
    const id = this.resolveStyleId(name);
    if (id !== null)
      return id;
    if (name.includes(".")) {
      const baseName = name.split(".")[0];
      return this.resolveStyleId(baseName);
    }
    return null;
  }
  get ptr() {
    this.guard();
    return this.stylePtr;
  }
  getStyleCount() {
    this.guard();
    return this.lib.syntaxStyleGetStyleCount(this.stylePtr);
  }
  clearNameCache() {
    this.nameCache.clear();
  }
  getStyle(name) {
    this.guard();
    if (Object.prototype.hasOwnProperty.call(this.styleDefs, name)) {
      return;
    }
    const style = this.styleDefs.get(name);
    if (style)
      return style;
    if (name.includes(".")) {
      const baseName = name.split(".")[0];
      if (Object.prototype.hasOwnProperty.call(this.styleDefs, baseName)) {
        return;
      }
      return this.styleDefs.get(baseName);
    }
    return;
  }
  mergeStyles(...styleNames) {
    this.guard();
    const cacheKey = styleNames.join(":");
    const cached = this.mergedCache.get(cacheKey);
    if (cached)
      return cached;
    const styleDefinition = {};
    for (const name of styleNames) {
      const style = this.getStyle(name);
      if (!style)
        continue;
      if (style.fg)
        styleDefinition.fg = style.fg;
      if (style.bg)
        styleDefinition.bg = style.bg;
      if (style.bold !== undefined)
        styleDefinition.bold = style.bold;
      if (style.italic !== undefined)
        styleDefinition.italic = style.italic;
      if (style.underline !== undefined)
        styleDefinition.underline = style.underline;
      if (style.dim !== undefined)
        styleDefinition.dim = style.dim;
    }
    const attributes = createTextAttributes({
      bold: styleDefinition.bold,
      italic: styleDefinition.italic,
      underline: styleDefinition.underline,
      dim: styleDefinition.dim
    });
    const merged = {
      fg: styleDefinition.fg,
      bg: styleDefinition.bg,
      attributes
    };
    this.mergedCache.set(cacheKey, merged);
    return merged;
  }
  clearCache() {
    this.guard();
    this.mergedCache.clear();
  }
  getCacheSize() {
    this.guard();
    return this.mergedCache.size;
  }
  getAllStyles() {
    this.guard();
    return new Map(this.styleDefs);
  }
  getRegisteredNames() {
    this.guard();
    return Array.from(this.styleDefs.keys());
  }
  destroy() {
    if (this._destroyed)
      return;
    this._destroyed = true;
    this.nameCache.clear();
    this.styleDefs.clear();
    this.mergedCache.clear();
    this.lib.destroySyntaxStyle(this.stylePtr);
  }
}

// src/renderables/Box.ts
function isGapType(value) {
  if (value === undefined) {
    return true;
  }
  if (typeof value === "number" && !Number.isNaN(value)) {
    return true;
  }
  return isValidPercentage(value);
}

class BoxRenderable extends Renderable {
  _backgroundColor;
  _border;
  _borderStyle;
  _borderColor;
  _focusedBorderColor;
  _customBorderCharsObj;
  _customBorderChars;
  borderSides;
  shouldFill;
  _title;
  _titleColor;
  _titleAlignment;
  _bottomTitle;
  _bottomTitleAlignment;
  _defaultOptions = {
    backgroundColor: "transparent",
    borderStyle: "single",
    border: false,
    borderColor: "#FFFFFF",
    shouldFill: true,
    titleAlignment: "left",
    bottomTitleAlignment: "left",
    focusedBorderColor: "#00AAFF"
  };
  constructor(ctx, options) {
    super(ctx, options);
    if (options.focusable === true) {
      this._focusable = true;
    }
    this._backgroundColor = parseColor(options.backgroundColor || this._defaultOptions.backgroundColor);
    this._border = options.border ?? this._defaultOptions.border;
    if (!options.border && (options.borderStyle || options.borderColor || options.focusedBorderColor || options.customBorderChars)) {
      this._border = true;
    }
    this._borderStyle = parseBorderStyle(options.borderStyle, this._defaultOptions.borderStyle);
    this._borderColor = parseColor(options.borderColor || this._defaultOptions.borderColor);
    this._focusedBorderColor = parseColor(options.focusedBorderColor || this._defaultOptions.focusedBorderColor);
    this._customBorderCharsObj = options.customBorderChars;
    this._customBorderChars = this._customBorderCharsObj ? borderCharsToArray(this._customBorderCharsObj) : undefined;
    this.borderSides = getBorderSides(this._border);
    this.shouldFill = options.shouldFill ?? this._defaultOptions.shouldFill;
    this._title = options.title;
    this._titleColor = options.titleColor ? parseColor(options.titleColor) : undefined;
    this._titleAlignment = options.titleAlignment || this._defaultOptions.titleAlignment;
    this._bottomTitle = options.bottomTitle;
    this._bottomTitleAlignment = options.bottomTitleAlignment || this._defaultOptions.bottomTitleAlignment;
    this.applyYogaBorders();
    const hasInitialGapProps = options.gap !== undefined || options.rowGap !== undefined || options.columnGap !== undefined;
    if (hasInitialGapProps) {
      this.applyYogaGap(options);
    }
  }
  initializeBorder() {
    if (this._border === false) {
      this._border = true;
      this.borderSides = getBorderSides(this._border);
      this.applyYogaBorders();
    }
  }
  get customBorderChars() {
    return this._customBorderCharsObj;
  }
  set customBorderChars(value) {
    this._customBorderCharsObj = value;
    this._customBorderChars = value ? borderCharsToArray(value) : undefined;
    this.requestRender();
  }
  get backgroundColor() {
    return this._backgroundColor;
  }
  set backgroundColor(value) {
    const newColor = parseColor(value ?? this._defaultOptions.backgroundColor);
    if (this._backgroundColor !== newColor) {
      this._backgroundColor = newColor;
      this.requestRender();
    }
  }
  get border() {
    return this._border;
  }
  set border(value) {
    if (this._border !== value) {
      this._border = value;
      this.borderSides = getBorderSides(value);
      this.applyYogaBorders();
      this.requestRender();
    }
  }
  get borderStyle() {
    return this._borderStyle;
  }
  set borderStyle(value) {
    const _value = parseBorderStyle(value, this._defaultOptions.borderStyle);
    if (this._borderStyle !== _value || !this._border) {
      this._borderStyle = _value;
      this._customBorderChars = undefined;
      this.initializeBorder();
      this.requestRender();
    }
  }
  get borderColor() {
    return this._borderColor;
  }
  set borderColor(value) {
    const newColor = parseColor(value ?? this._defaultOptions.borderColor);
    if (this._borderColor !== newColor) {
      this._borderColor = newColor;
      this.initializeBorder();
      this.requestRender();
    }
  }
  get focusedBorderColor() {
    return this._focusedBorderColor;
  }
  set focusedBorderColor(value) {
    const newColor = parseColor(value ?? this._defaultOptions.focusedBorderColor);
    if (this._focusedBorderColor !== newColor) {
      this._focusedBorderColor = newColor;
      this.initializeBorder();
      if (this._focused) {
        this.requestRender();
      }
    }
  }
  get title() {
    return this._title;
  }
  set title(value) {
    if (this._title !== value) {
      this._title = value;
      this.requestRender();
    }
  }
  get titleColor() {
    return this._titleColor;
  }
  set titleColor(value) {
    const newColor = value ? parseColor(value) : undefined;
    if (this._titleColor !== newColor) {
      this._titleColor = newColor;
      this.requestRender();
    }
  }
  get titleAlignment() {
    return this._titleAlignment;
  }
  set titleAlignment(value) {
    if (this._titleAlignment !== value) {
      this._titleAlignment = value;
      this.requestRender();
    }
  }
  get bottomTitle() {
    return this._bottomTitle;
  }
  set bottomTitle(value) {
    if (this._bottomTitle !== value) {
      this._bottomTitle = value;
      this.requestRender();
    }
  }
  get bottomTitleAlignment() {
    return this._bottomTitleAlignment;
  }
  set bottomTitleAlignment(value) {
    if (this._bottomTitleAlignment !== value) {
      this._bottomTitleAlignment = value;
      this.requestRender();
    }
  }
  renderSelf(buffer) {
    const hasBorder = this.borderSides.top || this.borderSides.right || this.borderSides.bottom || this.borderSides.left;
    const hasVisibleFill = this.shouldFill && this._backgroundColor.a > 0;
    if (!hasBorder && !hasVisibleFill) {
      return;
    }
    const hasFocusWithin = this._focusable && (this._focused || this._hasFocusedDescendant);
    const currentBorderColor = hasFocusWithin ? this._focusedBorderColor : this._borderColor;
    const screenX = this._screenX;
    const screenY = this._screenY;
    buffer.drawBox({
      x: screenX,
      y: screenY,
      width: this.width,
      height: this.height,
      borderStyle: this._borderStyle,
      customBorderChars: this._customBorderChars,
      border: this._border,
      borderColor: currentBorderColor,
      backgroundColor: this._backgroundColor,
      shouldFill: this.shouldFill,
      title: this._title,
      titleColor: this._titleColor ?? currentBorderColor,
      titleAlignment: this._titleAlignment,
      bottomTitle: this._bottomTitle,
      bottomTitleAlignment: this._bottomTitleAlignment
    });
  }
  getScissorRect() {
    const baseRect = super.getScissorRect();
    if (!this.borderSides.top && !this.borderSides.right && !this.borderSides.bottom && !this.borderSides.left) {
      return baseRect;
    }
    const leftInset = this.borderSides.left ? 1 : 0;
    const rightInset = this.borderSides.right ? 1 : 0;
    const topInset = this.borderSides.top ? 1 : 0;
    const bottomInset = this.borderSides.bottom ? 1 : 0;
    return {
      x: baseRect.x + leftInset,
      y: baseRect.y + topInset,
      width: Math.max(0, baseRect.width - leftInset - rightInset),
      height: Math.max(0, baseRect.height - topInset - bottomInset)
    };
  }
  applyYogaBorders() {
    const node = this.yogaNode;
    node.setBorder(0 /* Left */, this.borderSides.left ? 1 : 0);
    node.setBorder(2 /* Right */, this.borderSides.right ? 1 : 0);
    node.setBorder(1 /* Top */, this.borderSides.top ? 1 : 0);
    node.setBorder(3 /* Bottom */, this.borderSides.bottom ? 1 : 0);
    this.requestRender();
  }
  applyYogaGap(options) {
    const node = this.yogaNode;
    if (isGapType(options.gap)) {
      node.setGap(2 /* All */, options.gap);
    }
    if (isGapType(options.rowGap)) {
      node.setGap(1 /* Row */, options.rowGap);
    }
    if (isGapType(options.columnGap)) {
      node.setGap(0 /* Column */, options.columnGap);
    }
  }
  set gap(gap) {
    if (isGapType(gap)) {
      this.yogaNode.setGap(2 /* All */, gap);
      this.requestRender();
    }
  }
  set rowGap(rowGap) {
    if (isGapType(rowGap)) {
      this.yogaNode.setGap(1 /* Row */, rowGap);
      this.requestRender();
    }
  }
  set columnGap(columnGap) {
    if (isGapType(columnGap)) {
      this.yogaNode.setGap(0 /* Column */, columnGap);
      this.requestRender();
    }
  }
}

// src/renderables/TextBufferRenderable.ts
class TextBufferRenderable extends Renderable {
  selectable = true;
  _defaultFg;
  _defaultBg;
  _defaultAttributes;
  _selectionBg;
  _selectionFg;
  _wrapMode = "word";
  lastLocalSelection = null;
  _tabIndicator;
  _tabIndicatorColor;
  _scrollX = 0;
  _scrollY = 0;
  _truncate = false;
  _firstLineOffset = 0;
  textBuffer;
  textBufferView;
  _textBufferSyntaxStyle;
  nativeRenderable = null;
  _defaultOptions = {
    fg: RGBA.fromValues(1, 1, 1, 1),
    bg: RGBA.fromValues(0, 0, 0, 0),
    selectionBg: undefined,
    selectionFg: undefined,
    selectable: true,
    attributes: 0,
    wrapMode: "word",
    tabIndicator: undefined,
    tabIndicatorColor: undefined,
    truncate: false
  };
  constructor(ctx, options) {
    super(ctx, options);
    this._defaultFg = parseColor(options.fg ?? this._defaultOptions.fg);
    this._defaultBg = parseColor(options.bg ?? this._defaultOptions.bg);
    this._defaultAttributes = options.attributes ?? this._defaultOptions.attributes;
    this._selectionBg = options.selectionBg ? parseColor(options.selectionBg) : this._defaultOptions.selectionBg;
    this._selectionFg = options.selectionFg ? parseColor(options.selectionFg) : this._defaultOptions.selectionFg;
    this.selectable = options.selectable ?? this._defaultOptions.selectable;
    this._wrapMode = options.wrapMode ?? this._defaultOptions.wrapMode;
    this._tabIndicator = options.tabIndicator ?? this._defaultOptions.tabIndicator;
    this._tabIndicatorColor = options.tabIndicatorColor ? parseColor(options.tabIndicatorColor) : this._defaultOptions.tabIndicatorColor;
    this._truncate = options.truncate ?? this._defaultOptions.truncate;
    this.textBuffer = TextBuffer.create(this._ctx.widthMethod);
    this.textBufferView = TextBufferView.create(this.textBuffer);
    this._firstLineOffset = ctx.claimFirstLineOffset?.(this) ?? 0;
    this._textBufferSyntaxStyle = SyntaxStyle.create();
    this.textBuffer.setSyntaxStyle(this._textBufferSyntaxStyle);
    this.textBufferView.setWrapMode(this._wrapMode);
    this.textBufferView.setFirstLineOffset(this._firstLineOffset);
    this.setupNativeRenderable();
    this.textBuffer.setDefaultFg(this._defaultFg);
    this.textBuffer.setDefaultBg(this._defaultBg);
    this.textBuffer.setDefaultAttributes(this._defaultAttributes);
    if (this._tabIndicator !== undefined) {
      this.textBufferView.setTabIndicator(this._tabIndicator);
    }
    if (this._tabIndicatorColor !== undefined) {
      this.textBufferView.setTabIndicatorColor(this._tabIndicatorColor);
    }
    if (this._wrapMode !== "none" && this.width > 0) {
      this.textBufferView.setWrapWidth(this.width);
    }
    if (this.width > 0 && this.height > 0) {
      this.textBufferView.setViewport(this._scrollX, this._scrollY, this.width, this.height);
    }
    this.textBufferView.setTruncate(this._truncate);
    this.updateTextInfo();
  }
  onMouseEvent(event) {
    if (event.type === "scroll") {
      this.handleScroll(event);
    }
  }
  handleScroll(event) {
    if (!event.scroll)
      return;
    const { direction, delta } = event.scroll;
    if (direction === "up") {
      this.scrollY -= delta;
    } else if (direction === "down") {
      this.scrollY += delta;
    }
    if (this._wrapMode === "none") {
      if (direction === "left") {
        this.scrollX -= delta;
      } else if (direction === "right") {
        this.scrollX += delta;
      }
    }
  }
  get lineInfo() {
    return this.textBufferView.logicalLineInfo;
  }
  get lineCount() {
    return this.textBuffer.getLineCount();
  }
  get virtualLineCount() {
    return this.textBufferView.getVirtualLineCount();
  }
  get scrollY() {
    return this._scrollY;
  }
  set scrollY(value) {
    const maxScrollY = Math.max(0, this.scrollHeight - this.height);
    const clamped = Math.max(0, Math.min(value, maxScrollY));
    if (this._scrollY !== clamped) {
      this._scrollY = clamped;
      this.updateViewportOffset();
      this.requestRender();
    }
  }
  get scrollX() {
    return this._scrollX;
  }
  set scrollX(value) {
    const maxScrollX = Math.max(0, this.scrollWidth - this.width);
    const clamped = Math.max(0, Math.min(value, maxScrollX));
    if (this._scrollX !== clamped) {
      this._scrollX = clamped;
      this.updateViewportOffset();
      this.requestRender();
    }
  }
  get scrollWidth() {
    return this.lineInfo.lineWidthColsMax;
  }
  get scrollHeight() {
    return this.lineInfo.lineStartCols.length;
  }
  get maxScrollY() {
    return Math.max(0, this.scrollHeight - this.height);
  }
  get maxScrollX() {
    return Math.max(0, this.scrollWidth - this.width);
  }
  updateViewportOffset() {
    if (this.width > 0 && this.height > 0) {
      this.textBufferView.setViewport(this._scrollX, this._scrollY, this.width, this.height);
    }
  }
  get plainText() {
    return this.textBuffer.getPlainText();
  }
  get textLength() {
    return this.textBuffer.length;
  }
  get fg() {
    return this._defaultFg;
  }
  set fg(value) {
    const newColor = parseColor(value ?? this._defaultOptions.fg);
    if (this._defaultFg !== newColor) {
      this._defaultFg = newColor;
      this.textBuffer.setDefaultFg(this._defaultFg);
      this.onFgChanged(newColor);
      this.requestRender();
    }
  }
  get selectionBg() {
    return this._selectionBg;
  }
  set selectionBg(value) {
    const newColor = value ? parseColor(value) : this._defaultOptions.selectionBg;
    if (this._selectionBg !== newColor) {
      this._selectionBg = newColor;
      if (this.lastLocalSelection) {
        this.updateLocalSelection(this.lastLocalSelection);
      }
      this.requestRender();
    }
  }
  get selectionFg() {
    return this._selectionFg;
  }
  set selectionFg(value) {
    const newColor = value ? parseColor(value) : this._defaultOptions.selectionFg;
    if (this._selectionFg !== newColor) {
      this._selectionFg = newColor;
      if (this.lastLocalSelection) {
        this.updateLocalSelection(this.lastLocalSelection);
      }
      this.requestRender();
    }
  }
  get bg() {
    return this._defaultBg;
  }
  set bg(value) {
    const newColor = parseColor(value ?? this._defaultOptions.bg);
    if (this._defaultBg !== newColor) {
      this._defaultBg = newColor;
      this.textBuffer.setDefaultBg(this._defaultBg);
      this.onBgChanged(newColor);
      this.requestRender();
    }
  }
  get attributes() {
    return this._defaultAttributes;
  }
  set attributes(value) {
    if (this._defaultAttributes !== value) {
      this._defaultAttributes = value;
      this.textBuffer.setDefaultAttributes(this._defaultAttributes);
      this.onAttributesChanged(value);
      this.requestRender();
    }
  }
  get wrapMode() {
    return this._wrapMode;
  }
  set wrapMode(value) {
    if (this._wrapMode !== value) {
      this._wrapMode = value;
      this.textBufferView.setWrapMode(this._wrapMode);
      if (value !== "none" && this.width > 0) {
        this.textBufferView.setWrapWidth(this.width);
      }
      this.yogaNode.markDirty();
      this.requestRender();
    }
  }
  get tabIndicator() {
    return this._tabIndicator;
  }
  set tabIndicator(value) {
    if (this._tabIndicator !== value) {
      this._tabIndicator = value;
      if (value !== undefined) {
        this.textBufferView.setTabIndicator(value);
      }
      this.requestRender();
    }
  }
  get tabIndicatorColor() {
    return this._tabIndicatorColor;
  }
  set tabIndicatorColor(value) {
    const newColor = value ? parseColor(value) : undefined;
    if (this._tabIndicatorColor !== newColor) {
      this._tabIndicatorColor = newColor;
      if (newColor !== undefined) {
        this.textBufferView.setTabIndicatorColor(newColor);
      }
      this.requestRender();
    }
  }
  get truncate() {
    return this._truncate;
  }
  set truncate(value) {
    if (this._truncate !== value) {
      this._truncate = value;
      this.textBufferView.setTruncate(value);
      this.requestRender();
    }
  }
  onResize(width, height) {
    this.textBufferView.setViewport(this._scrollX, this._scrollY, width, height);
    this.yogaNode.markDirty();
    this.requestRender();
    this.emit("line-info-change");
  }
  refreshLocalSelection() {
    if (this.lastLocalSelection) {
      return this.updateLocalSelection(this.lastLocalSelection);
    }
    return false;
  }
  updateLocalSelection(localSelection) {
    if (!localSelection?.isActive) {
      this.textBufferView.resetLocalSelection();
      return true;
    }
    return this.textBufferView.setLocalSelection(localSelection.anchorX, localSelection.anchorY, localSelection.focusX, localSelection.focusY, this._selectionBg, this._selectionFg);
  }
  updateTextInfo() {
    if (this.lastLocalSelection) {
      this.updateLocalSelection(this.lastLocalSelection);
    }
    this.yogaNode.markDirty();
    this.requestRender();
    this.emit("line-info-change");
  }
  setupNativeRenderable() {
    const lib = resolveRenderLib();
    const nativeRenderable = lib.createNativeRenderable();
    if (!lib.nativeRenderableAttachYogaNode(nativeRenderable, this.yogaNode.ptr)) {
      lib.destroyNativeRenderable(nativeRenderable);
      throw new Error("Failed to attach native renderable Yoga node");
    }
    if (!lib.nativeRenderableSetMeasureTarget(nativeRenderable, NativeMeasureTargetKind.TextBufferView, this.textBufferView.ptr)) {
      lib.destroyNativeRenderable(nativeRenderable);
      throw new Error("Failed to attach text buffer native measure target");
    }
    this.nativeRenderable = nativeRenderable;
  }
  shouldStartSelection(x, y) {
    if (!this.selectable)
      return false;
    const localX = x - this.x;
    const localY = y - this.y;
    return localX >= 0 && localX < this.width && localY >= 0 && localY < this.height;
  }
  onSelectionChanged(selection) {
    const localSelection = convertGlobalToLocalSelection(selection, this.x, this.y);
    this.lastLocalSelection = localSelection;
    let changed;
    if (!localSelection?.isActive) {
      this.textBufferView.resetLocalSelection();
      changed = true;
    } else if (selection?.isStart) {
      changed = this.textBufferView.setLocalSelection(localSelection.anchorX, localSelection.anchorY, localSelection.focusX, localSelection.focusY, this._selectionBg, this._selectionFg);
    } else {
      changed = this.textBufferView.updateLocalSelection(localSelection.anchorX, localSelection.anchorY, localSelection.focusX, localSelection.focusY, this._selectionBg, this._selectionFg);
    }
    if (changed) {
      this.requestRender();
    }
    return this.hasSelection();
  }
  getSelectedText() {
    return this.textBufferView.getSelectedText();
  }
  hasSelection() {
    return this.textBufferView.hasSelection();
  }
  getSelection() {
    return this.textBufferView.getSelection();
  }
  render(buffer, deltaTime) {
    if (!this.visible)
      return;
    const screenX = this._screenX;
    const screenY = this._screenY;
    this.markClean();
    this._ctx.addToHitGrid(screenX, screenY, this.width, this.height, this.num);
    this.renderSelf(buffer);
    if (this.buffered && this.frameBuffer) {
      buffer.drawFrameBuffer(screenX, screenY, this.frameBuffer);
    }
  }
  renderSelf(buffer) {
    if (this.textBuffer.ptr) {
      buffer.drawTextBuffer(this.textBufferView, this._screenX, this._screenY);
    }
  }
  destroy() {
    if (this.isDestroyed)
      return;
    if (this.nativeRenderable) {
      resolveRenderLib().destroyNativeRenderable(this.nativeRenderable);
      this.nativeRenderable = null;
    }
    this.textBuffer.setSyntaxStyle(null);
    this._textBufferSyntaxStyle.destroy();
    this.textBufferView.destroy();
    this.textBuffer.destroy();
    super.destroy();
  }
  onFgChanged(newColor) {}
  onBgChanged(newColor) {}
  onAttributesChanged(newAttributes) {}
}

// src/renderables/Code.ts
class CodeRenderable extends TextBufferRenderable {
  _content;
  _filetype;
  _syntaxStyle;
  _isHighlighting = false;
  _treeSitterClient;
  _highlightsDirty = false;
  _highlightSnapshotId = 0;
  _conceal;
  _drawUnstyledText;
  _shouldRenderTextBuffer = true;
  _streaming;
  _initialStyledText;
  _hadInitialContent = false;
  _lastHighlights = [];
  _baseHighlight;
  _onHighlight;
  _onChunks;
  _highlightingPromise = Promise.resolve();
  _renderedLineSources;
  _mappedLineInfo;
  _contentDefaultOptions = {
    content: "",
    conceal: true,
    drawUnstyledText: true,
    streaming: false
  };
  constructor(ctx, options) {
    super(ctx, options);
    this._content = options.content ?? this._contentDefaultOptions.content;
    this._filetype = options.filetype;
    this._syntaxStyle = options.syntaxStyle;
    this._treeSitterClient = options.treeSitterClient ?? getTreeSitterClient();
    this._conceal = options.conceal ?? this._contentDefaultOptions.conceal;
    this._drawUnstyledText = options.drawUnstyledText ?? this._contentDefaultOptions.drawUnstyledText;
    this._streaming = options.streaming ?? this._contentDefaultOptions.streaming;
    this._initialStyledText = options.initialStyledText;
    this._baseHighlight = options.baseHighlight;
    this._onHighlight = options.onHighlight;
    this._onChunks = options.onChunks;
    if (this._content.length > 0) {
      if (this._initialStyledText && this._drawUnstyledText) {
        this.textBuffer.setStyledText(this._initialStyledText);
      } else {
        this.textBuffer.setText(this._content);
      }
      this.updateTextInfo();
      this._shouldRenderTextBuffer = this._drawUnstyledText || !this._filetype;
    }
    this._highlightsDirty = this._content.length > 0;
  }
  get content() {
    return this._content;
  }
  set content(value) {
    if (this._content !== value) {
      this._content = value;
      this._highlightsDirty = true;
      this._highlightSnapshotId++;
      if (this._streaming && this._filetype && !this._drawUnstyledText) {
        this.requestRender();
        return;
      }
      if (this._initialStyledText && this._drawUnstyledText) {
        this.textBuffer.setStyledText(this._initialStyledText);
      } else {
        this.textBuffer.setText(value);
      }
      this.setRenderedLineSources(undefined);
      this.updateTextInfo();
    }
  }
  get lineInfo() {
    if (!this._renderedLineSources)
      return super.lineInfo;
    if (this._mappedLineInfo)
      return this._mappedLineInfo;
    const lineInfo = super.lineInfo;
    const renderedLineSources = this._renderedLineSources;
    this._mappedLineInfo = {
      ...lineInfo,
      lineSources: lineInfo.lineSources.map((line) => renderedLineSources[line] ?? line)
    };
    return this._mappedLineInfo;
  }
  get wrapMode() {
    return super.wrapMode;
  }
  set wrapMode(value) {
    if (super.wrapMode !== value) {
      this._mappedLineInfo = undefined;
      super.wrapMode = value;
    }
  }
  onResize(width, height) {
    this._mappedLineInfo = undefined;
    super.onResize(width, height);
  }
  updateTextInfo() {
    this._mappedLineInfo = undefined;
    super.updateTextInfo();
  }
  get filetype() {
    return this._filetype;
  }
  set filetype(value) {
    if (this._filetype !== value) {
      this._filetype = value;
      this._highlightsDirty = true;
    }
  }
  get syntaxStyle() {
    return this._syntaxStyle;
  }
  set syntaxStyle(value) {
    if (this._syntaxStyle !== value) {
      this._syntaxStyle = value;
      this._highlightsDirty = true;
    }
  }
  get conceal() {
    return this._conceal;
  }
  set conceal(value) {
    if (this._conceal !== value) {
      this._conceal = value;
      this._highlightsDirty = true;
    }
  }
  get drawUnstyledText() {
    return this._drawUnstyledText;
  }
  set drawUnstyledText(value) {
    if (this._drawUnstyledText !== value) {
      this._drawUnstyledText = value;
      this._highlightsDirty = true;
    }
  }
  get streaming() {
    return this._streaming;
  }
  set initialStyledText(value) {
    if (this._initialStyledText !== value) {
      this._initialStyledText = value;
      this._highlightsDirty = true;
    }
  }
  set streaming(value) {
    if (this._streaming !== value) {
      this._streaming = value;
      this._hadInitialContent = false;
      this._lastHighlights = [];
      this._highlightsDirty = true;
    }
  }
  get treeSitterClient() {
    return this._treeSitterClient;
  }
  set treeSitterClient(value) {
    if (this._treeSitterClient !== value) {
      this._treeSitterClient = value;
      this._highlightsDirty = true;
    }
  }
  get onHighlight() {
    return this._onHighlight;
  }
  get baseHighlight() {
    return this._baseHighlight;
  }
  set baseHighlight(value) {
    if (this._baseHighlight !== value) {
      this._baseHighlight = value;
      this._highlightsDirty = true;
    }
  }
  set onHighlight(value) {
    if (this._onHighlight !== value) {
      this._onHighlight = value;
      this._highlightsDirty = true;
    }
  }
  get onChunks() {
    return this._onChunks;
  }
  set onChunks(value) {
    if (this._onChunks !== value) {
      this._onChunks = value;
      this._highlightsDirty = true;
    }
  }
  get isHighlighting() {
    return this._isHighlighting;
  }
  get highlightingDone() {
    return this._highlightingPromise;
  }
  async transformChunks(chunks, context) {
    if (!this._onChunks)
      return chunks;
    const modified = await this._onChunks(chunks, context);
    return modified ?? chunks;
  }
  ensureVisibleTextBeforeHighlight() {
    if (this.isDestroyed)
      return;
    const content = this._content;
    if (!this._filetype) {
      this._shouldRenderTextBuffer = true;
      return;
    }
    const isInitialContent = this._streaming && !this._hadInitialContent;
    const shouldDrawUnstyledNow = this._streaming ? isInitialContent && this._drawUnstyledText : this._drawUnstyledText;
    if (this._streaming && !isInitialContent) {
      this._shouldRenderTextBuffer = true;
    } else if (shouldDrawUnstyledNow) {
      if (this._initialStyledText) {
        this.textBuffer.setStyledText(this._initialStyledText);
      } else {
        this.textBuffer.setText(content);
      }
      this.setRenderedLineSources(undefined);
      this._shouldRenderTextBuffer = true;
    } else {
      this._shouldRenderTextBuffer = false;
    }
  }
  async startHighlight() {
    const content = this._content;
    const filetype = this._filetype;
    const snapshotId = ++this._highlightSnapshotId;
    if (!filetype)
      return;
    const isInitialContent = this._streaming && !this._hadInitialContent;
    if (isInitialContent) {
      this._hadInitialContent = true;
    }
    this._isHighlighting = true;
    try {
      const result = await this._treeSitterClient.highlightOnce(content, filetype);
      if (snapshotId !== this._highlightSnapshotId) {
        this.requestRender();
        return;
      }
      if (this.isDestroyed)
        return;
      let highlights = result.highlights ?? [];
      if (this._onHighlight && highlights.length >= 0) {
        const context = {
          content,
          filetype,
          syntaxStyle: this._syntaxStyle
        };
        const modified = await this._onHighlight(highlights, context);
        if (modified !== undefined) {
          highlights = modified;
        }
      }
      if (snapshotId !== this._highlightSnapshotId) {
        this.requestRender();
        return;
      }
      if (this.isDestroyed)
        return;
      if (highlights.length > 0) {
        if (this._streaming) {
          this._lastHighlights = highlights;
        }
      }
      if (highlights.length > 0 || this._onChunks || this._baseHighlight) {
        const context = {
          content,
          filetype,
          syntaxStyle: this._syntaxStyle,
          highlights
        };
        let chunks = treeSitterToTextChunks(content, highlights, this._syntaxStyle, {
          enabled: this._conceal,
          baseHighlight: this._baseHighlight
        });
        const renderedLineSources = this._onChunks ? undefined : this.getConcealLinesSourceMap(content, highlights);
        chunks = await this.transformChunks(chunks, context);
        if (snapshotId !== this._highlightSnapshotId) {
          this.requestRender();
          return;
        }
        if (this.isDestroyed)
          return;
        const styledText = new StyledText(chunks);
        this.textBuffer.setStyledText(styledText);
        this.setRenderedLineSources(renderedLineSources);
      } else {
        this.textBuffer.setText(content);
        this.setRenderedLineSources(undefined);
      }
      this._shouldRenderTextBuffer = true;
      this._isHighlighting = false;
      this._highlightsDirty = false;
      this.updateTextInfo();
      this.requestRender();
    } catch (error) {
      if (snapshotId !== this._highlightSnapshotId) {
        this.requestRender();
        return;
      }
      console.warn("Code highlighting failed, falling back to plain text:", error);
      if (this.isDestroyed)
        return;
      this.textBuffer.setText(content);
      this.setRenderedLineSources(undefined);
      this._shouldRenderTextBuffer = true;
      this._isHighlighting = false;
      this._highlightsDirty = false;
      this.updateTextInfo();
      this.requestRender();
    }
  }
  setRenderedLineSources(lineSources) {
    this._renderedLineSources = lineSources;
    this._mappedLineInfo = undefined;
  }
  static isIdentityLineSources(lineSources) {
    for (let i = 0;i < lineSources.length; i++) {
      if (lineSources[i] !== i)
        return false;
    }
    return true;
  }
  static getMergedConcealLineRanges(highlights) {
    const ranges = [];
    for (const highlight of highlights) {
      const meta = highlight[3];
      if (meta?.concealLines === undefined)
        continue;
      const group = highlight[2];
      const isEmptyConceal = meta.conceal === "" || meta.conceal === undefined && (group === "conceal" || group.startsWith("conceal."));
      if (isEmptyConceal) {
        ranges.push([highlight[0], highlight[1]]);
      }
    }
    if (ranges.length <= 1)
      return ranges;
    ranges.sort((a, b) => a[0] - b[0]);
    let writeIndex = 0;
    for (let i = 1;i < ranges.length; i++) {
      const current = ranges[writeIndex];
      const next = ranges[i];
      if (next[0] <= current[1]) {
        current[1] = Math.max(current[1], next[1]);
      } else {
        writeIndex++;
        ranges[writeIndex] = next;
      }
    }
    ranges.length = writeIndex + 1;
    return ranges;
  }
  getConcealLinesSourceMap(content, highlights) {
    if (!this._conceal || content.length === 0)
      return;
    const concealLineRanges = CodeRenderable.getMergedConcealLineRanges(highlights);
    if (concealLineRanges.length === 0)
      return;
    const lineSources = [];
    let sourceLine = 0;
    let lineStart = 0;
    let rangeIndex = 0;
    let currentRenderedLineHasText = false;
    const setCurrentRenderedLineSource = (line, hasText) => {
      if (lineSources.length === 0) {
        lineSources.push(line);
      } else if (!currentRenderedLineHasText) {
        lineSources[lineSources.length - 1] = line;
      }
      if (hasText)
        currentRenderedLineHasText = true;
    };
    while (lineStart <= content.length) {
      const newlineOffset = content.indexOf(`
`, lineStart);
      const lineEnd = newlineOffset === -1 ? content.length : newlineOffset;
      while (rangeIndex < concealLineRanges.length && concealLineRanges[rangeIndex][1] <= lineStart) {
        rangeIndex++;
      }
      const range = concealLineRanges[rangeIndex];
      const fullyConcealed = !!range && lineEnd > lineStart && range[0] <= lineStart && range[1] >= lineEnd;
      const lineBreakConcealed = newlineOffset !== -1 && !!range && range[0] <= newlineOffset && range[1] >= newlineOffset;
      if (!fullyConcealed || !lineBreakConcealed) {
        const hasText = lineEnd > lineStart && !fullyConcealed;
        if (hasText || newlineOffset !== -1 || !fullyConcealed) {
          setCurrentRenderedLineSource(sourceLine, hasText);
        }
        if (newlineOffset !== -1 && !lineBreakConcealed) {
          lineSources.push(sourceLine + 1);
          currentRenderedLineHasText = false;
        }
      }
      sourceLine++;
      if (newlineOffset === -1)
        break;
      lineStart = newlineOffset + 1;
    }
    if (lineSources.length === 0 || CodeRenderable.isIdentityLineSources(lineSources))
      return;
    return lineSources;
  }
  getLineHighlights(lineIdx) {
    return this.textBuffer.getLineHighlights(lineIdx);
  }
  renderSelf(buffer) {
    if (this._highlightsDirty) {
      if (this.isDestroyed)
        return;
      if (this._content.length === 0) {
        this._shouldRenderTextBuffer = false;
        this._highlightsDirty = false;
      } else if (!this._filetype) {
        this._shouldRenderTextBuffer = true;
        this._highlightsDirty = false;
      } else {
        this.ensureVisibleTextBeforeHighlight();
        this._highlightsDirty = false;
        this._highlightingPromise = this.startHighlight();
      }
    }
    if (!this._shouldRenderTextBuffer)
      return;
    super.renderSelf(buffer);
  }
}

// src/renderables/TextNode.ts
var BrandedTextNodeRenderable = Symbol.for("@opentui/core/TextNodeRenderable");
function isTextNodeRenderable(obj) {
  return !!obj?.[BrandedTextNodeRenderable];
}
function styledTextToTextNodes(styledText) {
  return styledText.chunks.map((chunk) => {
    const node = new TextNodeRenderable({
      fg: chunk.fg,
      bg: chunk.bg,
      attributes: chunk.attributes,
      link: chunk.link
    });
    node.add(chunk.text);
    return node;
  });
}

class TextNodeRenderable extends BaseRenderable {
  [BrandedTextNodeRenderable] = true;
  _fg;
  _bg;
  _attributes;
  _link;
  _children = [];
  parent = null;
  constructor(options) {
    super(options);
    this._fg = options.fg ? parseColor(options.fg) : undefined;
    this._bg = options.bg ? parseColor(options.bg) : undefined;
    this._attributes = options.attributes ?? 0;
    this._link = options.link;
  }
  get children() {
    return this._children;
  }
  set children(children) {
    for (const child of this._children) {
      if (isTextNodeRenderable(child) && child.parent === this) {
        child.parent = null;
      }
    }
    for (const child of children) {
      if (isTextNodeRenderable(child)) {
        if (child.parent && child.parent !== this) {
          child.parent.remove(child);
        }
        child.parent = this;
      }
    }
    this._children = children;
    this.requestRender();
  }
  requestRender() {
    this.markDirty();
    this.parent?.requestRender();
  }
  add(obj, index) {
    if (typeof obj === "string") {
      if (index !== undefined) {
        this._children.splice(index, 0, obj);
        this.requestRender();
        return index;
      }
      const insertIndex = this._children.length;
      this._children.push(obj);
      this.requestRender();
      return insertIndex;
    }
    if (isTextNodeRenderable(obj)) {
      const insertIndex = this.prepareChildInsert(obj, index);
      this._children.splice(insertIndex, 0, obj);
      obj.parent = this;
      this.requestRender();
      return insertIndex;
    }
    if (isStyledText(obj)) {
      const textNodes = styledTextToTextNodes(obj);
      if (index !== undefined) {
        this._children.splice(index, 0, ...textNodes);
        textNodes.forEach((node) => node.parent = this);
        this.requestRender();
        return index;
      }
      const insertIndex = this._children.length;
      this._children.push(...textNodes);
      textNodes.forEach((node) => node.parent = this);
      this.requestRender();
      return insertIndex;
    }
    throw new Error("TextNodeRenderable only accepts strings, TextNodeRenderable instances, or StyledText instances");
  }
  prepareChildInsert(child, index) {
    let insertIndex = index ?? this._children.length;
    if (child.parent && child.parent !== this) {
      child.parent.remove(child);
    } else if (child.parent === this) {
      const currentIndex = this._children.indexOf(child);
      if (currentIndex !== -1) {
        this._children.splice(currentIndex, 1);
        if (currentIndex < insertIndex)
          insertIndex -= 1;
      }
    }
    return Math.max(0, Math.min(insertIndex, this._children.length));
  }
  replace(obj, index) {
    const existing = this._children[index];
    if (isTextNodeRenderable(existing) && existing.parent === this) {
      existing.parent = null;
    }
    if (isTextNodeRenderable(obj)) {
      if (obj.parent && obj.parent !== this) {
        obj.parent.remove(obj);
      } else if (obj.parent === this) {
        const currentIndex = this._children.indexOf(obj);
        if (currentIndex !== -1 && currentIndex !== index) {
          this._children.splice(currentIndex, 1);
          if (currentIndex < index)
            index -= 1;
        }
      }
      obj.parent = this;
    }
    this._children[index] = obj;
    this.requestRender();
  }
  insertBefore(child, anchorNode) {
    if (!anchorNode || !isTextNodeRenderable(anchorNode)) {
      throw new Error("Anchor must be a TextNodeRenderable");
    }
    const anchorIndex = this._children.indexOf(anchorNode);
    if (anchorIndex === -1) {
      throw new Error("Anchor node not found in children");
    }
    if (child === anchorNode) {
      return this;
    }
    if (isTextNodeRenderable(child)) {
      this.add(child, anchorIndex);
      return this;
    }
    if (typeof child === "string") {
      this._children.splice(anchorIndex, 0, child);
    } else if (isStyledText(child)) {
      const textNodes = styledTextToTextNodes(child);
      this._children.splice(anchorIndex, 0, ...textNodes);
      textNodes.forEach((node) => node.parent = this);
    } else {
      throw new Error("Child must be a string, TextNodeRenderable, or StyledText instance");
    }
    this.requestRender();
    return this;
  }
  remove(child) {
    if (!isTextNodeRenderable(child)) {
      throw new Error("remove expects a TextNodeRenderable child object");
    }
    const childIndex = this._children.indexOf(child);
    if (childIndex === -1) {
      if (true) {
        console.warn(`TextNodeRenderable with id ${child.id} is not a child of ${this.id}, skipping remove`);
      }
      return;
    }
    this._children.splice(childIndex, 1);
    child.parent = null;
    this.requestRender();
  }
  clear() {
    for (const child of this._children) {
      if (isTextNodeRenderable(child) && child.parent === this) {
        child.parent = null;
      }
    }
    this._children = [];
    this.requestRender();
  }
  mergeStyles(parentStyle) {
    return {
      fg: this._fg ?? parentStyle.fg,
      bg: this._bg ?? parentStyle.bg,
      attributes: this._attributes | parentStyle.attributes,
      link: this._link ?? parentStyle.link
    };
  }
  gatherWithInheritedStyle(parentStyle = {
    fg: undefined,
    bg: undefined,
    attributes: 0
  }) {
    const currentStyle = this.mergeStyles(parentStyle);
    const chunks = [];
    for (const child of this._children) {
      if (typeof child === "string") {
        chunks.push({
          __isChunk: true,
          text: child,
          fg: currentStyle.fg,
          bg: currentStyle.bg,
          attributes: currentStyle.attributes,
          link: currentStyle.link
        });
      } else {
        const childChunks = child.gatherWithInheritedStyle(currentStyle);
        chunks.push(...childChunks);
      }
    }
    this.markClean();
    return chunks;
  }
  static fromString(text, options = {}) {
    const node = new TextNodeRenderable(options);
    node.add(text);
    return node;
  }
  static fromNodes(nodes, options = {}) {
    const node = new TextNodeRenderable(options);
    for (const childNode of nodes) {
      node.add(childNode);
    }
    return node;
  }
  toChunks(parentStyle = {
    fg: undefined,
    bg: undefined,
    attributes: 0
  }) {
    return this.gatherWithInheritedStyle(parentStyle);
  }
  getChildren() {
    return this._children.filter((child) => typeof child !== "string");
  }
  getChildrenCount() {
    return this._children.length;
  }
  getRenderable(id) {
    return this._children.find((child) => typeof child !== "string" && child.id === id);
  }
  getRenderableIndex(id) {
    return this._children.findIndex((child) => isTextNodeRenderable(child) && child.id === id);
  }
  get fg() {
    return this._fg;
  }
  set fg(fg) {
    if (!fg) {
      this._fg = undefined;
      this.requestRender();
      return;
    }
    this._fg = parseColor(fg);
    this.requestRender();
  }
  set bg(bg) {
    if (!bg) {
      this._bg = undefined;
      this.requestRender();
      return;
    }
    this._bg = parseColor(bg);
    this.requestRender();
  }
  get bg() {
    return this._bg;
  }
  set attributes(attributes) {
    this._attributes = attributes;
    this.requestRender();
  }
  get attributes() {
    return this._attributes;
  }
  set link(link) {
    this._link = link;
    this.requestRender();
  }
  get link() {
    return this._link;
  }
  findDescendantById(id) {
    return;
  }
}

class RootTextNodeRenderable extends TextNodeRenderable {
  ctx;
  textParent;
  constructor(ctx, options, textParent) {
    super(options);
    this.ctx = ctx;
    this.textParent = textParent;
  }
  requestRender() {
    this.markDirty();
    this.ctx.requestRender();
  }
}

// src/renderables/Text.ts
class TextRenderable extends TextBufferRenderable {
  _text;
  _hasManualStyledText = false;
  rootTextNode;
  _contentDefaultOptions = {
    content: ""
  };
  constructor(ctx, options) {
    super(ctx, options);
    const content = options.content ?? this._contentDefaultOptions.content;
    const styledText = typeof content === "string" ? stringToStyledText(content) : content;
    this._text = styledText;
    this._hasManualStyledText = options.content !== undefined && content !== "";
    this.rootTextNode = new RootTextNodeRenderable(ctx, {
      id: `${this.id}-root`,
      fg: this._defaultFg,
      bg: this._defaultBg,
      attributes: this._defaultAttributes
    }, this);
    this.updateTextBuffer(styledText);
  }
  updateTextBuffer(styledText) {
    this.textBuffer.setStyledText(styledText);
    this.clearChunks(styledText);
  }
  clearChunks(styledText) {}
  get content() {
    return this._text;
  }
  get chunks() {
    return this._text.chunks;
  }
  get textNode() {
    return this.rootTextNode;
  }
  set content(value) {
    this._hasManualStyledText = true;
    const styledText = typeof value === "string" ? stringToStyledText(value) : value;
    if (this._text !== styledText) {
      this._text = styledText;
      this.updateTextBuffer(styledText);
      this.updateTextInfo();
    }
  }
  updateTextFromNodes() {
    if (this.rootTextNode.isDirty && !this._hasManualStyledText) {
      const chunks = this.rootTextNode.gatherWithInheritedStyle({
        fg: this._defaultFg,
        bg: this._defaultBg,
        attributes: this._defaultAttributes,
        link: undefined
      });
      this.textBuffer.setStyledText(new StyledText(chunks));
      this.refreshLocalSelection();
      this.yogaNode.markDirty();
    }
  }
  add(obj, index) {
    return this.rootTextNode.add(obj, index);
  }
  remove(child) {
    this.rootTextNode.remove(child);
  }
  insertBefore(obj, anchor) {
    this.rootTextNode.insertBefore(obj, anchor);
    return this.rootTextNode.children.indexOf(obj);
  }
  getTextChildren() {
    return this.rootTextNode.getChildren();
  }
  clear() {
    this.rootTextNode.clear();
    const emptyStyledText = stringToStyledText("");
    this._text = emptyStyledText;
    this.updateTextBuffer(emptyStyledText);
    this.updateTextInfo();
    this.requestRender();
  }
  onLifecyclePass = () => {
    this.updateTextFromNodes();
  };
  onFgChanged(newColor) {
    this.rootTextNode.fg = newColor;
  }
  onBgChanged(newColor) {
    this.rootTextNode.bg = newColor;
  }
  onAttributesChanged(newAttributes) {
    this.rootTextNode.attributes = newAttributes;
  }
  destroy() {
    this.rootTextNode.children.length = 0;
    super.destroy();
  }
}

// src/NativeSpanFeed.ts
function toNumber(value) {
  return typeof value === "bigint" ? Number(value) : value;
}
var canThrowAcrossNativeCallback = typeof process !== "undefined" && typeof process.versions === "object" && process.versions !== null && typeof process.versions.bun === "string";

class NativeSpanFeed {
  static create(options) {
    const lib = resolveRenderLib();
    const streamPtr = lib.createNativeSpanFeed(options);
    const stream = new NativeSpanFeed(streamPtr);
    lib.registerNativeSpanFeedStream(streamPtr, stream.eventHandler);
    const status = lib.attachNativeSpanFeed(streamPtr);
    if (status !== 0) {
      lib.unregisterNativeSpanFeedStream(streamPtr);
      lib.destroyNativeSpanFeed(streamPtr);
      throw new Error(`Failed to attach stream: ${status}`);
    }
    return stream;
  }
  static attach(streamPtr, _options) {
    const lib = resolveRenderLib();
    const stream = new NativeSpanFeed(streamPtr);
    lib.registerNativeSpanFeedStream(streamPtr, stream.eventHandler);
    const status = lib.attachNativeSpanFeed(streamPtr);
    if (status !== 0) {
      lib.unregisterNativeSpanFeedStream(streamPtr);
      throw new Error(`Failed to attach stream: ${status}`);
    }
    return stream;
  }
  streamPtr;
  lib = resolveRenderLib();
  eventHandler;
  chunkMap = new Map;
  chunkSizes = new Map;
  dataHandlers = new Set;
  errorHandlers = new Set;
  drainBuffer = null;
  stateBuffer = null;
  closed = false;
  destroyed = false;
  draining = false;
  pendingDataAvailable = false;
  pendingClose = false;
  closing = false;
  pendingAsyncHandlers = 0;
  inCallback = false;
  closeQueued = false;
  idleResolvers = [];
  pendingHandlerError = null;
  pendingHandlerErrorQueued = false;
  constructor(streamPtr) {
    this.streamPtr = streamPtr;
    this.eventHandler = (eventId, arg0, arg1) => {
      this.handleEvent(eventId, arg0, arg1);
    };
    this.ensureDrainBuffer();
  }
  ensureDrainBuffer() {
    if (this.drainBuffer)
      return;
    const capacity = 256;
    this.drainBuffer = new Uint8Array(capacity * SpanInfoStruct.size);
  }
  onData(handler) {
    this.dataHandlers.add(handler);
    if (this.pendingDataAvailable) {
      this.pendingDataAvailable = false;
      this.drainAll();
    }
    return () => this.dataHandlers.delete(handler);
  }
  onError(handler) {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }
  hasPinnedChunks() {
    if (!this.stateBuffer)
      return false;
    for (const refcount of this.stateBuffer) {
      if (refcount > 0)
        return true;
    }
    return false;
  }
  isBackpressured() {
    return this.pendingAsyncHandlers > 0 || this.pendingDataAvailable || this.hasPinnedChunks();
  }
  close() {
    if (this.destroyed)
      return;
    if (this.inCallback || this.draining || this.pendingAsyncHandlers > 0) {
      this.pendingClose = true;
      if (!this.closeQueued) {
        this.closeQueued = true;
        queueMicrotask(() => {
          this.closeQueued = false;
          this.processPendingClose();
        });
      }
      return;
    }
    this.performClose();
  }
  processPendingClose() {
    if (!this.pendingClose || this.destroyed)
      return;
    if (this.inCallback || this.draining || this.pendingAsyncHandlers > 0)
      return;
    this.pendingClose = false;
    this.performClose();
    this.resolveIdleIfNeeded();
  }
  performClose() {
    if (this.closing)
      return;
    this.closing = true;
    if (!this.closed) {
      const status = this.lib.streamClose(this.streamPtr);
      if (status !== 0) {
        this.closing = false;
        return;
      }
      this.closed = true;
    }
    this.finalizeDestroy();
  }
  finalizeDestroy() {
    if (this.destroyed)
      return;
    this.lib.unregisterNativeSpanFeedStream(this.streamPtr);
    this.lib.destroyNativeSpanFeed(this.streamPtr);
    this.destroyed = true;
    this.chunkMap.clear();
    this.chunkSizes.clear();
    this.stateBuffer = null;
    this.drainBuffer = null;
    this.dataHandlers.clear();
    this.errorHandlers.clear();
    this.pendingDataAvailable = false;
    this.resolveIdleIfNeeded();
  }
  isIdle() {
    return !this.inCallback && !this.draining && this.pendingAsyncHandlers === 0 && !this.pendingDataAvailable && !this.hasPinnedChunks();
  }
  resolveIdleIfNeeded() {
    if (!this.isIdle())
      return;
    const resolvers = this.idleResolvers.splice(0);
    for (const resolve of resolvers) {
      resolve();
    }
  }
  idle() {
    if (this.isIdle())
      return Promise.resolve();
    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }
  handleEvent(eventId, arg0, arg1) {
    this.inCallback = true;
    try {
      switch (eventId) {
        case 8 /* StateBuffer */: {
          const len = toNumber(arg1);
          if (len > 0 && arg0) {
            const buffer = toArrayBuffer(arg0, 0, len);
            this.stateBuffer = new Uint8Array(buffer);
          }
          break;
        }
        case 7 /* DataAvailable */: {
          if (this.closing)
            break;
          if (this.dataHandlers.size === 0) {
            this.pendingDataAvailable = true;
            break;
          }
          this.drainAll();
          break;
        }
        case 2 /* ChunkAdded */: {
          const chunkLen = toNumber(arg1);
          if (chunkLen > 0 && arg0) {
            if (!this.chunkMap.has(arg0)) {
              const buffer = toArrayBuffer(arg0, 0, chunkLen);
              this.chunkMap.set(arg0, buffer);
            }
            this.chunkSizes.set(arg0, chunkLen);
          }
          break;
        }
        case 6 /* Error */: {
          const code = toNumber(arg0);
          for (const handler of this.errorHandlers)
            handler(code);
          break;
        }
        case 5 /* Closed */: {
          this.closed = true;
          break;
        }
        default:
          break;
      }
    } finally {
      this.inCallback = false;
      this.resolveIdleIfNeeded();
    }
  }
  decrementRefcount(chunkIndex) {
    if (this.stateBuffer && chunkIndex < this.stateBuffer.length) {
      const prev = this.stateBuffer[chunkIndex];
      this.stateBuffer[chunkIndex] = prev > 0 ? prev - 1 : 0;
    }
  }
  queuePendingHandlerError(error) {
    this.pendingHandlerError ??= error;
    if (this.pendingHandlerErrorQueued)
      return;
    this.pendingHandlerErrorQueued = true;
    queueMicrotask(() => {
      this.pendingHandlerErrorQueued = false;
      if (this.pendingHandlerError === null)
        return;
      const pendingError = this.pendingHandlerError;
      this.pendingHandlerError = null;
      throw pendingError;
    });
  }
  throwPendingHandlerError() {
    if (this.pendingHandlerError === null)
      return;
    const pendingError = this.pendingHandlerError;
    this.pendingHandlerError = null;
    throw pendingError;
  }
  drainOnce() {
    if (!this.drainBuffer || this.draining || this.pendingClose)
      return 0;
    const capacity = Math.floor(this.drainBuffer.byteLength / SpanInfoStruct.size);
    if (capacity === 0)
      return 0;
    const count = this.lib.streamDrainSpans(this.streamPtr, this.drainBuffer, capacity);
    if (count === 0)
      return 0;
    this.draining = true;
    const spans = SpanInfoStruct.unpackList(this.drainBuffer.buffer, count);
    let firstError = null;
    try {
      for (const span of spans) {
        if (span.len === 0)
          continue;
        let buffer = this.chunkMap.get(span.chunkPtr);
        if (!buffer) {
          const size = this.chunkSizes.get(span.chunkPtr);
          if (!size)
            continue;
          buffer = toArrayBuffer(span.chunkPtr, 0, size);
          this.chunkMap.set(span.chunkPtr, buffer);
        }
        if (span.offset + span.len > buffer.byteLength)
          continue;
        const slice = new Uint8Array(buffer, span.offset, span.len);
        let asyncResults = null;
        for (const handler of this.dataHandlers) {
          try {
            const result = handler(slice);
            if (result && typeof result.then === "function") {
              asyncResults ??= [];
              asyncResults.push(result);
            }
          } catch (e) {
            firstError ??= e;
          }
        }
        const shouldStopAfterThisSpan = this.pendingClose;
        if (asyncResults) {
          const chunkIndex = span.chunkIndex;
          this.pendingAsyncHandlers += 1;
          Promise.allSettled(asyncResults).then(() => {
            this.decrementRefcount(chunkIndex);
            this.pendingAsyncHandlers -= 1;
            this.processPendingClose();
            this.resolveIdleIfNeeded();
          });
        } else {
          this.decrementRefcount(span.chunkIndex);
        }
        if (shouldStopAfterThisSpan)
          break;
      }
    } finally {
      this.draining = false;
      this.resolveIdleIfNeeded();
    }
    if (firstError) {
      if (!this.inCallback || canThrowAcrossNativeCallback) {
        throw firstError;
      }
      this.queuePendingHandlerError(firstError);
    }
    return count;
  }
  drainAll() {
    let count = this.drainOnce();
    while (count > 0) {
      count = this.drainOnce();
    }
    if (!this.inCallback) {
      this.throwPendingHandlerError();
    }
  }
}

// src/console.ts
import { EventEmitter as EventEmitter4 } from "events";
import { Console } from "node:console";
import fs from "node:fs";
import path from "node:path";
import util2 from "node:util";

// src/lib/output.capture.ts
import { Writable } from "stream";
import { EventEmitter as EventEmitter3 } from "events";

class Capture extends EventEmitter3 {
  output = [];
  constructor() {
    super();
  }
  get size() {
    return this.output.length;
  }
  write(stream, data) {
    this.output.push({ stream, output: data });
    this.emit("write", stream, data);
  }
  claimOutput() {
    const output = this.output.map((o) => o.output).join("");
    this.clear();
    return output;
  }
  clear() {
    this.output = [];
  }
}

class CapturedWritableStream extends Writable {
  stream;
  capture;
  isTTY = true;
  columns = process.stdout.columns || 80;
  rows = process.stdout.rows || 24;
  constructor(stream, capture) {
    super();
    this.stream = stream;
    this.capture = capture;
  }
  _write(chunk, encoding, callback) {
    const data = chunk.toString();
    this.capture.write(this.stream, data);
    callback();
  }
  getColorDepth() {
    return process.stdout.getColorDepth?.() || 8;
  }
}

// src/lib/keybinding.internal.ts
var defaultKeyAliases = {
  enter: "return",
  esc: "escape",
  kp0: "0",
  kp1: "1",
  kp2: "2",
  kp3: "3",
  kp4: "4",
  kp5: "5",
  kp6: "6",
  kp7: "7",
  kp8: "8",
  kp9: "9",
  kpdecimal: ".",
  kpdivide: "/",
  kpmultiply: "*",
  kpminus: "-",
  kpplus: "+",
  kpenter: "enter",
  kpequal: "=",
  kpseparator: ",",
  kpleft: "left",
  kpright: "right",
  kpup: "up",
  kpdown: "down",
  kppageup: "pageup",
  kppagedown: "pagedown",
  kphome: "home",
  kpend: "end",
  kpinsert: "insert",
  kpdelete: "delete"
};
function mergeKeyAliases(defaults, custom) {
  return { ...defaults, ...custom };
}
function mergeKeyBindings(defaults, custom) {
  const map = new Map;
  for (const binding of defaults) {
    const key = getKeyBindingKey(binding);
    map.set(key, binding);
  }
  for (const binding of custom) {
    const key = getKeyBindingKey(binding);
    map.set(key, binding);
  }
  return Array.from(map.values());
}
function getKeyBindingKey(binding) {
  return `${binding.name}:${binding.ctrl ? 1 : 0}:${binding.shift ? 1 : 0}:${binding.meta ? 1 : 0}:${binding.super ? 1 : 0}`;
}
function getBaseCodeKeyName(baseCode) {
  if (baseCode === undefined || baseCode < 32 || baseCode === 127) {
    return;
  }
  try {
    const name = String.fromCodePoint(baseCode);
    if (name.length === 1 && name >= "A" && name <= "Z") {
      return name.toLowerCase();
    }
    return name;
  } catch {
    return;
  }
}
function getKeyBindingKeys(binding) {
  const names = new Set([binding.name]);
  const baseCodeName = getBaseCodeKeyName(binding.baseCode);
  if (baseCodeName) {
    names.add(baseCodeName);
  }
  return [...names].map((name) => getKeyBindingKey({ ...binding, name }));
}
function getKeyBindingAction(map, binding) {
  for (const key of getKeyBindingKeys(binding)) {
    const action = map.get(key);
    if (action !== undefined) {
      return action;
    }
  }
  return;
}
function matchesKeyBinding(binding, match) {
  const matchKey = getKeyBindingKey(match);
  return getKeyBindingKeys(binding).includes(matchKey);
}
function buildKeyBindingsMap(bindings, aliasMap) {
  const map = new Map;
  const aliases = aliasMap || {};
  for (const binding of bindings) {
    const key = getKeyBindingKey(binding);
    map.set(key, binding.action);
  }
  for (const binding of bindings) {
    const normalizedName = aliases[binding.name] || binding.name;
    if (normalizedName !== binding.name) {
      const aliasedKey = getKeyBindingKey({ ...binding, name: normalizedName });
      map.set(aliasedKey, binding.action);
    }
  }
  return map;
}
function keyBindingToString(binding) {
  const parts = [];
  if (binding.ctrl)
    parts.push("ctrl");
  if (binding.shift)
    parts.push("shift");
  if (binding.meta)
    parts.push("meta");
  if (binding.super)
    parts.push("super");
  parts.push(binding.name);
  return parts.join("+");
}

// src/console.ts
function getCallerInfo() {
  const err = new Error;
  const stackLines = err.stack?.split(`
`).slice(5) || [];
  if (!stackLines.length)
    return null;
  const callerLine = stackLines[0].trim();
  const regex = /at\s+(?:([\w$.<>]+)\s+\()?((?:\/|[A-Za-z]:\\)[^:]+):(\d+):(\d+)\)?/;
  const match = callerLine.match(regex);
  if (!match)
    return null;
  const functionName = match[1] || "<anonymous>";
  const fullPath = match[2];
  const fileName = fullPath.split(/[\\/]/).pop() || "<unknown>";
  const lineNumber = parseInt(match[3], 10) || 0;
  const columnNumber = parseInt(match[4], 10) || 0;
  return { functionName, fullPath, fileName, lineNumber, columnNumber };
}
var capture = singleton("ConsoleCapture", () => new Capture);
registerEnvVar({
  name: "OTUI_USE_CONSOLE",
  description: "Whether to use the console. Will not capture console output if set to false.",
  type: "boolean",
  default: true
});
registerEnvVar({
  name: "SHOW_CONSOLE",
  description: "Show the console at startup if set to true.",
  type: "boolean",
  default: false
});

class TerminalConsoleCache extends EventEmitter4 {
  _cachedLogs = [];
  MAX_CACHE_SIZE = 1000;
  _collectCallerInfo = false;
  _cachingEnabled = true;
  _originalConsole = null;
  get cachedLogs() {
    return this._cachedLogs;
  }
  constructor() {
    super();
  }
  activate() {
    if (!this._originalConsole) {
      this._originalConsole = global.console;
    }
    this.setupConsoleCapture();
    this.overrideConsoleMethods();
  }
  setupConsoleCapture() {
    if (!env.OTUI_USE_CONSOLE)
      return;
    const mockStdout = new CapturedWritableStream("stdout", capture);
    const mockStderr = new CapturedWritableStream("stderr", capture);
    global.console = new Console({
      stdout: mockStdout,
      stderr: mockStderr,
      colorMode: true,
      inspectOptions: {
        compact: false,
        breakLength: 80,
        depth: 2
      }
    });
  }
  overrideConsoleMethods() {
    console.log = (...args) => {
      this.appendToConsole("LOG" /* LOG */, ...args);
    };
    console.info = (...args) => {
      this.appendToConsole("INFO" /* INFO */, ...args);
    };
    console.warn = (...args) => {
      this.appendToConsole("WARN" /* WARN */, ...args);
    };
    console.error = (...args) => {
      this.appendToConsole("ERROR" /* ERROR */, ...args);
    };
    console.debug = (...args) => {
      this.appendToConsole("DEBUG" /* DEBUG */, ...args);
    };
    if (typeof console.timeStamp !== "function") {
      console.timeStamp = () => {};
    }
  }
  setCollectCallerInfo(enabled) {
    this._collectCallerInfo = enabled;
  }
  clearConsole() {
    this._cachedLogs = [];
  }
  setCachingEnabled(enabled) {
    this._cachingEnabled = enabled;
  }
  deactivate() {
    this.restoreOriginalConsole();
  }
  restoreOriginalConsole() {
    if (this._originalConsole) {
      global.console = this._originalConsole;
    }
  }
  addLogEntry(level, ...args) {
    const callerInfo = this._collectCallerInfo ? getCallerInfo() : null;
    const logEntry = [new Date, level, args, callerInfo];
    if (this._cachingEnabled) {
      if (this._cachedLogs.length >= this.MAX_CACHE_SIZE) {
        this._cachedLogs.shift();
      }
      this._cachedLogs.push(logEntry);
    }
    return logEntry;
  }
  appendToConsole(level, ...args) {
    if (this._cachedLogs.length >= this.MAX_CACHE_SIZE) {
      this._cachedLogs.shift();
    }
    const entry = this.addLogEntry(level, ...args);
    this.emit("entry", entry);
  }
  destroy() {
    this.deactivate();
  }
}
var terminalConsoleCache = singleton("TerminalConsoleCache", () => {
  const terminalConsoleCache2 = new TerminalConsoleCache;
  process.on("exit", () => {
    terminalConsoleCache2.destroy();
  });
  return terminalConsoleCache2;
});
var ConsolePosition;
((ConsolePosition2) => {
  ConsolePosition2["TOP"] = "top";
  ConsolePosition2["BOTTOM"] = "bottom";
  ConsolePosition2["LEFT"] = "left";
  ConsolePosition2["RIGHT"] = "right";
})(ConsolePosition ||= {});
var defaultConsoleKeybindings = [
  { name: "up", action: "scroll-up" },
  { name: "down", action: "scroll-down" },
  { name: "up", shift: true, action: "scroll-to-top" },
  { name: "down", shift: true, action: "scroll-to-bottom" },
  { name: "p", ctrl: true, action: "position-previous" },
  { name: "o", ctrl: true, action: "position-next" },
  { name: "+", action: "size-increase" },
  { name: "=", shift: true, action: "size-increase" },
  { name: "-", action: "size-decrease" },
  { name: "s", ctrl: true, action: "save-logs" },
  { name: "c", ctrl: true, shift: true, action: "copy-selection" }
];
var DEFAULT_CONSOLE_OPTIONS = {
  position: "bottom" /* BOTTOM */,
  sizePercent: 30,
  zIndex: Infinity,
  colorInfo: "#00FFFF",
  colorWarn: "#FFFF00",
  colorError: "#FF0000",
  colorDebug: "#808080",
  colorDefault: "#FFFFFF",
  backgroundColor: RGBA.fromValues(0.1, 0.1, 0.1, 0.7),
  startInDebugMode: false,
  title: "Console",
  titleBarColor: RGBA.fromValues(0.05, 0.05, 0.05, 0.7),
  titleBarTextColor: "#FFFFFF",
  cursorColor: "#00A0FF",
  maxStoredLogs: 2000,
  maxDisplayLines: 3000,
  onCopySelection: undefined,
  keyBindings: undefined,
  keyAliasMap: undefined,
  selectionColor: RGBA.fromValues(0.3, 0.5, 0.8, 0.5),
  copyButtonColor: "#00A0FF"
};
var INDENT_WIDTH = 2;

class TerminalConsole extends EventEmitter4 {
  isVisible = false;
  isFocused = false;
  renderer;
  keyHandler;
  options;
  _debugModeEnabled = false;
  frameBuffer = null;
  consoleX = 0;
  consoleY = 0;
  consoleWidth = 0;
  consoleHeight = 0;
  scrollTopIndex = 0;
  isScrolledToBottom = true;
  currentLineIndex = 0;
  _displayLines = [];
  _allLogEntries = [];
  _needsFrameBufferUpdate = false;
  _entryListener;
  _selectionStart = null;
  _selectionEnd = null;
  _isDragging = false;
  _copyButtonBounds = {
    x: 0,
    y: 0,
    width: 0,
    height: 0
  };
  _autoScrollInterval = null;
  clock;
  _keyBindingsMap;
  _keyAliasMap;
  _keyBindings;
  _mergedKeyBindings;
  _actionHandlers;
  markNeedsRerender() {
    this._needsFrameBufferUpdate = true;
    this.renderer.requestRender();
  }
  getCopyButtonLabel() {
    const copyBindings = this._mergedKeyBindings.filter((b) => b.action === "copy-selection");
    const copyBinding = copyBindings[copyBindings.length - 1];
    if (copyBinding) {
      const shortcut = keyBindingToString(copyBinding);
      return `[Copy (${shortcut})]`;
    }
    return "[Copy]";
  }
  _rgbaInfo;
  _rgbaWarn;
  _rgbaError;
  _rgbaDebug;
  _rgbaDefault;
  backgroundColor;
  _rgbaTitleBar;
  _rgbaTitleBarText;
  _title;
  _rgbaCursor;
  _rgbaSelection;
  _rgbaCopyButton;
  _positions = [
    "top" /* TOP */,
    "right" /* RIGHT */,
    "bottom" /* BOTTOM */,
    "left" /* LEFT */
  ];
  constructor(renderer, options = {}) {
    super();
    this.renderer = renderer;
    this.clock = options.clock ?? new SystemClock;
    this.options = { ...DEFAULT_CONSOLE_OPTIONS, ...options };
    this.keyHandler = this.handleKeyPress.bind(this);
    this._debugModeEnabled = this.options.startInDebugMode;
    terminalConsoleCache.setCollectCallerInfo(this._debugModeEnabled);
    this._rgbaInfo = parseColor(this.options.colorInfo);
    this._rgbaWarn = parseColor(this.options.colorWarn);
    this._rgbaError = parseColor(this.options.colorError);
    this._rgbaDebug = parseColor(this.options.colorDebug);
    this._rgbaDefault = parseColor(this.options.colorDefault);
    this.backgroundColor = parseColor(this.options.backgroundColor);
    this._rgbaTitleBar = parseColor(this.options.titleBarColor);
    this._rgbaTitleBarText = parseColor(this.options.titleBarTextColor || this.options.colorDefault);
    this._title = this.options.title;
    this._rgbaCursor = parseColor(this.options.cursorColor);
    this._rgbaSelection = parseColor(this.options.selectionColor);
    this._rgbaCopyButton = parseColor(this.options.copyButtonColor);
    this._keyAliasMap = mergeKeyAliases(defaultKeyAliases, options.keyAliasMap || {});
    this._keyBindings = options.keyBindings || [];
    this._mergedKeyBindings = mergeKeyBindings(defaultConsoleKeybindings, this._keyBindings);
    this._keyBindingsMap = buildKeyBindingsMap(this._mergedKeyBindings, this._keyAliasMap);
    this._actionHandlers = this.buildActionHandlers();
    this._updateConsoleDimensions();
    this._scrollToBottom(true);
    this._entryListener = (logEntry) => {
      this._handleNewLog(logEntry);
    };
    terminalConsoleCache.on("entry", this._entryListener);
    if (env.SHOW_CONSOLE) {
      this.show();
    }
  }
  buildActionHandlers() {
    return new Map([
      ["scroll-up", () => this.scrollUp()],
      ["scroll-down", () => this.scrollDown()],
      ["scroll-to-top", () => this.scrollToTop()],
      ["scroll-to-bottom", () => this.scrollToBottomAction()],
      ["position-previous", () => this.positionPrevious()],
      ["position-next", () => this.positionNext()],
      ["size-increase", () => this.sizeIncrease()],
      ["size-decrease", () => this.sizeDecrease()],
      ["save-logs", () => this.saveLogsAction()],
      ["copy-selection", () => this.triggerCopyAction()]
    ]);
  }
  activate() {
    terminalConsoleCache.activate();
  }
  deactivate() {
    terminalConsoleCache.deactivate();
  }
  _handleNewLog(logEntry) {
    if (!this.isVisible)
      return;
    this._allLogEntries.push(logEntry);
    if (this._allLogEntries.length > this.options.maxStoredLogs) {
      this._allLogEntries.splice(0, this._allLogEntries.length - this.options.maxStoredLogs);
    }
    const newDisplayLines = this._processLogEntry(logEntry);
    this._displayLines.push(...newDisplayLines);
    if (this._displayLines.length > this.options.maxDisplayLines) {
      this._displayLines.splice(0, this._displayLines.length - this.options.maxDisplayLines);
      const linesRemoved = this._displayLines.length - this.options.maxDisplayLines;
      this.scrollTopIndex = Math.max(0, this.scrollTopIndex - linesRemoved);
    }
    if (this.isScrolledToBottom) {
      this._scrollToBottom();
    }
    this.markNeedsRerender();
  }
  _updateConsoleDimensions(termWidth, termHeight) {
    const width = termWidth ?? this.renderer.width;
    const height = termHeight ?? this.renderer.height;
    const sizePercent = this.options.sizePercent / 100;
    switch (this.options.position) {
      case "top" /* TOP */:
        this.consoleX = 0;
        this.consoleY = 0;
        this.consoleWidth = width;
        this.consoleHeight = Math.max(1, Math.floor(height * sizePercent));
        break;
      case "bottom" /* BOTTOM */:
        this.consoleHeight = Math.max(1, Math.floor(height * sizePercent));
        this.consoleWidth = width;
        this.consoleX = 0;
        this.consoleY = height - this.consoleHeight;
        break;
      case "left" /* LEFT */:
        this.consoleWidth = Math.max(1, Math.floor(width * sizePercent));
        this.consoleHeight = height;
        this.consoleX = 0;
        this.consoleY = 0;
        break;
      case "right" /* RIGHT */:
        this.consoleWidth = Math.max(1, Math.floor(width * sizePercent));
        this.consoleHeight = height;
        this.consoleY = 0;
        this.consoleX = width - this.consoleWidth;
        break;
    }
    this.currentLineIndex = Math.max(0, Math.min(this.currentLineIndex, this.consoleHeight - 1));
  }
  handleKeyPress(event) {
    if (event.name === "escape") {
      this.blur();
      return;
    }
    const action = getKeyBindingAction(this._keyBindingsMap, event);
    if (action) {
      const handler = this._actionHandlers.get(action);
      if (handler) {
        handler();
        return;
      }
    }
  }
  scrollUp() {
    const logAreaHeight = Math.max(1, this.consoleHeight - 1);
    if (this.currentLineIndex > 0) {
      this.currentLineIndex--;
      this.markNeedsRerender();
    } else if (this.scrollTopIndex > 0) {
      this.scrollTopIndex--;
      this.isScrolledToBottom = false;
      this.markNeedsRerender();
    }
    return true;
  }
  scrollDown() {
    const displayLineCount = this._displayLines.length;
    const logAreaHeight = Math.max(1, this.consoleHeight - 1);
    const maxScrollTop = Math.max(0, displayLineCount - logAreaHeight);
    const canCursorMoveDown = this.currentLineIndex < logAreaHeight - 1 && this.scrollTopIndex + this.currentLineIndex < displayLineCount - 1;
    if (canCursorMoveDown) {
      this.currentLineIndex++;
      this.markNeedsRerender();
    } else if (this.scrollTopIndex < maxScrollTop) {
      this.scrollTopIndex++;
      this.isScrolledToBottom = this.scrollTopIndex === maxScrollTop;
      this.markNeedsRerender();
    }
    return true;
  }
  scrollToTop() {
    if (this.scrollTopIndex > 0 || this.currentLineIndex > 0) {
      this.scrollTopIndex = 0;
      this.currentLineIndex = 0;
      this.isScrolledToBottom = this._displayLines.length <= Math.max(1, this.consoleHeight - 1);
      this.markNeedsRerender();
    }
    return true;
  }
  scrollToBottomAction() {
    const logAreaHeightForScroll = Math.max(1, this.consoleHeight - 1);
    const maxScrollPossible = Math.max(0, this._displayLines.length - logAreaHeightForScroll);
    if (this.scrollTopIndex < maxScrollPossible || !this.isScrolledToBottom) {
      this._scrollToBottom(true);
      this.markNeedsRerender();
    }
    return true;
  }
  positionPrevious() {
    const currentPositionIndex = this._positions.indexOf(this.options.position);
    const prevIndex = (currentPositionIndex - 1 + this._positions.length) % this._positions.length;
    this.options.position = this._positions[prevIndex];
    this.resize(this.renderer.width, this.renderer.height);
    return true;
  }
  positionNext() {
    const currentPositionIndex = this._positions.indexOf(this.options.position);
    const nextIndex = (currentPositionIndex + 1) % this._positions.length;
    this.options.position = this._positions[nextIndex];
    this.resize(this.renderer.width, this.renderer.height);
    return true;
  }
  sizeIncrease() {
    this.options.sizePercent = Math.min(100, this.options.sizePercent + 5);
    this.resize(this.renderer.width, this.renderer.height);
    return true;
  }
  sizeDecrease() {
    this.options.sizePercent = Math.max(10, this.options.sizePercent - 5);
    this.resize(this.renderer.width, this.renderer.height);
    return true;
  }
  saveLogsAction() {
    this.saveLogsToFile();
    return true;
  }
  triggerCopyAction() {
    this.triggerCopy();
    return true;
  }
  attachStdin() {
    if (this.isFocused)
      return;
    this.renderer.keyInput.on("keypress", this.keyHandler);
    this.isFocused = true;
  }
  detachStdin() {
    if (!this.isFocused)
      return;
    this.renderer.keyInput.off("keypress", this.keyHandler);
    this.isFocused = false;
  }
  formatTimestamp(date) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(date);
  }
  formatArguments(args) {
    return args.map((arg) => {
      if (arg instanceof Error) {
        const errorProps = arg;
        return `Error: ${errorProps.message}
` + (errorProps.stack ? `${errorProps.stack}
` : "");
      }
      if (typeof arg === "object" && arg !== null) {
        try {
          return util2.inspect(arg, { depth: 2 });
        } catch (e) {
          return String(arg);
        }
      }
      try {
        return util2.inspect(arg, { depth: 2 });
      } catch (e) {
        return String(arg);
      }
    }).join(" ");
  }
  resize(width, height) {
    this._updateConsoleDimensions(width, height);
    if (this.frameBuffer) {
      this.frameBuffer.resize(this.consoleWidth, this.consoleHeight);
      const displayLineCount = this._displayLines.length;
      const logAreaHeight = Math.max(1, this.consoleHeight - 1);
      const maxScrollTop = Math.max(0, displayLineCount - logAreaHeight);
      this.scrollTopIndex = Math.min(this.scrollTopIndex, maxScrollTop);
      this.isScrolledToBottom = this.scrollTopIndex === maxScrollTop;
      const visibleLineCount = Math.min(logAreaHeight, displayLineCount - this.scrollTopIndex);
      this.currentLineIndex = Math.max(0, Math.min(this.currentLineIndex, visibleLineCount - 1));
      if (this.isVisible) {
        this.markNeedsRerender();
      }
    }
  }
  clear() {
    terminalConsoleCache.clearConsole();
    this._allLogEntries = [];
    this._displayLines = [];
    this.markNeedsRerender();
  }
  toggle() {
    if (this.isVisible) {
      if (this.isFocused) {
        this.hide();
      } else {
        this.focus();
      }
    } else {
      this.show();
    }
    if (!this.renderer.isRunning) {
      this.renderer.requestRender();
    }
  }
  focus() {
    this.attachStdin();
    this._scrollToBottom(true);
    this.markNeedsRerender();
  }
  blur() {
    this.detachStdin();
    this.markNeedsRerender();
  }
  show() {
    if (!this.isVisible) {
      this.isVisible = true;
      this._processCachedLogs();
      terminalConsoleCache.setCachingEnabled(false);
      if (!this.frameBuffer) {
        this.frameBuffer = OptimizedBuffer.create(this.consoleWidth, this.consoleHeight, this.renderer.widthMethod, {
          respectAlpha: this.backgroundColor.a < 1,
          id: "console framebuffer"
        });
      }
      const logCount = terminalConsoleCache.cachedLogs.length;
      const visibleLogLines = Math.min(this.consoleHeight, logCount);
      this.currentLineIndex = Math.max(0, visibleLogLines - 1);
      this.scrollTopIndex = 0;
      this._scrollToBottom(true);
      this.focus();
      this.markNeedsRerender();
    }
  }
  hide() {
    if (this.isVisible) {
      this.stopAutoScroll();
      this.isVisible = false;
      this.blur();
      terminalConsoleCache.setCachingEnabled(true);
    }
  }
  destroy() {
    this.stopAutoScroll();
    this.hide();
    this.deactivate();
    terminalConsoleCache.off("entry", this._entryListener);
  }
  getCachedLogs() {
    return terminalConsoleCache.cachedLogs.map((logEntry) => logEntry[0].toISOString() + " " + logEntry.slice(1).join(" ")).join(`
`);
  }
  updateFrameBuffer() {
    if (!this.frameBuffer)
      return;
    this.frameBuffer.clear(this.backgroundColor);
    const displayLines = this._displayLines;
    const displayLineCount = displayLines.length;
    const logAreaHeight = Math.max(1, this.consoleHeight - 1);
    this.frameBuffer.fillRect(0, 0, this.consoleWidth, 1, this._rgbaTitleBar);
    const dynamicTitle = `${this._title}${this.isFocused ? " (Focused)" : ""}`;
    const titleX = Math.max(0, Math.floor((this.consoleWidth - dynamicTitle.length) / 2));
    this.frameBuffer.drawText(dynamicTitle, titleX, 0, this._rgbaTitleBarText, this._rgbaTitleBar);
    const copyLabel = this.getCopyButtonLabel();
    const copyButtonX = this.consoleWidth - copyLabel.length - 1;
    if (copyButtonX >= 0) {
      const copyButtonEnabled = this.hasSelection();
      const disabledColor = RGBA.fromInts(100, 100, 100, 255);
      const copyColor = copyButtonEnabled ? this._rgbaCopyButton : disabledColor;
      this.frameBuffer.drawText(copyLabel, copyButtonX, 0, copyColor, this._rgbaTitleBar);
      this._copyButtonBounds = { x: copyButtonX, y: 0, width: copyLabel.length, height: 1 };
    } else {
      this._copyButtonBounds = { x: -1, y: -1, width: 0, height: 0 };
    }
    const startIndex = this.scrollTopIndex;
    const endIndex = Math.min(startIndex + logAreaHeight, displayLineCount);
    const visibleDisplayLines = displayLines.slice(startIndex, endIndex);
    let lineY = 1;
    for (let i = 0;i < visibleDisplayLines.length; i++) {
      if (lineY >= this.consoleHeight)
        break;
      const displayLine = visibleDisplayLines[i];
      const absoluteLineIndex = startIndex + i;
      let levelColor = this._rgbaDefault;
      switch (displayLine.level) {
        case "INFO" /* INFO */:
          levelColor = this._rgbaInfo;
          break;
        case "WARN" /* WARN */:
          levelColor = this._rgbaWarn;
          break;
        case "ERROR" /* ERROR */:
          levelColor = this._rgbaError;
          break;
        case "DEBUG" /* DEBUG */:
          levelColor = this._rgbaDebug;
          break;
      }
      const linePrefix = displayLine.indent ? " ".repeat(INDENT_WIDTH) : "";
      const textToDraw = displayLine.text;
      const textAvailableWidth = this.consoleWidth - 1 - (displayLine.indent ? INDENT_WIDTH : 0);
      const showCursor = this.isFocused && lineY - 1 === this.currentLineIndex;
      if (showCursor) {
        this.frameBuffer.drawText(">", 0, lineY, this._rgbaCursor, this.backgroundColor);
      } else {
        this.frameBuffer.drawText(" ", 0, lineY, this._rgbaDefault, this.backgroundColor);
      }
      const fullText = `${linePrefix}${textToDraw.substring(0, textAvailableWidth)}`;
      const selectionRange = this.getLineSelectionRange(absoluteLineIndex);
      if (selectionRange) {
        const adjustedStart = Math.max(0, selectionRange.start);
        const adjustedEnd = Math.min(fullText.length, selectionRange.end);
        if (adjustedStart > 0) {
          this.frameBuffer.drawText(fullText.substring(0, adjustedStart), 1, lineY, levelColor);
        }
        if (adjustedStart < adjustedEnd) {
          this.frameBuffer.fillRect(1 + adjustedStart, lineY, adjustedEnd - adjustedStart, 1, this._rgbaSelection);
          this.frameBuffer.drawText(fullText.substring(adjustedStart, adjustedEnd), 1 + adjustedStart, lineY, levelColor, this._rgbaSelection);
        }
        if (adjustedEnd < fullText.length) {
          this.frameBuffer.drawText(fullText.substring(adjustedEnd), 1 + adjustedEnd, lineY, levelColor);
        }
      } else {
        this.frameBuffer.drawText(fullText, 1, lineY, levelColor);
      }
      lineY++;
    }
  }
  renderToBuffer(buffer) {
    if (!this.isVisible || !this.frameBuffer)
      return;
    if (this._needsFrameBufferUpdate) {
      this.updateFrameBuffer();
      this._needsFrameBufferUpdate = false;
    }
    buffer.drawFrameBuffer(this.consoleX, this.consoleY, this.frameBuffer);
  }
  setDebugMode(enabled) {
    this._debugModeEnabled = enabled;
    terminalConsoleCache.setCollectCallerInfo(enabled);
    if (this.isVisible) {
      this.markNeedsRerender();
    }
  }
  toggleDebugMode() {
    this.setDebugMode(!this._debugModeEnabled);
  }
  set keyBindings(bindings) {
    this._keyBindings = bindings;
    this._mergedKeyBindings = mergeKeyBindings(defaultConsoleKeybindings, bindings);
    this._keyBindingsMap = buildKeyBindingsMap(this._mergedKeyBindings, this._keyAliasMap);
    this.markNeedsRerender();
  }
  set keyAliasMap(aliases) {
    this._keyAliasMap = mergeKeyAliases(defaultKeyAliases, aliases);
    this._mergedKeyBindings = mergeKeyBindings(defaultConsoleKeybindings, this._keyBindings);
    this._keyBindingsMap = buildKeyBindingsMap(this._mergedKeyBindings, this._keyAliasMap);
    this.markNeedsRerender();
  }
  set onCopySelection(callback) {
    this.options.onCopySelection = callback;
  }
  get onCopySelection() {
    return this.options.onCopySelection;
  }
  _scrollToBottom(forceCursorToLastLine = false) {
    const displayLineCount = this._displayLines.length;
    const logAreaHeight = Math.max(1, this.consoleHeight - 1);
    const maxScrollTop = Math.max(0, displayLineCount - logAreaHeight);
    this.scrollTopIndex = maxScrollTop;
    this.isScrolledToBottom = true;
    const visibleLineCount = Math.min(logAreaHeight, displayLineCount - this.scrollTopIndex);
    if (forceCursorToLastLine || this.currentLineIndex >= visibleLineCount) {
      this.currentLineIndex = Math.max(0, visibleLineCount - 1);
    }
  }
  _processLogEntry(logEntry) {
    const [date, level, args, callerInfo] = logEntry;
    const displayLines = [];
    const timestamp = this.formatTimestamp(date);
    const callerSource = callerInfo ? `${callerInfo.fileName}:${callerInfo.lineNumber}` : "unknown";
    const prefix = `[${timestamp}] [${level}]` + (this._debugModeEnabled ? ` [${callerSource}]` : "") + " ";
    const formattedArgs = this.formatArguments(args);
    const initialLines = formattedArgs.split(`
`);
    for (let i = 0;i < initialLines.length; i++) {
      const lineText = initialLines[i];
      const isFirstLineOfEntry = i === 0;
      const availableWidth = this.consoleWidth - 1 - (isFirstLineOfEntry ? 0 : INDENT_WIDTH);
      const linePrefix = isFirstLineOfEntry ? prefix : " ".repeat(INDENT_WIDTH);
      const textToWrap = isFirstLineOfEntry ? linePrefix + lineText : lineText;
      let currentPos = 0;
      while (currentPos < textToWrap.length || isFirstLineOfEntry && currentPos === 0 && textToWrap.length === 0) {
        const segment = textToWrap.substring(currentPos, currentPos + availableWidth);
        const isFirstSegmentOfLine = currentPos === 0;
        displayLines.push({
          text: isFirstSegmentOfLine && !isFirstLineOfEntry ? linePrefix + segment : segment,
          level,
          indent: !isFirstLineOfEntry || !isFirstSegmentOfLine
        });
        currentPos += availableWidth;
        if (isFirstLineOfEntry && currentPos === 0 && textToWrap.length === 0)
          break;
      }
    }
    return displayLines;
  }
  _processCachedLogs() {
    const logsToProcess = [...terminalConsoleCache.cachedLogs];
    terminalConsoleCache.clearConsole();
    this._allLogEntries.push(...logsToProcess);
    if (this._allLogEntries.length > this.options.maxStoredLogs) {
      this._allLogEntries.splice(0, this._allLogEntries.length - this.options.maxStoredLogs);
    }
    for (const logEntry of logsToProcess) {
      const processed = this._processLogEntry(logEntry);
      this._displayLines.push(...processed);
    }
    if (this._displayLines.length > this.options.maxDisplayLines) {
      this._displayLines.splice(0, this._displayLines.length - this.options.maxDisplayLines);
    }
  }
  hasSelection() {
    if (this._selectionStart === null || this._selectionEnd === null)
      return false;
    return this._selectionStart.line !== this._selectionEnd.line || this._selectionStart.col !== this._selectionEnd.col;
  }
  normalizeSelection() {
    if (!this._selectionStart || !this._selectionEnd)
      return null;
    const start = this._selectionStart;
    const end = this._selectionEnd;
    const startBeforeEnd = start.line < end.line || start.line === end.line && start.col <= end.col;
    if (startBeforeEnd) {
      return {
        startLine: start.line,
        startCol: start.col,
        endLine: end.line,
        endCol: end.col
      };
    } else {
      return {
        startLine: end.line,
        startCol: end.col,
        endLine: start.line,
        endCol: start.col
      };
    }
  }
  getSelectedText() {
    const selection = this.normalizeSelection();
    if (!selection)
      return "";
    const lines = [];
    for (let i = selection.startLine;i <= selection.endLine; i++) {
      if (i < 0 || i >= this._displayLines.length)
        continue;
      const line = this._displayLines[i];
      const linePrefix = line.indent ? " ".repeat(INDENT_WIDTH) : "";
      const textAvailableWidth = this.consoleWidth - 1 - (line.indent ? INDENT_WIDTH : 0);
      const fullText = linePrefix + line.text.substring(0, textAvailableWidth);
      let text = fullText;
      if (i === selection.startLine && i === selection.endLine) {
        text = fullText.substring(selection.startCol, selection.endCol);
      } else if (i === selection.startLine) {
        text = fullText.substring(selection.startCol);
      } else if (i === selection.endLine) {
        text = fullText.substring(0, selection.endCol);
      }
      lines.push(text);
    }
    return lines.join(`
`);
  }
  clearSelection() {
    this._selectionStart = null;
    this._selectionEnd = null;
    this._isDragging = false;
    this.stopAutoScroll();
  }
  stopAutoScroll() {
    if (this._autoScrollInterval !== null) {
      this.clock.clearInterval(this._autoScrollInterval);
      this._autoScrollInterval = null;
    }
  }
  startAutoScroll(direction) {
    this.stopAutoScroll();
    this._autoScrollInterval = this.clock.setInterval(() => {
      if (direction === "up") {
        if (this.scrollTopIndex > 0) {
          this.scrollTopIndex--;
          this.isScrolledToBottom = false;
          if (this._selectionEnd) {
            this._selectionEnd = {
              line: this.scrollTopIndex,
              col: this._selectionEnd.col
            };
          }
          this.markNeedsRerender();
        } else {
          this.stopAutoScroll();
        }
      } else {
        const displayLineCount = this._displayLines.length;
        const logAreaHeight = Math.max(1, this.consoleHeight - 1);
        const maxScrollTop = Math.max(0, displayLineCount - logAreaHeight);
        if (this.scrollTopIndex < maxScrollTop) {
          this.scrollTopIndex++;
          this.isScrolledToBottom = this.scrollTopIndex === maxScrollTop;
          if (this._selectionEnd) {
            const maxLine = this.scrollTopIndex + logAreaHeight - 1;
            this._selectionEnd = {
              line: Math.min(maxLine, displayLineCount - 1),
              col: this._selectionEnd.col
            };
          }
          this.markNeedsRerender();
        } else {
          this.stopAutoScroll();
        }
      }
    }, 50);
  }
  triggerCopy() {
    if (!this.hasSelection())
      return;
    const text = this.getSelectedText();
    if (text && this.options.onCopySelection) {
      try {
        this.options.onCopySelection(text);
      } catch {}
      this.clearSelection();
      this.markNeedsRerender();
    }
  }
  getLineSelectionRange(lineIndex) {
    const selection = this.normalizeSelection();
    if (!selection)
      return null;
    if (lineIndex < selection.startLine || lineIndex > selection.endLine) {
      return null;
    }
    const line = this._displayLines[lineIndex];
    if (!line)
      return null;
    const linePrefix = line.indent ? " ".repeat(INDENT_WIDTH) : "";
    const textAvailableWidth = this.consoleWidth - 1 - (line.indent ? INDENT_WIDTH : 0);
    const fullTextLength = linePrefix.length + Math.min(line.text.length, textAvailableWidth);
    let start = 0;
    let end = fullTextLength;
    if (lineIndex === selection.startLine) {
      start = Math.max(0, selection.startCol);
    }
    if (lineIndex === selection.endLine) {
      end = Math.min(fullTextLength, selection.endCol);
    }
    if (start >= end)
      return null;
    return { start, end };
  }
  handleMouse(event) {
    if (!this.isVisible)
      return false;
    const localX = event.x - this.consoleX;
    const localY = event.y - this.consoleY;
    if (localX < 0 || localX >= this.consoleWidth || localY < 0 || localY >= this.consoleHeight) {
      return false;
    }
    if (event.type === "scroll" && event.scroll) {
      if (event.scroll.direction === "up") {
        this.scrollUp();
      } else if (event.scroll.direction === "down") {
        this.scrollDown();
      }
      return true;
    }
    if (localY === 0) {
      if (event.type === "down" && event.button === 0 && localX >= this._copyButtonBounds.x && localX < this._copyButtonBounds.x + this._copyButtonBounds.width) {
        this.triggerCopy();
        return true;
      }
      return true;
    }
    const lineIndex = this.scrollTopIndex + (localY - 1);
    const colIndex = Math.max(0, localX - 1);
    if (event.type === "down" && event.button === 0) {
      this.clearSelection();
      this._selectionStart = { line: lineIndex, col: colIndex };
      this._selectionEnd = { line: lineIndex, col: colIndex };
      this._isDragging = true;
      this.markNeedsRerender();
      return true;
    }
    if (event.type === "drag" && this._isDragging) {
      this._selectionEnd = { line: lineIndex, col: colIndex };
      const logAreaHeight = Math.max(1, this.consoleHeight - 1);
      const relativeY = localY - 1;
      if (relativeY <= 0) {
        this.startAutoScroll("up");
      } else if (relativeY >= logAreaHeight - 1) {
        this.startAutoScroll("down");
      } else {
        this.stopAutoScroll();
      }
      this.markNeedsRerender();
      return true;
    }
    if (event.type === "up") {
      if (this._isDragging) {
        this._selectionEnd = { line: lineIndex, col: colIndex };
        this._isDragging = false;
        this.stopAutoScroll();
        this.markNeedsRerender();
      }
      return true;
    }
    return true;
  }
  get visible() {
    return this.isVisible;
  }
  get bounds() {
    return {
      x: this.consoleX,
      y: this.consoleY,
      width: this.consoleWidth,
      height: this.consoleHeight
    };
  }
  saveLogsToFile() {
    try {
      const timestamp = Date.now();
      const filename = `_console_${timestamp}.log`;
      const filepath = path.join(process.cwd(), filename);
      const allLogEntries = [...this._allLogEntries, ...terminalConsoleCache.cachedLogs];
      const logLines = [];
      for (const [date, level, args, callerInfo] of allLogEntries) {
        const timestampStr = this.formatTimestamp(date);
        const callerSource = callerInfo ? `${callerInfo.fileName}:${callerInfo.lineNumber}` : "unknown";
        const prefix = `[${timestampStr}] [${level}]` + (this._debugModeEnabled ? ` [${callerSource}]` : "") + " ";
        const formattedArgs = this.formatArguments(args);
        logLines.push(prefix + formattedArgs);
      }
      const content = logLines.join(`
`);
      fs.writeFileSync(filepath, content, "utf8");
      console.info(`Console logs saved to: ${filename}`);
    } catch (error) {
      console.error(`Failed to save console logs:`, error);
    }
  }
}

// src/renderables/EditBufferRenderable.ts
var BrandedEditBufferRenderable = Symbol.for("@opentui/core/EditBufferRenderable");
var EditBufferRenderableEvents;
((EditBufferRenderableEvents2) => {
  EditBufferRenderableEvents2["TRAITS_CHANGED"] = "traits-changed";
})(EditBufferRenderableEvents ||= {});
function sameCapture(a, b) {
  if (a === b)
    return true;
  if (!a || !b)
    return !a && !b;
  if (a.length !== b.length)
    return false;
  return a.every((item, i) => item === b[i]);
}
function sameTraits(a, b) {
  return a.suspend === b.suspend && a.status === b.status && sameCapture(a.capture, b.capture);
}
function isEditBufferRenderable(obj) {
  return !!(obj && typeof obj === "object" && (BrandedEditBufferRenderable in obj));
}

class EditBufferRenderable extends Renderable {
  [BrandedEditBufferRenderable] = true;
  _focusable = true;
  selectable = true;
  _traits = {};
  _textColor;
  _backgroundColor;
  _defaultAttributes;
  _selectionBg;
  _selectionFg;
  _wrapMode = "word";
  _scrollMargin = 0.2;
  _showCursor = true;
  _cursorColor;
  _cursorStyle;
  lastLocalSelection = null;
  _tabIndicator;
  _tabIndicatorColor;
  _cursorChangeListener = undefined;
  _contentChangeListener = undefined;
  _autoScrollVelocity = 0;
  _autoScrollAccumulator = 0;
  _scrollSpeed = 16;
  _keyboardSelectionActive = false;
  editBuffer;
  editorView;
  nativeRenderable = null;
  _defaultOptions = {
    textColor: RGBA.fromValues(1, 1, 1, 1),
    backgroundColor: "transparent",
    selectionBg: undefined,
    selectionFg: undefined,
    selectable: true,
    attributes: 0,
    wrapMode: "word",
    scrollMargin: 0.2,
    scrollSpeed: 16,
    showCursor: true,
    cursorColor: RGBA.fromValues(1, 1, 1, 1),
    cursorStyle: {
      style: "block",
      blinking: true
    },
    tabIndicator: undefined,
    tabIndicatorColor: undefined
  };
  constructor(ctx, options) {
    super(ctx, options);
    this._textColor = parseColor(options.textColor ?? this._defaultOptions.textColor);
    this._backgroundColor = parseColor(options.backgroundColor ?? this._defaultOptions.backgroundColor);
    this._defaultAttributes = options.attributes ?? this._defaultOptions.attributes;
    this._selectionBg = options.selectionBg ? parseColor(options.selectionBg) : this._defaultOptions.selectionBg;
    this._selectionFg = options.selectionFg ? parseColor(options.selectionFg) : this._defaultOptions.selectionFg;
    this.selectable = options.selectable ?? this._defaultOptions.selectable;
    this._wrapMode = options.wrapMode ?? this._defaultOptions.wrapMode;
    this._scrollMargin = options.scrollMargin ?? this._defaultOptions.scrollMargin;
    this._scrollSpeed = options.scrollSpeed ?? this._defaultOptions.scrollSpeed;
    this._showCursor = options.showCursor ?? this._defaultOptions.showCursor;
    this._cursorColor = parseColor(options.cursorColor ?? this._defaultOptions.cursorColor);
    this._cursorStyle = options.cursorStyle ?? this._defaultOptions.cursorStyle;
    this._tabIndicator = options.tabIndicator ?? this._defaultOptions.tabIndicator;
    this._tabIndicatorColor = options.tabIndicatorColor ? parseColor(options.tabIndicatorColor) : this._defaultOptions.tabIndicatorColor;
    this.editBuffer = EditBuffer.create(this._ctx.widthMethod);
    this.editorView = EditorView.create(this.editBuffer, this.width || 80, this.height || 24);
    this.editorView.setWrapMode(this._wrapMode);
    this.editorView.setScrollMargin(this._scrollMargin);
    this.editBuffer.setDefaultFg(this._textColor);
    this.editBuffer.setDefaultBg(this._backgroundColor);
    this.editBuffer.setDefaultAttributes(this._defaultAttributes);
    if (options.syntaxStyle) {
      this.editBuffer.setSyntaxStyle(options.syntaxStyle);
    }
    if (this._tabIndicator !== undefined) {
      this.editorView.setTabIndicator(this._tabIndicator);
    }
    if (this._tabIndicatorColor !== undefined) {
      this.editorView.setTabIndicatorColor(this._tabIndicatorColor);
    }
    this.setupNativeRenderable();
    this.setupEventListeners(options);
  }
  get lineInfo() {
    return this.editorView.getLogicalLineInfo();
  }
  setupEventListeners(options) {
    this._cursorChangeListener = options.onCursorChange;
    this._contentChangeListener = options.onContentChange;
    this.editBuffer.on("cursor-changed", () => {
      if (this._cursorChangeListener) {
        const cursor = this.editBuffer.getCursorPosition();
        this._cursorChangeListener({
          line: cursor.row,
          visualColumn: cursor.col
        });
      }
    });
    this.editBuffer.on("content-changed", () => {
      this.yogaNode.markDirty();
      this.requestRender();
      this.emit("line-info-change");
      if (this._contentChangeListener) {
        this._contentChangeListener({});
      }
    });
  }
  get lineCount() {
    return this.editBuffer.getLineCount();
  }
  get virtualLineCount() {
    return this.editorView.getVirtualLineCount();
  }
  get scrollY() {
    return this.editorView.getViewport().offsetY;
  }
  get plainText() {
    return this.editBuffer.getText();
  }
  get logicalCursor() {
    return this.editBuffer.getCursorPosition();
  }
  get visualCursor() {
    return this.editorView.getVisualCursor();
  }
  get cursorOffset() {
    return this.editorView.getVisualCursor().offset;
  }
  set cursorOffset(offset) {
    this.editorView.setCursorByOffset(offset);
    this.requestRender();
  }
  get cursorCharacterOffset() {
    const len = this.plainText.length;
    if (len <= 0)
      return;
    const cursor = this.logicalCursor;
    const offset = this.cursorOffset;
    if (offset >= len) {
      if (cursor.col > 0)
        return len - 1;
      return 0;
    }
    if (this.plainText[offset] === `
` && cursor.col > 0) {
      return offset - 1;
    }
    return offset;
  }
  get textColor() {
    return this._textColor;
  }
  set textColor(value) {
    const newColor = parseColor(value ?? this._defaultOptions.textColor);
    if (this._textColor !== newColor) {
      this._textColor = newColor;
      this.editBuffer.setDefaultFg(newColor);
      this.requestRender();
    }
  }
  get selectionBg() {
    return this._selectionBg;
  }
  get traits() {
    return this._traits;
  }
  set traits(value) {
    if (sameTraits(this._traits, value))
      return;
    const prev = this._traits;
    this._traits = value;
    this.emit("traits-changed" /* TRAITS_CHANGED */, value, prev);
  }
  set selectionBg(value) {
    const newColor = value ? parseColor(value) : this._defaultOptions.selectionBg;
    if (this._selectionBg !== newColor) {
      this._selectionBg = newColor;
      this.refreshSelectionStyle();
      this.requestRender();
    }
  }
  get selectionFg() {
    return this._selectionFg;
  }
  set selectionFg(value) {
    const newColor = value ? parseColor(value) : this._defaultOptions.selectionFg;
    if (this._selectionFg !== newColor) {
      this._selectionFg = newColor;
      this.refreshSelectionStyle();
      this.requestRender();
    }
  }
  get backgroundColor() {
    return this._backgroundColor;
  }
  set backgroundColor(value) {
    const newColor = parseColor(value ?? this._defaultOptions.backgroundColor);
    if (this._backgroundColor !== newColor) {
      this._backgroundColor = newColor;
      this.editBuffer.setDefaultBg(newColor);
      this.requestRender();
    }
  }
  get attributes() {
    return this._defaultAttributes;
  }
  set attributes(value) {
    if (this._defaultAttributes !== value) {
      this._defaultAttributes = value;
      this.editBuffer.setDefaultAttributes(value);
      this.requestRender();
    }
  }
  get wrapMode() {
    return this._wrapMode;
  }
  set wrapMode(value) {
    if (this._wrapMode !== value) {
      this._wrapMode = value;
      this.editorView.setWrapMode(value);
      this.yogaNode.markDirty();
      this.requestRender();
    }
  }
  get showCursor() {
    return this._showCursor;
  }
  set showCursor(value) {
    if (this._showCursor !== value) {
      this._showCursor = value;
      if (!value && this._focused) {
        this._ctx.setCursorPosition(0, 0, false);
      }
      this.requestRender();
    }
  }
  get cursorColor() {
    return this._cursorColor;
  }
  set cursorColor(value) {
    const newColor = parseColor(value);
    if (this._cursorColor !== newColor) {
      this._cursorColor = newColor;
      if (this._focused) {
        this.requestRender();
      }
    }
  }
  get cursorStyle() {
    return this._cursorStyle;
  }
  set cursorStyle(style) {
    const newStyle = style;
    if (this.cursorStyle.style !== newStyle.style || this.cursorStyle.blinking !== newStyle.blinking) {
      this._cursorStyle = newStyle;
      if (this._focused) {
        this.requestRender();
      }
    }
  }
  get tabIndicator() {
    return this._tabIndicator;
  }
  set tabIndicator(value) {
    if (this._tabIndicator !== value) {
      this._tabIndicator = value;
      if (value !== undefined) {
        this.editorView.setTabIndicator(value);
      }
      this.requestRender();
    }
  }
  get tabIndicatorColor() {
    return this._tabIndicatorColor;
  }
  set tabIndicatorColor(value) {
    const newColor = value ? parseColor(value) : undefined;
    if (this._tabIndicatorColor !== newColor) {
      this._tabIndicatorColor = newColor;
      if (newColor !== undefined) {
        this.editorView.setTabIndicatorColor(newColor);
      }
      this.requestRender();
    }
  }
  get scrollSpeed() {
    return this._scrollSpeed;
  }
  set scrollSpeed(value) {
    this._scrollSpeed = Math.max(0, value);
  }
  onMouseEvent(event) {
    if (event.type === "scroll") {
      this.handleScroll(event);
    }
  }
  handleScroll(event) {
    if (!event.scroll)
      return;
    const { direction, delta } = event.scroll;
    const viewport = this.editorView.getViewport();
    if (direction === "up") {
      const newOffsetY = Math.max(0, viewport.offsetY - delta);
      this.editorView.setViewport(viewport.offsetX, newOffsetY, viewport.width, viewport.height, true);
      this.requestRender();
    } else if (direction === "down") {
      const totalVirtualLines = this.editorView.getTotalVirtualLineCount();
      const maxOffsetY = Math.max(0, totalVirtualLines - viewport.height);
      const newOffsetY = Math.min(viewport.offsetY + delta, maxOffsetY);
      this.editorView.setViewport(viewport.offsetX, newOffsetY, viewport.width, viewport.height, true);
      this.requestRender();
    }
    if (this._wrapMode === "none") {
      if (direction === "left") {
        const newOffsetX = Math.max(0, viewport.offsetX - delta);
        this.editorView.setViewport(newOffsetX, viewport.offsetY, viewport.width, viewport.height, true);
        this.requestRender();
      } else if (direction === "right") {
        const newOffsetX = viewport.offsetX + delta;
        this.editorView.setViewport(newOffsetX, viewport.offsetY, viewport.width, viewport.height, true);
        this.requestRender();
      }
    }
  }
  onResize(width, height) {
    this.editorView.setViewportSize(width, height);
  }
  refreshLocalSelection() {
    if (this.lastLocalSelection) {
      return this.updateLocalSelection(this.lastLocalSelection);
    }
    return false;
  }
  updateLocalSelection(localSelection) {
    if (!localSelection?.isActive) {
      this.editorView.resetLocalSelection();
      return true;
    }
    return this.editorView.setLocalSelection(localSelection.anchorX, localSelection.anchorY, localSelection.focusX, localSelection.focusY, this._selectionBg, this._selectionFg, false);
  }
  shouldStartSelection(x, y) {
    if (!this.selectable)
      return false;
    const localX = x - this.x;
    const localY = y - this.y;
    return localX >= 0 && localX < this.width && localY >= 0 && localY < this.height;
  }
  onSelectionChanged(selection) {
    const localSelection = convertGlobalToLocalSelection(selection, this.x, this.y);
    this.lastLocalSelection = localSelection;
    const updateCursor = true;
    const followCursor = this._keyboardSelectionActive;
    let changed;
    if (!localSelection?.isActive) {
      this._keyboardSelectionActive = false;
      this.editorView.resetLocalSelection();
      changed = true;
    } else if (selection?.isStart) {
      changed = this.editorView.setLocalSelection(localSelection.anchorX, localSelection.anchorY, localSelection.focusX, localSelection.focusY, this._selectionBg, this._selectionFg, updateCursor, followCursor);
    } else {
      changed = this.editorView.updateLocalSelection(localSelection.anchorX, localSelection.anchorY, localSelection.focusX, localSelection.focusY, this._selectionBg, this._selectionFg, updateCursor, followCursor);
    }
    if (changed && localSelection?.isActive && selection?.isDragging) {
      const viewport = this.editorView.getViewport();
      const focusY = localSelection.focusY;
      const scrollMargin = Math.max(1, Math.floor(viewport.height * this._scrollMargin));
      if (focusY < scrollMargin) {
        this._autoScrollVelocity = -this._scrollSpeed;
      } else if (focusY >= viewport.height - scrollMargin) {
        this._autoScrollVelocity = this._scrollSpeed;
      } else {
        this._autoScrollVelocity = 0;
      }
    } else {
      this._keyboardSelectionActive = false;
      this._autoScrollVelocity = 0;
      this._autoScrollAccumulator = 0;
    }
    if (changed) {
      this.requestRender();
    }
    return this.hasSelection();
  }
  onUpdate(deltaTime) {
    super.onUpdate(deltaTime);
    if (this._autoScrollVelocity !== 0 && this.hasSelection()) {
      const deltaSeconds = deltaTime / 1000;
      this._autoScrollAccumulator += this._autoScrollVelocity * deltaSeconds;
      const linesToScroll = Math.floor(Math.abs(this._autoScrollAccumulator));
      if (linesToScroll > 0) {
        const direction = this._autoScrollVelocity > 0 ? 1 : -1;
        const viewport = this.editorView.getViewport();
        const totalVirtualLines = this.editorView.getTotalVirtualLineCount();
        const maxOffsetY = Math.max(0, totalVirtualLines - viewport.height);
        const newOffsetY = Math.max(0, Math.min(viewport.offsetY + direction * linesToScroll, maxOffsetY));
        if (newOffsetY !== viewport.offsetY) {
          this.editorView.setViewport(viewport.offsetX, newOffsetY, viewport.width, viewport.height, false);
          this._ctx.requestSelectionUpdate();
        }
        this._autoScrollAccumulator -= direction * linesToScroll;
      }
    }
  }
  getSelectedText() {
    return this.editorView.getSelectedText();
  }
  hasSelection() {
    return this.editorView.hasSelection();
  }
  getSelection() {
    return this.editorView.getSelection();
  }
  refreshSelectionStyle() {
    if (this.lastLocalSelection) {
      this.updateLocalSelection(this.lastLocalSelection);
      return;
    }
    const selection = this.getSelection();
    if (!selection)
      return;
    this.editorView.setSelection(selection.start, selection.end, this._selectionBg, this._selectionFg);
  }
  deleteSelectedText() {
    this.editorView.deleteSelectedText();
    this._ctx.clearSelection();
    this.requestRender();
  }
  setSelection(start, end) {
    this.lastLocalSelection = null;
    this.editorView.resetLocalSelection();
    this._ctx.clearSelection();
    this.editorView.setSelection(start, end, this._selectionBg, this._selectionFg);
    this.requestRender();
  }
  setSelectionInclusive(start, end) {
    this.setSelection(Math.min(start, end), Math.max(start, end) + 1);
  }
  clearSelection() {
    const had = this.hasSelection();
    this.lastLocalSelection = null;
    this.editorView.resetSelection();
    this.editorView.resetLocalSelection();
    this._ctx.clearSelection();
    if (had) {
      this.requestRender();
    }
    return had;
  }
  deleteSelection() {
    if (!this.hasSelection())
      return false;
    this.lastLocalSelection = null;
    this.deleteSelectedText();
    return true;
  }
  setCursor(row, col) {
    this.editBuffer.setCursor(row, col);
    this.requestRender();
  }
  insertChar(char) {
    if (this.hasSelection()) {
      this.deleteSelectedText();
    }
    this.editBuffer.insertChar(char);
    this.requestRender();
  }
  insertText(text) {
    if (this.hasSelection()) {
      this.deleteSelectedText();
    }
    this.editBuffer.insertText(text);
    this.requestRender();
  }
  deleteChar() {
    if (this.hasSelection()) {
      this.deleteSelectedText();
      return true;
    }
    this._ctx.clearSelection();
    this.editBuffer.deleteChar();
    this.requestRender();
    return true;
  }
  deleteCharBackward() {
    if (this.hasSelection()) {
      this.deleteSelectedText();
      return true;
    }
    this._ctx.clearSelection();
    this.editBuffer.deleteCharBackward();
    this.requestRender();
    return true;
  }
  newLine() {
    this._ctx.clearSelection();
    this.editBuffer.newLine();
    this.requestRender();
    return true;
  }
  deleteLine() {
    this._ctx.clearSelection();
    this.editBuffer.deleteLine();
    this.requestRender();
    return true;
  }
  moveCursorLeft(options) {
    const select = options?.select ?? false;
    if (!select && this.hasSelection()) {
      const selection = this.getSelection();
      this.editBuffer.setCursorByOffset(selection.start);
      this._ctx.clearSelection();
      this.requestRender();
      return true;
    }
    this.updateSelectionForMovement(select, true);
    this.editBuffer.moveCursorLeft();
    this.updateSelectionForMovement(select, false);
    this.requestRender();
    return true;
  }
  moveCursorRight(options) {
    const select = options?.select ?? false;
    if (!select && this.hasSelection()) {
      const selection = this.getSelection();
      const targetOffset = this.cursorOffset === selection.start ? selection.end - 1 : selection.end;
      this.editBuffer.setCursorByOffset(targetOffset);
      this._ctx.clearSelection();
      this.requestRender();
      return true;
    }
    this.updateSelectionForMovement(select, true);
    this.editBuffer.moveCursorRight();
    this.updateSelectionForMovement(select, false);
    this.requestRender();
    return true;
  }
  moveCursorUp(options) {
    const select = options?.select ?? false;
    this.updateSelectionForMovement(select, true);
    this.editorView.moveUpVisual();
    this.updateSelectionForMovement(select, false);
    this.requestRender();
    return true;
  }
  moveCursorDown(options) {
    const select = options?.select ?? false;
    this.updateSelectionForMovement(select, true);
    this.editorView.moveDownVisual();
    this.updateSelectionForMovement(select, false);
    this.requestRender();
    return true;
  }
  gotoLine(line) {
    this.editBuffer.gotoLine(line);
    this.requestRender();
  }
  gotoLineStart() {
    this.setCursor(this.logicalCursor.row, 0);
  }
  gotoLineTextEnd() {
    const eol = this.editBuffer.getEOL();
    this.setCursor(eol.row, eol.col);
  }
  gotoLineHome(options) {
    const select = options?.select ?? false;
    this.updateSelectionForMovement(select, true);
    const cursor = this.editorView.getCursor();
    if (cursor.col === 0 && cursor.row > 0) {
      this.editBuffer.setCursor(cursor.row - 1, 0);
      const prevLineEol = this.editBuffer.getEOL();
      this.editBuffer.setCursor(prevLineEol.row, prevLineEol.col);
    } else {
      this.editBuffer.setCursor(cursor.row, 0);
    }
    this.updateSelectionForMovement(select, false);
    this.requestRender();
    return true;
  }
  gotoLineEnd(options) {
    const select = options?.select ?? false;
    this.updateSelectionForMovement(select, true);
    const cursor = this.editorView.getCursor();
    const eol = this.editBuffer.getEOL();
    const lineCount = this.editBuffer.getLineCount();
    if (cursor.col === eol.col && cursor.row < lineCount - 1) {
      this.editBuffer.setCursor(cursor.row + 1, 0);
    } else {
      this.editBuffer.setCursor(eol.row, eol.col);
    }
    this.updateSelectionForMovement(select, false);
    this.requestRender();
    return true;
  }
  gotoVisualLineHome(options) {
    const select = options?.select ?? false;
    this.updateSelectionForMovement(select, true);
    const sol = this.editorView.getVisualSOL();
    this.editBuffer.setCursor(sol.logicalRow, sol.logicalCol);
    this.updateSelectionForMovement(select, false);
    this.requestRender();
    return true;
  }
  gotoVisualLineEnd(options) {
    const select = options?.select ?? false;
    this.updateSelectionForMovement(select, true);
    const eol = this.editorView.getVisualEOL();
    this.editBuffer.setCursor(eol.logicalRow, eol.logicalCol);
    this.updateSelectionForMovement(select, false);
    this.requestRender();
    return true;
  }
  gotoBufferHome(options) {
    const select = options?.select ?? false;
    this.updateSelectionForMovement(select, true);
    this.editBuffer.setCursor(0, 0);
    this.updateSelectionForMovement(select, false);
    this.requestRender();
    return true;
  }
  gotoBufferEnd(options) {
    const select = options?.select ?? false;
    this.updateSelectionForMovement(select, true);
    this.editBuffer.gotoLine(999999);
    this.updateSelectionForMovement(select, false);
    this.requestRender();
    return true;
  }
  selectAll() {
    this.updateSelectionForMovement(false, true);
    this.editBuffer.setCursor(0, 0);
    return this.gotoBufferEnd({ select: true });
  }
  deleteToLineEnd() {
    const cursor = this.editorView.getCursor();
    const eol = this.editBuffer.getEOL();
    if (eol.col > cursor.col) {
      this.editBuffer.deleteRange(cursor.row, cursor.col, eol.row, eol.col);
    }
    this.requestRender();
    return true;
  }
  deleteToLineStart() {
    const cursor = this.editorView.getCursor();
    if (cursor.col > 0) {
      this.editBuffer.deleteRange(cursor.row, 0, cursor.row, cursor.col);
    } else if (cursor.row > 0) {
      this.editBuffer.deleteCharBackward();
    }
    this.requestRender();
    return true;
  }
  undo() {
    this._ctx.clearSelection();
    this.editBuffer.undo();
    this.requestRender();
    return true;
  }
  redo() {
    this._ctx.clearSelection();
    this.editBuffer.redo();
    this.requestRender();
    return true;
  }
  moveWordForward(options) {
    const select = options?.select ?? false;
    this.updateSelectionForMovement(select, true);
    const nextWord = this.editBuffer.getNextWordBoundary();
    this.editBuffer.setCursorByOffset(nextWord.offset);
    this.updateSelectionForMovement(select, false);
    this.requestRender();
    return true;
  }
  moveWordBackward(options) {
    const select = options?.select ?? false;
    this.updateSelectionForMovement(select, true);
    const prevWord = this.editBuffer.getPrevWordBoundary();
    this.editBuffer.setCursorByOffset(prevWord.offset);
    this.updateSelectionForMovement(select, false);
    this.requestRender();
    return true;
  }
  deleteWordForward() {
    if (this.hasSelection()) {
      this.deleteSelectedText();
      return true;
    }
    const currentCursor = this.editBuffer.getCursorPosition();
    const nextWord = this.editBuffer.getNextWordBoundary();
    if (nextWord.offset > currentCursor.offset) {
      this.editBuffer.deleteRange(currentCursor.row, currentCursor.col, nextWord.row, nextWord.col);
    }
    this._ctx.clearSelection();
    this.requestRender();
    return true;
  }
  deleteWordBackward() {
    if (this.hasSelection()) {
      this.deleteSelectedText();
      return true;
    }
    const currentCursor = this.editBuffer.getCursorPosition();
    const prevWord = this.editBuffer.getPrevWordBoundary();
    if (prevWord.offset < currentCursor.offset) {
      this.editBuffer.deleteRange(prevWord.row, prevWord.col, currentCursor.row, currentCursor.col);
    }
    this._ctx.clearSelection();
    this.requestRender();
    return true;
  }
  setupNativeRenderable() {
    const lib = resolveRenderLib();
    const nativeRenderable = lib.createNativeRenderable();
    if (!lib.nativeRenderableAttachYogaNode(nativeRenderable, this.yogaNode.ptr)) {
      lib.destroyNativeRenderable(nativeRenderable);
      throw new Error("Failed to attach native renderable Yoga node");
    }
    if (!lib.nativeRenderableSetMeasureTarget(nativeRenderable, NativeMeasureTargetKind.EditorView, this.editorView.ptr)) {
      lib.destroyNativeRenderable(nativeRenderable);
      throw new Error("Failed to attach editor native measure target");
    }
    this.nativeRenderable = nativeRenderable;
  }
  render(buffer, deltaTime) {
    if (!this.visible)
      return;
    if (this.isDestroyed)
      return;
    const screenX = this._screenX;
    const screenY = this._screenY;
    this.markClean();
    this._ctx.addToHitGrid(screenX, screenY, this.width, this.height, this.num);
    this.renderSelf(buffer);
    this.renderCursor(buffer);
  }
  renderSelf(buffer) {
    buffer.drawEditorView(this.editorView, this._screenX, this._screenY);
  }
  renderCursor(buffer) {
    if (!this._showCursor || !this._focused)
      return;
    const visualCursor = this.editorView.getVisualCursor();
    const screenX = this._screenX;
    const screenY = this._screenY;
    const cursorX = screenX + visualCursor.visualCol + 1;
    const cursorY = screenY + visualCursor.visualRow + 1;
    this._ctx.setCursorPosition(cursorX, cursorY, true);
    this._ctx.setCursorStyle({ ...this._cursorStyle, color: this._cursorColor });
  }
  focus() {
    super.focus();
    this._ctx.setCursorStyle({ ...this._cursorStyle, color: this._cursorColor });
    this.requestRender();
  }
  blur() {
    super.blur();
    this._ctx.setCursorPosition(0, 0, false);
    this.requestRender();
  }
  onRemove() {
    if (this._focused) {
      this._ctx.setCursorPosition(0, 0, false);
    }
  }
  destroy() {
    if (this.isDestroyed)
      return;
    this.traits = {};
    if (this._focused) {
      this._ctx.setCursorPosition(0, 0, false);
      this.blur();
    }
    if (this.nativeRenderable) {
      resolveRenderLib().destroyNativeRenderable(this.nativeRenderable);
      this.nativeRenderable = null;
    }
    this.editorView.destroy();
    this.editBuffer.destroy();
    super.destroy();
  }
  set onCursorChange(handler) {
    this._cursorChangeListener = handler;
  }
  get onCursorChange() {
    return this._cursorChangeListener;
  }
  set onContentChange(handler) {
    this._contentChangeListener = handler;
  }
  get onContentChange() {
    return this._contentChangeListener;
  }
  get syntaxStyle() {
    return this.editBuffer.getSyntaxStyle();
  }
  set syntaxStyle(style) {
    this.editBuffer.setSyntaxStyle(style);
    this.requestRender();
  }
  addHighlight(lineIdx, highlight) {
    this.editBuffer.addHighlight(lineIdx, highlight);
    this.requestRender();
  }
  addHighlightByCharRange(highlight) {
    this.editBuffer.addHighlightByCharRange(highlight);
    this.requestRender();
  }
  removeHighlightsByRef(hlRef) {
    this.editBuffer.removeHighlightsByRef(hlRef);
    this.requestRender();
  }
  clearLineHighlights(lineIdx) {
    this.editBuffer.clearLineHighlights(lineIdx);
    this.requestRender();
  }
  clearAllHighlights() {
    this.editBuffer.clearAllHighlights();
    this.requestRender();
  }
  getLineHighlights(lineIdx) {
    return this.editBuffer.getLineHighlights(lineIdx);
  }
  setText(text) {
    this.editBuffer.setText(text);
    this.yogaNode.markDirty();
    this.requestRender();
  }
  replaceText(text) {
    this.editBuffer.replaceText(text);
    this.yogaNode.markDirty();
    this.requestRender();
  }
  clear() {
    this.editBuffer.clear();
    this.editBuffer.clearAllHighlights();
    this.yogaNode.markDirty();
    this.requestRender();
  }
  deleteRange(startLine, startCol, endLine, endCol) {
    this.editBuffer.deleteRange(startLine, startCol, endLine, endCol);
    this.yogaNode.markDirty();
    this.requestRender();
  }
  getTextRange(startOffset, endOffset) {
    return this.editBuffer.getTextRange(startOffset, endOffset);
  }
  getTextRangeByCoords(startRow, startCol, endRow, endCol) {
    return this.editBuffer.getTextRangeByCoords(startRow, startCol, endRow, endCol);
  }
  updateSelectionForMovement(shiftPressed, isBeforeMovement) {
    if (!this.selectable)
      return;
    if (!shiftPressed) {
      this._keyboardSelectionActive = false;
      this._ctx.clearSelection();
      return;
    }
    this._keyboardSelectionActive = true;
    const visualCursor = this.editorView.getVisualCursor();
    const cursorX = this.x + visualCursor.visualCol;
    const cursorY = this.y + visualCursor.visualRow;
    if (isBeforeMovement) {
      if (!this._ctx.hasSelection) {
        this._ctx.startSelection(this, cursorX, cursorY);
      }
      return;
    }
    this._ctx.updateSelection(this, cursorX, cursorY, { finishDragging: true });
  }
}

// src/ansi.ts
var ANSI = {
  switchToAlternateScreen: "\x1B[?1049h",
  switchToMainScreen: "\x1B[?1049l",
  reset: "\x1B[0m",
  resetScrollRegion: "\x1B[r",
  home: "\x1B[H",
  clearScreen: "\x1B[2J",
  clearSavedLines: "\x1B[3J",
  scrollDown: (lines) => `\x1B[${lines}T`,
  scrollUp: (lines) => `\x1B[${lines}S`,
  moveCursor: (row, col) => `\x1B[${row};${col}H`,
  moveCursorAndClear: (row, col) => `\x1B[${row};${col}H\x1B[J`,
  setRgbBackground: (r, g, b) => `\x1B[48;2;${r};${g};${b}m`,
  resetBackground: "\x1B[49m",
  bracketedPasteStart: "\x1B[200~",
  bracketedPasteEnd: "\x1B[201~"
};

// src/renderer.ts
import { EventEmitter as EventEmitter5 } from "events";

// src/lib/objects-in-viewport.ts
function getObjectsInViewport(viewport, objects, direction = "column", padding = 10, minTriggerSize = 16) {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return [];
  }
  if (objects.length === 0) {
    return [];
  }
  if (objects.length < minTriggerSize) {
    return objects;
  }
  const viewportTop = viewport.y - padding;
  const viewportBottom = viewport.y + viewport.height + padding;
  const viewportLeft = viewport.x - padding;
  const viewportRight = viewport.x + viewport.width + padding;
  const isRow = direction === "row";
  const children = objects;
  const totalChildren = children.length;
  if (totalChildren === 0)
    return [];
  const vpStart = isRow ? viewportLeft : viewportTop;
  const vpEnd = isRow ? viewportRight : viewportBottom;
  let lo = 0;
  let hi = totalChildren - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    const c = children[mid];
    const start = isRow ? c.screenX : c.screenY;
    const end = isRow ? c.screenX + c.width : c.screenY + c.height;
    if (end < vpStart) {
      lo = mid + 1;
    } else if (start > vpEnd) {
      hi = mid - 1;
    } else {
      candidate = mid;
      break;
    }
  }
  const visibleChildren = [];
  if (candidate === -1) {
    candidate = lo > 0 ? lo - 1 : 0;
  }
  const maxLookBehind = 50;
  let left = candidate;
  let gapCount = 0;
  while (left - 1 >= 0) {
    const prev = children[left - 1];
    const prevEnd = isRow ? prev.screenX + prev.width : prev.screenY + prev.height;
    if (prevEnd <= vpStart) {
      gapCount++;
      if (gapCount >= maxLookBehind) {
        break;
      }
    } else {
      gapCount = 0;
    }
    left--;
  }
  let right = candidate + 1;
  while (right < totalChildren) {
    const next = children[right];
    if ((isRow ? next.screenX : next.screenY) >= vpEnd)
      break;
    right++;
  }
  for (let i = left;i < right; i++) {
    const child = children[i];
    const start = isRow ? child.screenX : child.screenY;
    const end = isRow ? child.screenX + child.width : child.screenY + child.height;
    if (end <= vpStart)
      continue;
    if (start >= vpEnd)
      break;
    if (isRow) {
      const childBottom = child.screenY + child.height;
      if (childBottom < viewportTop)
        continue;
      const childTop = child.screenY;
      if (childTop > viewportBottom)
        continue;
    } else {
      const childRight = child.screenX + child.width;
      if (childRight < viewportLeft)
        continue;
      const childLeft = child.screenX;
      if (childLeft > viewportRight)
        continue;
    }
    visibleChildren.push(child);
  }
  if (visibleChildren.length > 1) {
    visibleChildren.sort((a, b) => a.zIndex > b.zIndex ? 1 : a.zIndex < b.zIndex ? -1 : 0);
  }
  return visibleChildren;
}

// src/lib/render-geometry.ts
function calculateRenderGeometry(screenMode, terminalWidth, terminalHeight, footerHeight) {
  const safeTerminalWidth = Math.max(terminalWidth, 0);
  const safeTerminalHeight = Math.max(terminalHeight, 0);
  if (screenMode !== "split-footer") {
    return {
      effectiveFooterHeight: 0,
      renderOffset: 0,
      renderWidth: safeTerminalWidth,
      renderHeight: safeTerminalHeight
    };
  }
  const effectiveFooterHeight = Math.min(footerHeight, safeTerminalHeight);
  return {
    effectiveFooterHeight,
    renderOffset: safeTerminalHeight - effectiveFooterHeight,
    renderWidth: safeTerminalWidth,
    renderHeight: effectiveFooterHeight
  };
}

// src/lib/terminal-capability-detection.ts
function isCapabilityResponse(sequence) {
  if (/\x1b\[\?\d+(?:;\d+)*\$y/.test(sequence)) {
    return true;
  }
  if (/\x1b\[1;(?!1R)\d+R/.test(sequence)) {
    return true;
  }
  if (/\x1bP>\|[\s\S]*?\x1b\\/.test(sequence)) {
    return true;
  }
  if (/\x1bP(?:1\+r4d73(?:=[^\x1b]*)?|0\+r(?:4d73)?)\x1b\\/i.test(sequence)) {
    return true;
  }
  if (/\x1b_G[\s\S]*?\x1b\\/.test(sequence)) {
    return true;
  }
  if (/\x1b\[\?\d+(?:;\d+)?u/.test(sequence)) {
    return true;
  }
  if (/\x1b\[\?[0-9;]*c/.test(sequence)) {
    return true;
  }
  if (/\x1b\]99;[^\x07\x1b]*i=opentui-notifications[^\x07\x1b]*p=\?[\s\S]*?(?:\x07|\x1b\\)/.test(sequence)) {
    return true;
  }
  if (/\x1b\]1337;Capabilities=[\s\S]*?(?:\x07|\x1b\\)/.test(sequence)) {
    return true;
  }
  return false;
}
function isPixelResolutionResponse(sequence) {
  return /\x1b\[4;\d+;\d+t/.test(sequence);
}
function parsePixelResolution(sequence) {
  const match = sequence.match(/\x1b\[4;(\d+);(\d+)t/);
  if (match) {
    return {
      width: parseInt(match[2]),
      height: parseInt(match[1])
    };
  }
  return null;
}

// src/renderer-theme-mode.ts
var OSC_THEME_RESPONSE = /\x1b](10|11);(?:(?:rgb:)([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)|#([0-9a-fA-F]{6}))(?:\x07|\x1b\\)/g;
function scaleOscThemeComponent(component) {
  const value = parseInt(component, 16);
  const maxValue = (1 << 4 * component.length) - 1;
  return Math.round(value / maxValue * 255).toString(16).padStart(2, "0");
}
function oscThemeColorToHex(r, g, b, hex6) {
  if (hex6) {
    return `#${hex6.toLowerCase()}`;
  }
  if (r && g && b) {
    return `#${scaleOscThemeComponent(r)}${scaleOscThemeComponent(g)}${scaleOscThemeComponent(b)}`;
  }
  return "#000000";
}
function inferThemeModeFromBackgroundColor(color) {
  const [r, g, b] = parseColor(color).toInts();
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128 ? "light" : "dark";
}

class RendererThemeMode {
  host;
  clock;
  static QUERY_TIMEOUT_MS = 250;
  _themeMode = null;
  themeQueryPending = true;
  themeOscForeground = null;
  themeOscBackground = null;
  themeRefreshTimeoutId = null;
  waiters = new Set;
  constructor(host, clock) {
    this.host = host;
    this.clock = clock;
  }
  get themeMode() {
    return this._themeMode;
  }
  waitForThemeMode(timeoutMs, isDestroyed) {
    if (this._themeMode !== null || isDestroyed || timeoutMs === 0) {
      return Promise.resolve(this._themeMode);
    }
    return new Promise((resolve) => {
      const waiter = {
        resolve,
        timeoutHandle: null
      };
      if (timeoutMs > 0) {
        waiter.timeoutHandle = this.clock.setTimeout(() => {
          this.waiters.delete(waiter);
          waiter.timeoutHandle = null;
          resolve(this._themeMode);
        }, timeoutMs);
      }
      this.waiters.add(waiter);
    });
  }
  cancelRefresh() {
    if (this.themeRefreshTimeoutId === null) {
      return;
    }
    this.clock.clearTimeout(this.themeRefreshTimeoutId);
    this.themeRefreshTimeoutId = null;
    this.themeQueryPending = false;
  }
  dispose() {
    this.cancelRefresh();
    for (const waiter of this.waiters) {
      if (waiter.timeoutHandle !== null) {
        this.clock.clearTimeout(waiter.timeoutHandle);
      }
      waiter.resolve(this._themeMode);
    }
    this.waiters.clear();
  }
  handleSequence(sequence) {
    if (sequence === "\x1B[?997;1n" || sequence === "\x1B[?997;2n") {
      this.requestThemeOscColors();
      return { handled: true, changedMode: null };
    }
    let handledOscThemeResponse = false;
    let match;
    OSC_THEME_RESPONSE.lastIndex = 0;
    while (match = OSC_THEME_RESPONSE.exec(sequence)) {
      handledOscThemeResponse = true;
      const color = oscThemeColorToHex(match[2], match[3], match[4], match[5]);
      if (match[1] === "10") {
        this.themeOscForeground = color;
      } else {
        this.themeOscBackground = color;
      }
    }
    if (!handledOscThemeResponse) {
      return { handled: false, changedMode: null };
    }
    if (!this.themeQueryPending) {
      return { handled: true, changedMode: null };
    }
    if (!this.themeOscForeground || !this.themeOscBackground) {
      return { handled: true, changedMode: null };
    }
    const nextMode = inferThemeModeFromBackgroundColor(this.themeOscBackground);
    const changedMode = this.applyThemeMode(nextMode);
    this.completeThemeQuery();
    return { handled: true, changedMode };
  }
  clearThemeRefreshTimeout() {
    if (this.themeRefreshTimeoutId === null) {
      return;
    }
    this.clock.clearTimeout(this.themeRefreshTimeoutId);
    this.themeRefreshTimeoutId = null;
  }
  completeThemeQuery() {
    this.clearThemeRefreshTimeout();
    this.themeQueryPending = false;
  }
  requestThemeOscColors() {
    if (this.themeRefreshTimeoutId !== null) {
      return;
    }
    this.themeQueryPending = true;
    this.themeOscForeground = null;
    this.themeOscBackground = null;
    this.host.queryThemeColors();
    this.clearThemeRefreshTimeout();
    this.themeRefreshTimeoutId = this.clock.setTimeout(() => {
      this.completeThemeQuery();
    }, RendererThemeMode.QUERY_TIMEOUT_MS);
  }
  applyThemeMode(mode) {
    const changed = this._themeMode !== mode;
    this._themeMode = mode;
    if (!changed) {
      return null;
    }
    for (const waiter of this.waiters) {
      if (waiter.timeoutHandle !== null) {
        this.clock.clearTimeout(waiter.timeoutHandle);
      }
      waiter.resolve(mode);
    }
    this.waiters.clear();
    return mode;
  }
}

// src/renderer.ts
registerEnvVar({
  name: "OTUI_DUMP_CAPTURES",
  description: "Dump captured stdout and console caches when the renderer exit handler runs.",
  type: "boolean",
  default: false
});
registerEnvVar({
  name: "OTUI_NO_NATIVE_RENDER",
  description: "Skip the Zig/native frame renderer. Useful for debugging the render loop; split-footer stdout flushing may still write ANSI.",
  type: "boolean",
  default: false
});
registerEnvVar({
  name: "OTUI_USE_ALTERNATE_SCREEN",
  description: "When explicitly set, force screen mode selection: true=alternate-screen, false=main-screen.",
  type: "boolean",
  default: true
});
registerEnvVar({
  name: "OTUI_OVERRIDE_STDOUT",
  description: "When explicitly set, force stdout routing: false=passthrough, true=capture in split-footer mode.",
  type: "boolean",
  default: true
});
registerEnvVar({
  name: "OTUI_DEBUG",
  description: "Enable debug mode to capture all raw input for debugging purposes.",
  type: "boolean",
  default: false
});
registerEnvVar({
  name: "OTUI_SHOW_STATS",
  description: "Show the debug overlay at startup.",
  type: "boolean",
  default: false
});
var DEFAULT_FOOTER_HEIGHT = 12;
var MAX_SCROLLBACK_SURFACE_HEIGHT_PASSES = 4;
var TRANSPARENT_RGBA = RGBA.fromValues(0, 0, 0, 0);
var scrollbackSurfaceCounter = 0;
function normalizeFooterHeight(footerHeight) {
  if (footerHeight === undefined) {
    return DEFAULT_FOOTER_HEIGHT;
  }
  if (!Number.isFinite(footerHeight)) {
    throw new Error("footerHeight must be a finite number");
  }
  const normalizedFooterHeight = Math.trunc(footerHeight);
  if (normalizedFooterHeight <= 0) {
    throw new Error("footerHeight must be greater than 0");
  }
  return normalizedFooterHeight;
}
function resolveModes(config) {
  let screenMode = config.screenMode ?? "alternate-screen";
  if (process.env.OTUI_USE_ALTERNATE_SCREEN !== undefined) {
    screenMode = env.OTUI_USE_ALTERNATE_SCREEN ? "alternate-screen" : "main-screen";
  }
  const footerHeight = screenMode === "split-footer" ? normalizeFooterHeight(config.footerHeight) : DEFAULT_FOOTER_HEIGHT;
  let externalOutputMode = config.externalOutputMode ?? (screenMode === "split-footer" ? "capture-stdout" : "passthrough");
  if (process.env.OTUI_OVERRIDE_STDOUT !== undefined) {
    externalOutputMode = env.OTUI_OVERRIDE_STDOUT && screenMode === "split-footer" ? "capture-stdout" : "passthrough";
  }
  if (externalOutputMode === "capture-stdout" && screenMode !== "split-footer") {
    throw new Error('externalOutputMode "capture-stdout" requires screenMode "split-footer"');
  }
  return {
    screenMode,
    footerHeight,
    externalOutputMode
  };
}

class ExternalOutputQueue {
  commits = [];
  get size() {
    return this.commits.length;
  }
  writeSnapshot(commit) {
    this.commits.push(commit);
  }
  peek(limit = Number.POSITIVE_INFINITY) {
    const clampedLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : this.commits.length;
    return this.commits.slice(0, clampedLimit);
  }
  claim(limit = Number.POSITIVE_INFINITY) {
    if (this.commits.length === 0) {
      return [];
    }
    const clampedLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : this.commits.length;
    if (clampedLimit >= this.commits.length) {
      const output2 = this.commits;
      this.commits = [];
      return output2;
    }
    const output = this.commits.slice(0, clampedLimit);
    this.commits = this.commits.slice(clampedLimit);
    return output;
  }
  drop(count) {
    for (const commit of this.commits.splice(0, count)) {
      commit.snapshot.destroy();
    }
  }
  clear() {
    this.drop(this.commits.length);
  }
}
var CHAR_FLAG_CONTINUATION = 3221225472 >>> 0;
var CHAR_FLAG_MASK = 3221225472 >>> 0;

class ScrollbackSnapshotRenderContext extends EventEmitter5 {
  width;
  height;
  frameId = 0;
  widthMethod;
  capabilities = null;
  hasSelection = false;
  currentFocusedRenderable = null;
  keyInput;
  _internalKeyInput;
  lifecyclePasses = new Set;
  constructor(width, height, widthMethod) {
    super();
    this.width = width;
    this.height = height;
    this.widthMethod = widthMethod;
    this.keyInput = new KeyHandler;
    this._internalKeyInput = new InternalKeyHandler;
  }
  addToHitGrid(_x, _y, _width, _height, _id) {}
  pushHitGridScissorRect(_x, _y, _width, _height) {}
  popHitGridScissorRect() {}
  clearHitGridScissorRects() {}
  requestRender() {}
  setCursorPosition(_x, _y, _visible) {}
  setCursorStyle(_options) {}
  setCursorColor(_color) {}
  setMousePointer(_shape) {}
  requestLive() {}
  dropLive() {}
  getSelection() {
    return null;
  }
  get currentFocusedEditor() {
    if (!this.currentFocusedRenderable)
      return null;
    if (!isEditBufferRenderable(this.currentFocusedRenderable))
      return null;
    return this.currentFocusedRenderable;
  }
  requestSelectionUpdate() {}
  focusRenderable(renderable) {
    this.currentFocusedRenderable = renderable;
  }
  blurRenderable(renderable) {
    if (this.currentFocusedRenderable === renderable) {
      this.currentFocusedRenderable = null;
    }
  }
  registerLifecyclePass(renderable) {
    this.lifecyclePasses.add(renderable);
  }
  unregisterLifecyclePass(renderable) {
    this.lifecyclePasses.delete(renderable);
  }
  getLifecyclePasses() {
    return this.lifecyclePasses;
  }
  clearSelection() {}
  startSelection(_renderable, _x, _y) {}
  updateSelection(_currentRenderable, _x, _y, _options) {}
}
var DEFAULT_FORWARDED_ENV_KEYS = [
  "TMUX",
  "ZELLIJ",
  "ZELLIJ_SESSION_NAME",
  "ZELLIJ_PANE_ID",
  "TERM",
  "OPENTUI_GRAPHICS",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TERM_FEATURES",
  "ALACRITTY_SOCKET",
  "ALACRITTY_LOG",
  "COLORTERM",
  "TERMUX_VERSION",
  "VHS_RECORD",
  "OPENTUI_FORCE_WCWIDTH",
  "OPENTUI_FORCE_UNICODE",
  "OPENTUI_FORCE_NOZWJ",
  "OPENTUI_FORCE_EXPLICIT_WIDTH",
  "OPENTUI_NOTIFICATION_PROTOCOL",
  "OPENTUI_NOTIFICATIONS",
  "WT_SESSION",
  "STY",
  "WSL_DISTRO_NAME",
  "WSL_INTEROP"
];
var NATIVE_RENDER_STATUS_SKIPPED = 1;
var NATIVE_RENDER_STATUS_FAILED = 2;
var KITTY_FLAG_DISAMBIGUATE = 1;
var KITTY_FLAG_EVENT_TYPES = 2;
var KITTY_FLAG_ALTERNATE_KEYS = 4;
var KITTY_FLAG_ALL_KEYS_AS_ESCAPES = 8;
var KITTY_FLAG_REPORT_TEXT = 16;
var DEFAULT_STDIN_PARSER_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
var NATIVE_PALETTE_QUERY_SIZE = 16;
function buildKittyKeyboardFlags(config) {
  if (!config) {
    return 0;
  }
  let flags = 0;
  if (config.disambiguate !== false) {
    flags |= KITTY_FLAG_DISAMBIGUATE;
  }
  if (config.alternateKeys !== false) {
    flags |= KITTY_FLAG_ALTERNATE_KEYS;
  }
  if (config.events === true) {
    flags |= KITTY_FLAG_EVENT_TYPES;
  }
  if (config.allKeysAsEscapes === true) {
    flags |= KITTY_FLAG_ALL_KEYS_AS_ESCAPES;
  }
  if (config.reportText === true) {
    flags |= KITTY_FLAG_REPORT_TEXT;
  }
  return flags;
}

class MouseEvent {
  type;
  button;
  x;
  y;
  source;
  modifiers;
  scroll;
  target;
  isDragging;
  _propagationStopped = false;
  _defaultPrevented = false;
  get propagationStopped() {
    return this._propagationStopped;
  }
  get defaultPrevented() {
    return this._defaultPrevented;
  }
  constructor(target, attributes) {
    this.target = target;
    this.type = attributes.type;
    this.button = attributes.button;
    this.x = attributes.x;
    this.y = attributes.y;
    this.modifiers = attributes.modifiers;
    this.scroll = attributes.scroll;
    this.source = attributes.source;
    this.isDragging = attributes.isDragging;
  }
  stopPropagation() {
    this._propagationStopped = true;
  }
  preventDefault() {
    this._defaultPrevented = true;
  }
}
var MouseButton;
((MouseButton2) => {
  MouseButton2[MouseButton2["LEFT"] = 0] = "LEFT";
  MouseButton2[MouseButton2["MIDDLE"] = 1] = "MIDDLE";
  MouseButton2[MouseButton2["RIGHT"] = 2] = "RIGHT";
  MouseButton2[MouseButton2["WHEEL_UP"] = 4] = "WHEEL_UP";
  MouseButton2[MouseButton2["WHEEL_DOWN"] = 5] = "WHEEL_DOWN";
})(MouseButton ||= {});
var rendererTracker = singleton("RendererTracker", () => ({
  renderers: new Set,
  streamOwners: new WeakMap
}));
async function createCliRenderer(config = {}) {
  if (process.argv.includes("--delay-start")) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  const stdin = config.stdin ?? process.stdin;
  const stdout = config.stdout ?? process.stdout;
  const width = stdout.columns || config.width || 80;
  const height = stdout.rows || config.height || 24;
  const renderer = new CliRenderer(stdin, stdout, width, height, config);
  try {
    await renderer.setupTerminal();
    return renderer;
  } catch (error) {
    try {
      renderer.destroy();
    } catch (destroyError) {
      console.error("Error destroying partially-set-up renderer:", destroyError);
    }
    throw error;
  }
}
var CliRenderEvents;
((CliRenderEvents2) => {
  CliRenderEvents2["RESIZE"] = "resize";
  CliRenderEvents2["FRAME"] = "frame";
  CliRenderEvents2["EXTERNAL_OUTPUT"] = "external_output";
  CliRenderEvents2["FOCUS"] = "focus";
  CliRenderEvents2["BLUR"] = "blur";
  CliRenderEvents2["FOCUSED_RENDERABLE"] = "focused_renderable";
  CliRenderEvents2["FOCUSED_EDITOR"] = "focused_editor";
  CliRenderEvents2["THEME_MODE"] = "theme_mode";
  CliRenderEvents2["PALETTE"] = "palette";
  CliRenderEvents2["CAPABILITIES"] = "capabilities";
  CliRenderEvents2["SELECTION"] = "selection";
  CliRenderEvents2["DEBUG_OVERLAY_TOGGLE"] = "debugOverlay:toggle";
  CliRenderEvents2["DESTROY"] = "destroy";
  CliRenderEvents2["MEMORY_SNAPSHOT"] = "memory:snapshot";
})(CliRenderEvents ||= {});
var RendererControlState;
((RendererControlState2) => {
  RendererControlState2["IDLE"] = "idle";
  RendererControlState2["AUTO_STARTED"] = "auto_started";
  RendererControlState2["EXPLICIT_STARTED"] = "explicit_started";
  RendererControlState2["EXPLICIT_PAUSED"] = "explicit_paused";
  RendererControlState2["EXPLICIT_SUSPENDED"] = "explicit_suspended";
  RendererControlState2["EXPLICIT_STOPPED"] = "explicit_stopped";
})(RendererControlState ||= {});

class CliRenderer extends EventEmitter5 {
  static animationFrameId = 0;
  lib;
  rendererPtr;
  stdin;
  stdout;
  exitOnCtrlC;
  exitSignals;
  _exitListenersAdded = false;
  _isDestroyed = false;
  _destroyPending = false;
  _destroyFinalized = false;
  _destroyCleanupPrepared = false;
  _streamLeaseAcquired = false;
  nextRenderBuffer;
  currentRenderBuffer;
  _isRunning = false;
  _targetFps = 30;
  _maxFps = 60;
  automaticMemorySnapshot = false;
  memorySnapshotInterval;
  memorySnapshotTimer = null;
  lastMemorySnapshot = {
    heapUsed: 0,
    heapTotal: 0,
    arrayBuffers: 0
  };
  root;
  width;
  height;
  _useThread = false;
  gatherStats = false;
  frameTimes = [];
  maxStatSamples = 300;
  postProcessFns = [];
  backgroundColor = RGBA.fromInts(0, 0, 0, 0);
  waitingForPixelResolution = false;
  clock;
  rendering = false;
  renderingNative = false;
  renderTimeout = null;
  lastTime = 0;
  frameCount = 0;
  _frameId = 0;
  lastFpsTime = 0;
  currentFps = 0;
  targetFrameTime = 1000 / this._targetFps;
  minTargetFrameTime = 1000 / this._maxFps;
  immediateRerenderRequested = false;
  updateScheduled = false;
  liveRequestCounter = 0;
  _controlState = "idle" /* IDLE */;
  frameCallbacks = [];
  renderStats = {
    frameCount: 0,
    fps: 0,
    renderTime: 0,
    frameCallbackTime: 0
  };
  debugOverlay = {
    enabled: env.OTUI_SHOW_STATS,
    corner: 3 /* bottomRight */
  };
  _console;
  _resolution = null;
  _keyHandler;
  stdinParser = null;
  oscSubscribers = new Set;
  hasLoggedStdinParserError = false;
  animationRequest = new Map;
  resizeTimeoutId = null;
  capabilityTimeoutId = null;
  xtVersionWaiters = new Set;
  splitStartupSeedTimeoutId = null;
  pendingSplitStartupCursorSeed = false;
  resizeDebounceDelay = 100;
  enableMouseMovement = false;
  _useMouse = true;
  autoFocus = true;
  _screenMode = "alternate-screen";
  _footerHeight = DEFAULT_FOOTER_HEIGHT;
  _externalOutputMode = "passthrough";
  clearOnShutdown = true;
  _suspendedMouseEnabled = false;
  _previousControlState = "idle" /* IDLE */;
  pendingSuspendedTerminalSetup = false;
  suspendedNonAltSurfacePreserved = false;
  capturedRenderable;
  lastOverRenderableNum = 0;
  lastOverRenderable;
  currentSelection = null;
  selectionContainers = [];
  clipboard;
  _splitHeight = 0;
  renderOffset = 0;
  splitTailColumn = 0;
  pendingSplitFooterTransition = null;
  forceFullRepaintRequested = false;
  maxSplitCommitsPerFrame = 8;
  _terminalWidth = 0;
  _terminalHeight = 0;
  _terminalIsSetup = false;
  externalOutputQueue = new ExternalOutputQueue;
  pendingExternalOutputMode = null;
  realStdoutWrite;
  _useConsole = true;
  sigwinchHandler = (() => {
    const width = this.stdout.columns || 80;
    const height = this.stdout.rows || 24;
    this.handleResize(width, height);
  }).bind(this);
  _capabilities = null;
  _latestPointer = { x: 0, y: 0 };
  _hasPointer = false;
  _lastPointerModifiers = {
    shift: false,
    alt: false,
    ctrl: false
  };
  _currentMousePointerStyle = undefined;
  _currentFocusedRenderable = null;
  lifecyclePasses = new Set;
  _openConsoleOnError = true;
  _paletteDetector = null;
  _paletteCache = new Map;
  _paletteDetectionPromise = null;
  _paletteDetectionSize = 0;
  _paletteEpoch = 0;
  _nativePaletteSignature = null;
  _emittedPaletteSignature = null;
  _palettePublishGeneration = 0;
  _onDestroy;
  themeModeState;
  _terminalFocusState = null;
  sequenceHandlers = [];
  prependedInputHandlers = [];
  shouldRestoreModesOnNextFocus = false;
  themeModeHandler;
  idleResolvers = [];
  _debugInputs = [];
  _debugModeEnabled = env.OTUI_DEBUG;
  handleError = ((error) => {
    console.error(error);
    if (this._openConsoleOnError) {
      this.console.show();
    }
  }).bind(this);
  dumpOutputCache(optionalMessage = "") {
    const cachedLogs = this.console.getCachedLogs();
    const capturedConsoleOutput = capture.claimOutput();
    const capturedExternalOutputCommits = this.externalOutputQueue.claim();
    let capturedExternalOutput = "";
    for (const commit of capturedExternalOutputCommits) {
      capturedExternalOutput += `[snapshot ${commit.snapshot.width}x${commit.snapshot.height}]
`;
      commit.snapshot.destroy();
    }
    if (capturedConsoleOutput.length > 0 || capturedExternalOutput.length > 0 || cachedLogs.length > 0) {
      this.realStdoutWrite.call(this.stdout, optionalMessage);
    }
    if (cachedLogs.length > 0) {
      this.realStdoutWrite.call(this.stdout, `Console cache:
`);
      this.realStdoutWrite.call(this.stdout, cachedLogs);
    }
    if (capturedConsoleOutput.length > 0) {
      this.realStdoutWrite.call(this.stdout, `
Captured console output:
`);
      this.realStdoutWrite.call(this.stdout, capturedConsoleOutput + `
`);
    }
    if (capturedExternalOutput.length > 0) {
      this.realStdoutWrite.call(this.stdout, `
Captured external output:
`);
      this.realStdoutWrite.call(this.stdout, capturedExternalOutput + `
`);
    }
    this.realStdoutWrite.call(this.stdout, ANSI.reset);
  }
  exitHandler = (() => {
    this.destroy();
    if (env.OTUI_DUMP_CAPTURES) {
      sleep(100).then(() => {
        this.dumpOutputCache(`=== CAPTURED OUTPUT ===
`);
      });
    }
  }).bind(this);
  warningHandler = ((warning) => {
    console.warn(JSON.stringify(warning.message, null, 2));
  }).bind(this);
  _usesProcessStdout;
  _feed = null;
  _detachFeed = null;
  _detachFeedError = null;
  feedIdleRenderScheduled = false;
  ordinaryFrameWaitingForFeed = false;
  ordinaryFrameWaitControlState = null;
  get controlState() {
    return this._controlState;
  }
  constructor(stdin, stdout, width, height, config = {}) {
    super();
    this.stdin = stdin;
    this.stdout = stdout;
    this._usesProcessStdout = stdout === process.stdout;
    this.realStdoutWrite = stdout.write;
    const lib = resolveRenderLib();
    const useMemoryBufferedOutput = config.bufferedOutput === "memory";
    const useFeedOutput = !this._usesProcessStdout && !useMemoryBufferedOutput;
    const { screenMode, footerHeight, externalOutputMode } = resolveModes(config);
    const initialGeometry = calculateRenderGeometry(screenMode, width, height, footerHeight);
    const remoteMode = config.remote ?? (useFeedOutput ? true : undefined);
    if (rendererTracker.streamOwners.get(stdin)) {
      throw new Error("Cannot create CliRenderer: stdin is already used by another CliRenderer");
    }
    if (rendererTracker.streamOwners.get(stdout)) {
      throw new Error("Cannot create CliRenderer: stdout is already used by another CliRenderer");
    }
    let feed = null;
    if (useFeedOutput) {
      try {
        feed = NativeSpanFeed.create();
      } catch (error) {
        throw new Error(`Failed to allocate NativeSpanFeed for custom stdout: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    let rendererPtr;
    try {
      rendererPtr = lib.createRenderer(initialGeometry.renderWidth, initialGeometry.renderHeight, {
        remote: remoteMode,
        feedPtr: feed?.streamPtr ?? null,
        bufferedOutput: config.bufferedOutput
      });
    } catch (error) {
      feed?.close();
      throw error;
    }
    if (!rendererPtr) {
      feed?.close();
      throw new Error("Failed to create renderer");
    }
    if (config.useThread === undefined)
      config.useThread = true;
    if (process.platform === "linux")
      config.useThread = false;
    lib.setUseThread(rendererPtr, config.useThread);
    const kittyConfig = config.useKittyKeyboard ?? {};
    const kittyFlags = buildKittyKeyboardFlags(kittyConfig);
    lib.setKittyKeyboardFlags(rendererPtr, kittyFlags);
    this._feed = feed;
    if (feed) {
      this._detachFeed = feed.onData((bytes) => {
        return new Promise((resolve) => {
          this.realStdoutWrite.call(this.stdout, bytes, () => resolve());
        });
      });
      this._detachFeedError = feed.onError((code) => {
        console.error(`[CliRenderer] NativeSpanFeed error: code=${code}`);
      });
    }
    this.lib = lib;
    this._terminalWidth = width;
    this._terminalHeight = height;
    this._useThread = config.useThread;
    this._externalOutputMode = externalOutputMode;
    this.width = initialGeometry.renderWidth;
    this.height = initialGeometry.renderHeight;
    this._splitHeight = initialGeometry.effectiveFooterHeight;
    this.renderOffset = screenMode === "split-footer" ? 0 : initialGeometry.renderOffset;
    this._footerHeight = footerHeight;
    this.rendererPtr = rendererPtr;
    this.clearOnShutdown = config.clearOnShutdown ?? true;
    this.lib.setClearOnShutdown(this.rendererPtr, this.clearOnShutdown);
    const forwardEnvKeys = config.forwardEnvKeys ?? (config.remote === false ? [...DEFAULT_FORWARDED_ENV_KEYS] : []);
    for (const key of forwardEnvKeys) {
      const value = process.env[key];
      if (value === undefined)
        continue;
      this.lib.setTerminalEnvVar(this.rendererPtr, key, value);
    }
    this.exitOnCtrlC = config.exitOnCtrlC === undefined ? true : config.exitOnCtrlC;
    this.exitSignals = config.exitSignals || [
      "SIGINT",
      "SIGTERM",
      "SIGQUIT",
      "SIGABRT",
      "SIGHUP",
      "SIGBREAK",
      "SIGPIPE",
      "SIGBUS"
    ];
    this.clipboard = new Clipboard(this.lib, this.rendererPtr);
    this.resizeDebounceDelay = config.debounceDelay || 100;
    this.targetFps = config.targetFps || 30;
    this.maxFps = config.maxFps || 60;
    this.clock = config.clock ?? new SystemClock;
    this.themeModeState = new RendererThemeMode({
      queryThemeColors: () => {
        this.lib.queryThemeColors(this.rendererPtr);
      }
    }, this.clock);
    this.themeModeHandler = (sequence) => {
      const result = this.themeModeState.handleSequence(sequence);
      if (result.changedMode) {
        this.clearPaletteCache();
        if (this.shouldSyncNativePaletteState() || this.listenerCount("palette" /* PALETTE */) > 0) {
          this.refreshPalette();
        }
        this.emit("theme_mode" /* THEME_MODE */, result.changedMode);
      }
      return result.handled;
    };
    this.memorySnapshotInterval = config.memorySnapshotInterval ?? 0;
    this.gatherStats = config.gatherStats || false;
    this.maxStatSamples = config.maxStatSamples || 300;
    this.enableMouseMovement = config.enableMouseMovement ?? true;
    this._useMouse = config.useMouse ?? true;
    this.autoFocus = config.autoFocus ?? true;
    this.nextRenderBuffer = this.lib.getNextBuffer(this.rendererPtr);
    this.currentRenderBuffer = this.lib.getCurrentBuffer(this.rendererPtr);
    this.postProcessFns = config.postProcessFns || [];
    this.prependedInputHandlers = config.prependInputHandlers || [];
    this.root = new RootRenderable(this);
    if (this.memorySnapshotInterval > 0) {
      this.startMemorySnapshotTimer();
    }
    if (this._usesProcessStdout) {
      process.on("SIGWINCH", this.sigwinchHandler);
    }
    process.on("warning", this.warningHandler);
    process.on("uncaughtException", this.handleError);
    process.on("unhandledRejection", this.handleError);
    process.on("beforeExit", this.exitHandler);
    const useKittyForParsing = kittyConfig !== null;
    this._keyHandler = new InternalKeyHandler;
    this._keyHandler.on("keypress", (event) => {
      if (this.exitOnCtrlC && matchesKeyBinding(event, { name: "c", ctrl: true })) {
        process.nextTick(() => {
          this.destroy();
        });
        return;
      }
    });
    this.addExitListeners();
    const stdinParserMaxBufferBytes = config.stdinParserMaxBufferBytes ?? DEFAULT_STDIN_PARSER_MAX_BUFFER_BYTES;
    this.stdinParser = new StdinParser({
      timeoutMs: 20,
      maxPendingBytes: stdinParserMaxBufferBytes,
      armTimeouts: true,
      onTimeoutFlush: () => {
        this.drainStdinParser();
      },
      useKittyKeyboard: useKittyForParsing,
      protocolContext: {
        kittyKeyboardEnabled: useKittyForParsing,
        privateCapabilityRepliesActive: false,
        pixelResolutionQueryActive: false,
        explicitWidthCprActive: false,
        startupCursorCprActive: false
      },
      clock: this.clock
    });
    this._console = new TerminalConsole(this, {
      ...config.consoleOptions ?? {},
      clock: this.clock
    });
    this.consoleMode = config.consoleMode ?? "console-overlay";
    this.applyScreenMode(screenMode, false, false);
    rendererTracker.streamOwners.set(stdin, this);
    rendererTracker.streamOwners.set(stdout, this);
    this._streamLeaseAcquired = true;
    rendererTracker.renderers.add(this);
    this.stdout.write = externalOutputMode === "capture-stdout" ? this.interceptStdoutWrite : this.realStdoutWrite;
    this._openConsoleOnError = config.openConsoleOnError ?? true;
    this._onDestroy = config.onDestroy;
    global.requestAnimationFrame = (callback) => {
      const id = CliRenderer.animationFrameId++;
      this.animationRequest.set(id, callback);
      this.requestLive();
      return id;
    };
    global.cancelAnimationFrame = (handle) => {
      this.animationRequest.delete(handle);
    };
    const window = global.window;
    if (!window) {
      global.window = {};
    }
    global.window.requestAnimationFrame = requestAnimationFrame;
    if (env.OTUI_NO_NATIVE_RENDER) {
      this.renderNative = () => {
        if (this._splitHeight > 0) {
          this.flushStdoutCache(this._splitHeight);
        }
        return "rendered";
      };
    }
    try {
      this.setupInput();
    } catch (error) {
      try {
        this.destroy();
      } catch (destroyError) {
        console.error("Error destroying renderer after input setup failure:", destroyError);
      }
      throw error;
    }
  }
  addExitListeners() {
    if (this._exitListenersAdded || this.exitSignals.length === 0)
      return;
    this.exitSignals.forEach((signal) => {
      process.addListener(signal, this.exitHandler);
    });
    this._exitListenersAdded = true;
  }
  removeExitListeners() {
    if (!this._exitListenersAdded || this.exitSignals.length === 0)
      return;
    this.exitSignals.forEach((signal) => {
      process.removeListener(signal, this.exitHandler);
    });
    this._exitListenersAdded = false;
  }
  get isDestroyed() {
    return this._isDestroyed;
  }
  registerLifecyclePass(renderable) {
    this.lifecyclePasses.add(renderable);
  }
  unregisterLifecyclePass(renderable) {
    this.lifecyclePasses.delete(renderable);
  }
  getLifecyclePasses() {
    return this.lifecyclePasses;
  }
  get currentFocusedRenderable() {
    return this._currentFocusedRenderable;
  }
  get currentFocusedEditor() {
    if (!this._currentFocusedRenderable)
      return null;
    if (!isEditBufferRenderable(this._currentFocusedRenderable))
      return null;
    return this._currentFocusedRenderable;
  }
  normalizeClockTime(now, fallback) {
    if (Number.isFinite(now)) {
      return now;
    }
    return Number.isFinite(fallback) ? fallback : 0;
  }
  getElapsedMs(now, then) {
    if (!Number.isFinite(now) || !Number.isFinite(then)) {
      return 0;
    }
    return Math.max(now - then, 0);
  }
  focusRenderable(renderable) {
    if (this._currentFocusedRenderable === renderable) {
      return;
    }
    const previousRenderable = this._currentFocusedRenderable;
    const previousEditor = this.currentFocusedEditor;
    this._currentFocusedRenderable = renderable;
    previousRenderable?.blur();
    const currentEditor = this.currentFocusedEditor;
    if (previousEditor !== currentEditor) {
      this.emit("focused_editor" /* FOCUSED_EDITOR */, currentEditor, previousEditor);
    }
    this.emit("focused_renderable" /* FOCUSED_RENDERABLE */, renderable, previousRenderable);
  }
  blurRenderable(renderable) {
    if (this._currentFocusedRenderable !== renderable) {
      return;
    }
    const previousEditor = this.currentFocusedEditor;
    this._currentFocusedRenderable = null;
    if (previousEditor !== null) {
      this.emit("focused_editor" /* FOCUSED_EDITOR */, null, previousEditor);
    }
    this.emit("focused_renderable" /* FOCUSED_RENDERABLE */, null, renderable);
  }
  setCapturedRenderable(renderable) {
    if (this.capturedRenderable === renderable) {
      return;
    }
    this.capturedRenderable = renderable;
  }
  addToHitGrid(x, y, width, height, id) {
    if (!this._useMouse)
      return;
    if (id !== this.capturedRenderable?.num) {
      this.lib.addToHitGrid(this.rendererPtr, x, y, width, height, id);
    }
  }
  pushHitGridScissorRect(x, y, width, height) {
    this.lib.hitGridPushScissorRect(this.rendererPtr, x, y, width, height);
  }
  popHitGridScissorRect() {
    this.lib.hitGridPopScissorRect(this.rendererPtr);
  }
  clearHitGridScissorRects() {
    this.lib.hitGridClearScissorRects(this.rendererPtr);
  }
  get widthMethod() {
    const caps = this.capabilities;
    return caps?.unicode === "wcwidth" ? "wcwidth" : "unicode";
  }
  get frameId() {
    return this._frameId;
  }
  writeOut(chunk, encoding, callback) {
    if (this.rendererPtr && (this._useThread || this._feed !== null)) {
      const data = typeof chunk === "string" ? chunk : chunk?.toString() ?? "";
      this.lib.writeOut(this.rendererPtr, data);
      if (typeof callback === "function") {
        process.nextTick(callback);
      }
      return true;
    }
    return this.realStdoutWrite.call(this.stdout, chunk, encoding, callback);
  }
  scheduleRenderAfterFeedIdle() {
    const feed = this._feed;
    if (!feed || this.feedIdleRenderScheduled || this._isDestroyed)
      return;
    this.feedIdleRenderScheduled = true;
    feed.idle().then(() => {
      this.feedIdleRenderScheduled = false;
      const ordinaryFrameWasWaiting = this.ordinaryFrameWaitingForFeed;
      const ordinaryFrameWaitControlState = this.ordinaryFrameWaitControlState;
      this.ordinaryFrameWaitingForFeed = false;
      this.ordinaryFrameWaitControlState = null;
      if (this._isDestroyed || ordinaryFrameWasWaiting && this._controlState !== ordinaryFrameWaitControlState && (this._controlState === "explicit_paused" /* EXPLICIT_PAUSED */ || this._controlState === "explicit_stopped" /* EXPLICIT_STOPPED */ || this._controlState === "explicit_suspended" /* EXPLICIT_SUSPENDED */)) {
        this.resolveIdleIfNeeded();
        return;
      }
      this.scheduleRenderTimer();
      this.resolveIdleIfNeeded();
    });
  }
  handleNativeRenderRejection(status) {
    if (status === NATIVE_RENDER_STATUS_SKIPPED && this._feed) {
      this.ordinaryFrameWaitingForFeed = true;
      this.ordinaryFrameWaitControlState = this._controlState;
      this.scheduleRenderAfterFeedIdle();
      return "retryable-skip";
    }
    if (status === NATIVE_RENDER_STATUS_SKIPPED) {
      if (this._useThread && this._usesProcessStdout)
        return "backpressured";
      console.error("[CliRenderer] Native frame render unexpectedly skipped without a feed");
      return "failed";
    }
    return this.reportNativeRenderFailure();
  }
  reportNativeRenderFailure() {
    console.error("[CliRenderer] Native frame render failed; waiting for the next render request to force repaint");
    return "failed";
  }
  scheduleRenderTimer() {
    if (this.renderTimeout || this._isDestroyed || this._controlState === "explicit_suspended" /* EXPLICIT_SUSPENDED */)
      return;
    const now = this.normalizeClockTime(this.clock.now(), this.lastTime);
    const elapsed = this.getElapsedMs(now, this.lastTime);
    const delay = Math.max(this.minTargetFrameTime - elapsed, 0);
    this.renderTimeout = this.clock.setTimeout(() => {
      this.renderTimeout = null;
      this.loop();
    }, delay);
  }
  scheduleRenderAfterBackpressure() {
    if (this._feed) {
      this.scheduleRenderAfterFeedIdle();
      return;
    }
    this.scheduleRenderTimer();
  }
  requestRender() {
    if (this._controlState === "explicit_suspended" /* EXPLICIT_SUSPENDED */) {
      return;
    }
    if (this.feedIdleRenderScheduled) {
      return;
    }
    if (this._isRunning) {
      if (!this.rendering && !this.renderTimeout && !this.ordinaryFrameWaitingForFeed) {
        this.scheduleRenderTimer();
      }
      return;
    }
    if (this.ordinaryFrameWaitingForFeed) {
      return;
    }
    if (this.rendering) {
      this.immediateRerenderRequested = true;
      return;
    }
    if (!this.updateScheduled && !this.renderTimeout) {
      this.updateScheduled = true;
      const now = this.normalizeClockTime(this.clock.now(), this.lastTime);
      const elapsed = this.getElapsedMs(now, this.lastTime);
      const delay = Math.max(this.minTargetFrameTime - elapsed, 0);
      if (delay === 0) {
        process.nextTick(() => this.activateFrame());
        return;
      }
      this.clock.setTimeout(() => this.activateFrame(), delay);
    }
  }
  async activateFrame() {
    if (!this.updateScheduled) {
      this.resolveIdleIfNeeded();
      return;
    }
    try {
      await this.loop();
    } finally {
      this.updateScheduled = false;
      this.resolveIdleIfNeeded();
    }
  }
  get consoleMode() {
    return this._useConsole ? "console-overlay" : "disabled";
  }
  set consoleMode(mode) {
    this._useConsole = mode === "console-overlay";
    if (this._useConsole) {
      this.console.activate();
    } else {
      this.console.deactivate();
    }
  }
  get isRunning() {
    return this._isRunning;
  }
  isIdleNow() {
    if (this._isDestroyed)
      return true;
    return !this._isRunning && !this.rendering && !this.renderTimeout && !this.updateScheduled && !this.feedIdleRenderScheduled && !this.immediateRerenderRequested;
  }
  resolveIdleIfNeeded() {
    if (!this.isIdleNow())
      return;
    const resolvers = this.idleResolvers.splice(0);
    for (const resolve of resolvers) {
      resolve();
    }
  }
  idle() {
    if (this._isDestroyed)
      return Promise.resolve();
    if (this.isIdleNow())
      return Promise.resolve();
    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }
  getSchedulerState() {
    return {
      isRunning: this._isRunning,
      isRendering: this.rendering,
      hasScheduledRender: Boolean(this.renderTimeout || this.updateScheduled || this.immediateRerenderRequested)
    };
  }
  get resolution() {
    return this._resolution;
  }
  get console() {
    return this._console;
  }
  get keyInput() {
    return this._keyHandler;
  }
  get _internalKeyInput() {
    return this._keyHandler;
  }
  get terminalWidth() {
    return this._terminalWidth;
  }
  get terminalHeight() {
    return this._terminalHeight;
  }
  get useThread() {
    return this._useThread;
  }
  get targetFps() {
    return this._targetFps;
  }
  set targetFps(targetFps) {
    this._targetFps = targetFps;
    this.targetFrameTime = 1000 / this._targetFps;
  }
  get maxFps() {
    return this._maxFps;
  }
  set maxFps(maxFps) {
    this._maxFps = maxFps;
    this.minTargetFrameTime = 1000 / this._maxFps;
  }
  get useMouse() {
    return this._useMouse;
  }
  set useMouse(useMouse) {
    if (this._useMouse === useMouse)
      return;
    this._useMouse = useMouse;
    if (useMouse) {
      this.enableMouse();
      this.requestRender();
    } else {
      this.disableMouse();
    }
  }
  get screenMode() {
    return this._screenMode;
  }
  set screenMode(mode) {
    if (this.externalOutputMode === "capture-stdout" && mode !== "split-footer") {
      if (this.pendingExternalOutputMode === "passthrough") {
        this.flushPendingSplitOutputBeforeLeavingSplitFooter();
      }
      if (this.externalOutputMode !== "capture-stdout") {
        this.applyScreenMode(mode);
        return;
      }
      throw new Error('externalOutputMode "capture-stdout" requires screenMode "split-footer"');
    }
    this.applyScreenMode(mode);
  }
  get footerHeight() {
    return this._footerHeight;
  }
  set footerHeight(footerHeight) {
    const normalizedFooterHeight = normalizeFooterHeight(footerHeight);
    if (normalizedFooterHeight === this._footerHeight) {
      return;
    }
    this._footerHeight = normalizedFooterHeight;
    if (this.screenMode === "split-footer") {
      this.applyScreenMode("split-footer");
    }
  }
  get externalOutputMode() {
    return this._externalOutputMode;
  }
  set externalOutputMode(mode) {
    if (mode === "capture-stdout" && this.screenMode !== "split-footer") {
      throw new Error('externalOutputMode "capture-stdout" requires screenMode "split-footer"');
    }
    const previousMode = this._externalOutputMode;
    if (previousMode === mode) {
      if (this.pendingExternalOutputMode !== null && this.pendingExternalOutputMode !== mode) {
        this.pendingExternalOutputMode = null;
      }
      return;
    }
    const canFlushSplitOutputBeforeTransition = this.canFlushSplitOutputBeforeTransition();
    const isSplitCaptureToPassthrough = previousMode === "capture-stdout" && mode === "passthrough" && this._screenMode === "split-footer" && this._splitHeight > 0;
    if (isSplitCaptureToPassthrough && this.externalOutputQueue.size > 0 && !canFlushSplitOutputBeforeTransition) {
      this.pendingExternalOutputMode = "passthrough";
      return;
    }
    if (isSplitCaptureToPassthrough && canFlushSplitOutputBeforeTransition) {
      this.flushPendingSplitOutputBeforeTransition();
    }
    this.pendingExternalOutputMode = null;
    this.applyExternalOutputMode(mode);
    this.afterExternalOutputModeChanged(previousMode, mode);
  }
  applyExternalOutputMode(mode) {
    this._externalOutputMode = mode;
    this.stdout.write = mode === "capture-stdout" ? this.interceptStdoutWrite : this.realStdoutWrite;
  }
  afterExternalOutputModeChanged(previousMode, mode) {
    if (this._screenMode === "split-footer" && this._splitHeight > 0 && mode === "capture-stdout") {
      const previousSurfaceTopLine = this.renderOffset + 1;
      const previousSurfaceHeight = this._splitHeight;
      this.clearPendingSplitFooterTransition();
      this.resetSplitScrollback(this.getSplitCursorSeedRows());
      if (previousMode === "passthrough" && this._terminalIsSetup) {
        const nextSurfaceTopLine = this.renderOffset + 1;
        if (previousSurfaceTopLine !== nextSurfaceTopLine) {
          this.setPendingSplitFooterTransition({
            mode: "clear-stale-rows",
            sourceTopLine: previousSurfaceTopLine,
            sourceHeight: previousSurfaceHeight,
            targetTopLine: nextSurfaceTopLine,
            targetHeight: this._splitHeight,
            scrollLines: 0
          });
          this.forceFullRepaintRequested = true;
        }
      }
      this.requestRender();
      return;
    }
    if (this._screenMode === "split-footer" && this._splitHeight > 0 && previousMode === "capture-stdout" && mode === "passthrough") {
      this.clearPendingSplitFooterTransition();
      return;
    }
    this.syncSplitFooterState();
  }
  applyPendingExternalOutputModeIfReady() {
    const pendingMode = this.pendingExternalOutputMode;
    if (pendingMode === null || this.externalOutputQueue.size > 0) {
      return;
    }
    const previousMode = this._externalOutputMode;
    this.pendingExternalOutputMode = null;
    if (previousMode === pendingMode) {
      return;
    }
    this.applyExternalOutputMode(pendingMode);
    this.afterExternalOutputModeChanged(previousMode, pendingMode);
  }
  flushPendingSplitOutputBeforeLeavingSplitFooter() {
    if (this.pendingExternalOutputMode !== "passthrough") {
      return;
    }
    if (this.isSplitCursorSeedFrameBlocked() && this._controlState !== "explicit_suspended" /* EXPLICIT_SUSPENDED */) {
      this.abortSplitStartupCursorSeed();
    }
    this.flushPendingSplitOutputBeforeTransition();
    if (this.pendingExternalOutputMode !== null) {
      throw new Error("Cannot leave split-footer while captured output is pending");
    }
  }
  get liveRequestCount() {
    return this.liveRequestCounter;
  }
  get currentControlState() {
    return this._controlState;
  }
  get capabilities() {
    return this._capabilities;
  }
  triggerNotification(message, title) {
    if (this._isDestroyed)
      return false;
    return this.lib.triggerNotification(this.rendererPtr, message, title);
  }
  get themeMode() {
    return this.themeModeState.themeMode;
  }
  waitForThemeMode(timeoutMs = 1000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new Error("timeoutMs must be a non-negative finite number");
    }
    return this.themeModeState.waitForThemeMode(timeoutMs, this._isDestroyed);
  }
  getDebugInputs() {
    return [...this._debugInputs];
  }
  get useKittyKeyboard() {
    return this.lib.getKittyKeyboardFlags(this.rendererPtr) > 0;
  }
  set useKittyKeyboard(use) {
    const flags = use ? KITTY_FLAG_DISAMBIGUATE | KITTY_FLAG_ALTERNATE_KEYS : 0;
    this.lib.setKittyKeyboardFlags(this.rendererPtr, flags);
  }
  createScrollbackSurface(options = {}) {
    if (this._screenMode !== "split-footer" || this._externalOutputMode !== "capture-stdout") {
      throw new Error('createScrollbackSurface requires screenMode "split-footer" and externalOutputMode "capture-stdout"');
    }
    const renderer = this;
    const surfaceId = scrollbackSurfaceCounter++;
    const startOnNewLine = options.startOnNewLine ?? true;
    const tailColumn = renderer.getPendingSplitTailColumn();
    const firstLineOffset = !startOnNewLine && tailColumn > 0 && tailColumn < renderer.width ? tailColumn : 0;
    const snapshotContext = new ScrollbackSnapshotRenderContext(renderer.width, 1, renderer.widthMethod);
    let firstLineOffsetOwner = null;
    const renderContext = Object.create(snapshotContext);
    Object.defineProperty(renderContext, "claimFirstLineOffset", {
      value: (renderable) => {
        if (firstLineOffsetOwner?.isDestroyed) {
          firstLineOffsetOwner = null;
        }
        if (firstLineOffsetOwner) {
          return 0;
        }
        firstLineOffsetOwner = renderable ?? null;
        return firstLineOffset;
      },
      enumerable: true,
      configurable: true
    });
    const internalRoot = new RootRenderable(renderContext);
    const publicRoot = new BoxRenderable(renderContext, {
      id: `scrollback-surface-root-${surfaceId}`,
      position: "absolute",
      left: 0,
      top: 0,
      width: renderer.width,
      height: "auto",
      border: false,
      backgroundColor: "transparent",
      shouldFill: false,
      flexDirection: "column"
    });
    internalRoot.add(publicRoot);
    let surfaceWidth = renderer.width;
    let surfaceHeight = 1;
    let surfaceWidthMethod = renderer.widthMethod;
    let surfaceDestroyed = false;
    let hasRendered = false;
    let nextCommitStartOnNewLine = startOnNewLine;
    let backingBuffer = OptimizedBuffer.create(surfaceWidth, surfaceHeight, surfaceWidthMethod, {
      id: `scrollback-surface-buffer-${surfaceId}`
    });
    const destroyListener = () => {
      destroySurface();
    };
    const assertNotDestroyed = () => {
      if (surfaceDestroyed) {
        throw new Error("ScrollbackSurface is destroyed");
      }
    };
    const assertRendered = () => {
      if (!hasRendered) {
        throw new Error("ScrollbackSurface.commitRows requires render() before commitRows()");
      }
    };
    const assertGeometryStillCurrent = () => {
      if (renderer.width !== surfaceWidth || renderer.widthMethod !== surfaceWidthMethod) {
        throw new Error("ScrollbackSurface.commitRows requires render() after renderer geometry changes");
      }
    };
    const assertRowRange = (startRow, endRowExclusive) => {
      if (!Number.isInteger(startRow) || !Number.isInteger(endRowExclusive)) {
        throw new Error("ScrollbackSurface.commitRows requires finite integer row bounds");
      }
      if (startRow < 0) {
        throw new Error("ScrollbackSurface.commitRows requires startRow >= 0");
      }
      if (endRowExclusive < startRow) {
        throw new Error("ScrollbackSurface.commitRows requires endRowExclusive >= startRow");
      }
      if (endRowExclusive > surfaceHeight) {
        throw new Error("ScrollbackSurface.commitRows row range exceeds rendered surface height");
      }
    };
    const collectPendingCodeRenderables = (node) => {
      const pending = [];
      if (node instanceof CodeRenderable && node.isHighlighting) {
        pending.push(node);
      }
      for (const child of node.getChildren()) {
        pending.push(...collectPendingCodeRenderables(child));
      }
      return pending;
    };
    const waitForPendingHighlights = async (pending, timeoutMs) => {
      await new Promise((resolve, reject) => {
        let settled = false;
        const timeoutHandle = renderer.clock.setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          reject(new Error("ScrollbackSurface.settle timed out waiting for CodeRenderable highlighting"));
        }, timeoutMs);
        Promise.all(pending.map((renderable) => renderable.highlightingDone)).then(() => {
          if (settled) {
            return;
          }
          settled = true;
          renderer.clock.clearTimeout(timeoutHandle);
          resolve();
        }, (error) => {
          if (settled) {
            return;
          }
          settled = true;
          renderer.clock.clearTimeout(timeoutHandle);
          reject(error);
        });
      });
    };
    const renderSurface = () => {
      assertNotDestroyed();
      const width = renderer.width;
      const widthMethod = renderer.widthMethod;
      snapshotContext.width = width;
      snapshotContext.widthMethod = widthMethod;
      publicRoot.width = width;
      const renderPass = (height) => {
        snapshotContext.height = height;
        internalRoot.resize(width, height);
        backingBuffer.resize(width, height);
        backingBuffer.clear(TRANSPARENT_RGBA);
        snapshotContext.frameId += 1;
        internalRoot.render(backingBuffer, 0);
      };
      let targetHeight = Math.max(1, surfaceHeight);
      if (surfaceWidthMethod !== widthMethod) {
        backingBuffer.destroy();
        backingBuffer = OptimizedBuffer.create(width, targetHeight, widthMethod, {
          id: `scrollback-surface-buffer-${surfaceId}`
        });
      } else {
        backingBuffer.resize(width, targetHeight);
      }
      for (let pass = 0;pass < MAX_SCROLLBACK_SURFACE_HEIGHT_PASSES; pass += 1) {
        renderPass(targetHeight);
        const measuredHeight = Math.max(1, publicRoot.height);
        if (measuredHeight === targetHeight) {
          surfaceWidth = width;
          surfaceHeight = measuredHeight;
          surfaceWidthMethod = widthMethod;
          hasRendered = true;
          return;
        }
        targetHeight = measuredHeight;
      }
      renderPass(targetHeight);
      surfaceWidth = width;
      surfaceHeight = targetHeight;
      surfaceWidthMethod = widthMethod;
      hasRendered = true;
    };
    const settleSurface = async (timeoutMs = 2000) => {
      assertNotDestroyed();
      const startedAt = renderer.clock.now();
      renderSurface();
      while (true) {
        assertNotDestroyed();
        const pending = collectPendingCodeRenderables(publicRoot);
        if (pending.length === 0) {
          return;
        }
        const remainingMs = timeoutMs - (renderer.clock.now() - startedAt);
        if (remainingMs <= 0) {
          throw new Error("ScrollbackSurface.settle timed out waiting for CodeRenderable highlighting");
        }
        await waitForPendingHighlights(pending, remainingMs);
        assertNotDestroyed();
        renderSurface();
      }
    };
    const commitRows = (startRow, endRowExclusive, commitOptions = {}) => {
      assertNotDestroyed();
      assertRendered();
      assertGeometryStillCurrent();
      assertRowRange(startRow, endRowExclusive);
      if (startRow === endRowExclusive) {
        return;
      }
      const rowCount = endRowExclusive - startRow;
      const commitBuffer = OptimizedBuffer.create(surfaceWidth, rowCount, surfaceWidthMethod, {
        id: `scrollback-surface-commit-${surfaceId}`
      });
      try {
        commitBuffer.drawFrameBuffer(0, 0, backingBuffer, 0, startRow, surfaceWidth, rowCount);
        renderer.enqueueRenderedScrollbackCommit({
          snapshot: commitBuffer,
          rowColumns: commitOptions.rowColumns,
          startOnNewLine: nextCommitStartOnNewLine,
          trailingNewline: commitOptions.trailingNewline ?? true
        });
        nextCommitStartOnNewLine = false;
      } catch (error) {
        commitBuffer.destroy();
        throw error;
      }
    };
    const destroySurface = () => {
      if (surfaceDestroyed) {
        return;
      }
      surfaceDestroyed = true;
      renderer.off("destroy" /* DESTROY */, destroyListener);
      let destroyError = null;
      try {
        internalRoot.destroyRecursively();
      } catch (error) {
        destroyError = error;
      }
      try {
        backingBuffer.destroy();
      } catch (error) {
        if (destroyError === null) {
          destroyError = error;
        }
      }
      renderContext.removeAllListeners();
      snapshotContext.removeAllListeners();
      if (destroyError !== null) {
        throw destroyError;
      }
    };
    renderer.on("destroy" /* DESTROY */, destroyListener);
    return {
      get renderContext() {
        return renderContext;
      },
      get root() {
        return publicRoot;
      },
      get width() {
        return surfaceWidth;
      },
      get height() {
        return surfaceHeight;
      },
      get isDestroyed() {
        return surfaceDestroyed;
      },
      render: renderSurface,
      settle: settleSurface,
      commitRows,
      destroy: destroySurface
    };
  }
  writeToScrollback(write) {
    if (this._screenMode !== "split-footer" || this._externalOutputMode !== "capture-stdout") {
      throw new Error('writeToScrollback requires screenMode "split-footer" and externalOutputMode "capture-stdout"');
    }
    const snapshotContext = new ScrollbackSnapshotRenderContext(this.width, this.height, this.widthMethod);
    const snapshot = write({
      width: this.width,
      widthMethod: this.widthMethod,
      tailColumn: this.getPendingSplitTailColumn(),
      renderContext: snapshotContext
    });
    if (!snapshot || !snapshot.root) {
      throw new Error("writeToScrollback must return a snapshot root renderable");
    }
    let renderFailed = false;
    let snapshotRoot = null;
    let snapshotBuffer = null;
    try {
      const rootRenderable = snapshot.root;
      const snapshotWidth = this.getSnapshotWidth(snapshot.width, rootRenderable.width);
      const snapshotHeight = this.getSnapshotHeight(snapshot.height, rootRenderable.height);
      snapshotContext.width = snapshotWidth;
      snapshotContext.height = snapshotHeight;
      snapshotContext.widthMethod = this.widthMethod;
      snapshotRoot = new RootRenderable(snapshotContext);
      snapshotBuffer = OptimizedBuffer.create(snapshotWidth, snapshotHeight, this.widthMethod, {
        id: "scrollback-snapshot-commit"
      });
      snapshotRoot.add(rootRenderable);
      snapshotRoot.render(snapshotBuffer, 0);
      this.enqueueRenderedScrollbackCommit({
        snapshot: snapshotBuffer,
        rowColumns: snapshot.rowColumns,
        startOnNewLine: snapshot.startOnNewLine,
        trailingNewline: snapshot.trailingNewline
      });
    } catch (error) {
      renderFailed = true;
      snapshotBuffer?.destroy();
      throw error;
    } finally {
      let cleanupError = null;
      try {
        if (snapshotRoot) {
          snapshotRoot.destroyRecursively();
        } else {
          snapshot.root.destroyRecursively();
        }
      } catch (error) {
        cleanupError = error;
      }
      try {
        snapshot.teardown?.();
      } catch (error) {
        if (cleanupError === null) {
          cleanupError = error;
        }
      }
      if (!renderFailed && cleanupError) {
        throw cleanupError;
      }
    }
  }
  resetSplitFooterForReplay(options = {}) {
    if (this._isDestroyed)
      return;
    if (this._screenMode !== "split-footer" || this._externalOutputMode !== "capture-stdout") {
      throw new Error('resetSplitFooterForReplay requires screenMode "split-footer" and externalOutputMode "capture-stdout"');
    }
    if (!this._terminalIsSetup || this._controlState === "explicit_suspended" /* EXPLICIT_SUSPENDED */) {
      throw new Error("resetSplitFooterForReplay requires an active terminal");
    }
    this.flushPendingSplitOutputBeforeTransition(true);
    this.externalOutputQueue.clear();
    this.abortSplitStartupCursorSeed();
    this.clearPendingSplitFooterTransition();
    this.resetSplitScrollback();
    this.currentRenderBuffer.clear(this.backgroundColor);
    this.nextRenderBuffer.clear(this.backgroundColor);
    this.forceFullRepaintRequested = true;
    this.writeOut(ANSI.resetScrollRegion + ANSI.reset + ANSI.home + ANSI.clearScreen + (options.clearSavedLines ? ANSI.clearSavedLines : "") + ANSI.home);
    this.requestRender();
  }
  getSnapshotWidth(value, fallback) {
    const rawValue = value ?? fallback;
    if (!Number.isFinite(rawValue)) {
      throw new Error("writeToScrollback produced a non-finite width");
    }
    return Math.min(Math.max(Math.trunc(rawValue), 1), Math.max(this.width, 1));
  }
  getSnapshotHeight(value, fallback) {
    const rawValue = value ?? fallback;
    if (!Number.isFinite(rawValue)) {
      throw new Error("writeToScrollback produced a non-finite height");
    }
    return Math.max(Math.trunc(rawValue), 1);
  }
  getSnapshotRowWidths(snapshot, rowColumns) {
    const widths = [];
    const limit = Math.min(Math.max(Math.trunc(rowColumns), 0), snapshot.width);
    const chars = snapshot.buffers.char;
    for (let y = 0;y < snapshot.height; y += 1) {
      let x = limit;
      while (x > 0) {
        const cp = chars[y * snapshot.width + x - 1];
        if (cp === 0 || (cp & CHAR_FLAG_MASK) === CHAR_FLAG_CONTINUATION) {
          x -= 1;
          continue;
        }
        break;
      }
      widths.push(x);
    }
    return widths;
  }
  advanceSplitTailColumn(tailColumn, columns, width) {
    if (columns <= 0) {
      return tailColumn;
    }
    let tail = tailColumn;
    let remaining = columns;
    while (remaining > 0) {
      if (tail >= width) {
        tail = 0;
      }
      const step = Math.min(remaining, width - tail);
      tail += step;
      remaining -= step;
      if (remaining > 0 && tail >= width) {
        tail = 0;
      }
    }
    return tail;
  }
  getSplitTailColumnAfterCommit(commit, initialTailColumn, width) {
    let tailColumn = initialTailColumn;
    if (commit.startOnNewLine && tailColumn > 0) {
      tailColumn = 0;
    }
    const rowWidths = this.getSnapshotRowWidths(commit.snapshot, commit.rowColumns);
    for (const [index, rowWidth] of rowWidths.entries()) {
      tailColumn = this.advanceSplitTailColumn(tailColumn, rowWidth, width);
      if (index < rowWidths.length - 1 || commit.trailingNewline) {
        tailColumn = 0;
      }
    }
    return tailColumn;
  }
  recordSplitCommit(commit) {
    this.splitTailColumn = this.getSplitTailColumnAfterCommit(commit, this.splitTailColumn, Math.max(this.width, 1));
  }
  getPendingSplitTailColumn() {
    const width = Math.max(this.width, 1);
    let tailColumn = this.splitTailColumn;
    for (const commit of this.externalOutputQueue.peek()) {
      tailColumn = this.getSplitTailColumnAfterCommit(commit, tailColumn, width);
    }
    return tailColumn;
  }
  enqueueRenderedScrollbackCommit(options) {
    if (this._screenMode !== "split-footer" || this._externalOutputMode !== "capture-stdout") {
      throw new Error('scrollback commit requires screenMode "split-footer" and externalOutputMode "capture-stdout"');
    }
    const rowColumns = Math.min(Math.max(Math.trunc(options.rowColumns ?? options.snapshot.width), 0), options.snapshot.width);
    this.enqueueSplitCommit({
      snapshot: options.snapshot,
      rowColumns,
      startOnNewLine: options.startOnNewLine ?? true,
      trailingNewline: options.trailingNewline ?? true
    });
    this.requestRender();
  }
  enqueueSplitCommit(commit) {
    this.externalOutputQueue.writeSnapshot(commit);
    if (this.listenerCount("external_output" /* EXTERNAL_OUTPUT */) > 0) {
      this.emit("external_output" /* EXTERNAL_OUTPUT */, commit);
    }
  }
  createStdoutSnapshotCommit(line, trailingNewline) {
    const snapshotContext = new ScrollbackSnapshotRenderContext(this.width, 1, this.widthMethod);
    const maxWidth = Math.max(1, this.width);
    const lineCells = [...line];
    const rowColumns = Math.min(lineCells.length, maxWidth);
    const renderedLine = lineCells.slice(0, maxWidth).join("");
    const snapshotRoot = new RootRenderable(snapshotContext);
    const snapshotRenderable = new TextRenderable(snapshotContext, {
      id: "captured-stdout-snapshot",
      position: "absolute",
      left: 0,
      top: 0,
      width: Math.max(1, rowColumns),
      height: 1,
      content: renderedLine
    });
    const snapshotBuffer = OptimizedBuffer.create(Math.max(1, rowColumns), 1, this.widthMethod, {
      id: "captured-stdout-snapshot"
    });
    try {
      snapshotRoot.add(snapshotRenderable);
      snapshotRoot.render(snapshotBuffer, 0);
      return {
        snapshot: snapshotBuffer,
        rowColumns,
        startOnNewLine: false,
        trailingNewline
      };
    } catch (error) {
      snapshotBuffer.destroy();
      throw error;
    } finally {
      snapshotRoot.destroyRecursively();
    }
  }
  splitStdoutRows(text) {
    const rows = [];
    let current = "";
    for (const char of text) {
      if (char === "\r") {
        current = "";
        continue;
      }
      if (char === `
`) {
        rows.push({ line: current, trailingNewline: true });
        current = "";
        continue;
      }
      current += char;
    }
    if (current.length > 0) {
      rows.push({ line: current, trailingNewline: false });
    }
    return rows;
  }
  createStdoutSnapshotCommits(text) {
    if (text.length === 0) {
      return [];
    }
    const commits = [];
    const chunkWidth = Math.max(1, this.width);
    for (const row of this.splitStdoutRows(text)) {
      const rowCells = [...row.line];
      if (rowCells.length === 0) {
        commits.push(this.createStdoutSnapshotCommit("", row.trailingNewline));
        continue;
      }
      let offset = 0;
      while (offset < rowCells.length) {
        const chunk = rowCells.slice(offset, offset + chunkWidth).join("");
        offset += chunkWidth;
        const isLastChunk = offset >= rowCells.length;
        commits.push(this.createStdoutSnapshotCommit(chunk, isLastChunk ? row.trailingNewline : false));
      }
    }
    return commits;
  }
  flushPendingSplitCommits(forceFooterRepaint = false, drainAll = false) {
    const commits = this.externalOutputQueue.peek(drainAll ? Number.POSITIVE_INFINITY : this.maxSplitCommitsPerFrame);
    let hasCommittedOutput = false;
    const lastCommitIndex = commits.length - 1;
    let acceptedCommits = 0;
    let nativeBackpressured = false;
    let nativeFailed = false;
    for (const [index, commit] of commits.entries()) {
      const forceCommit = forceFooterRepaint && index === lastCommitIndex;
      const beginFrame = index === 0;
      const finalizeFrame = index === lastCommitIndex;
      const nativeResult = this.lib.commitSplitFooterSnapshot(this.rendererPtr, commit.snapshot, commit.rowColumns, commit.startOnNewLine, commit.trailingNewline, this.getSplitPinnedRenderOffset(), forceCommit, beginFrame, finalizeFrame);
      if (nativeResult.status === NATIVE_RENDER_STATUS_SKIPPED) {
        nativeBackpressured = true;
        break;
      }
      if (nativeResult.status === NATIVE_RENDER_STATUS_FAILED) {
        nativeFailed = true;
        break;
      }
      this.renderOffset = nativeResult.renderOffset;
      this.recordSplitCommit(commit);
      hasCommittedOutput = true;
      acceptedCommits++;
    }
    if (acceptedCommits > 0) {
      this.externalOutputQueue.drop(acceptedCommits);
    }
    if (nativeFailed) {
      return this.reportNativeRenderFailure();
    }
    if (nativeBackpressured) {
      this.scheduleRenderAfterFeedIdle();
      return "backpressured";
    }
    if (!hasCommittedOutput) {
      const nativeResult = this.lib.repaintSplitFooter(this.rendererPtr, this.getSplitPinnedRenderOffset(), forceFooterRepaint);
      if (nativeResult.status === NATIVE_RENDER_STATUS_SKIPPED) {
        this.scheduleRenderAfterFeedIdle();
        return "backpressured";
      }
      if (nativeResult.status === NATIVE_RENDER_STATUS_FAILED) {
        return this.reportNativeRenderFailure();
      }
      this.renderOffset = nativeResult.renderOffset;
    }
    this.pendingSplitFooterTransition = null;
    if (this.externalOutputQueue.size > 0) {
      this.requestRender();
    } else {
      this.applyPendingExternalOutputModeIfReady();
    }
    return "rendered";
  }
  interceptStdoutWrite = (chunk, encoding, callback) => {
    const resolvedCallback = typeof encoding === "function" ? encoding : callback;
    const resolvedEncoding = typeof encoding === "string" ? encoding : undefined;
    const text = typeof chunk === "string" ? chunk : chunk?.toString(resolvedEncoding) ?? "";
    if (this._externalOutputMode === "capture-stdout" && this._screenMode === "split-footer" && this._splitHeight > 0) {
      const commits = this.createStdoutSnapshotCommits(text);
      for (const commit of commits) {
        this.enqueueSplitCommit(commit);
      }
      if (commits.length > 0) {
        this.requestRender();
      }
    }
    if (typeof resolvedCallback === "function") {
      process.nextTick(resolvedCallback);
    }
    return true;
  };
  getSplitPinnedRenderOffset() {
    return this._screenMode === "split-footer" ? Math.max(this._terminalHeight - this._splitHeight, 0) : 0;
  }
  getSplitCursorSeedRows() {
    const cursorState = this.lib.getCursorState(this.rendererPtr);
    const cursorRow = Number.isFinite(cursorState.y) ? Math.max(Math.trunc(cursorState.y), 1) : 1;
    return Math.min(cursorRow, Math.max(this._terminalHeight, 1));
  }
  isSplitCursorSeedFrameBlocked() {
    return this._screenMode === "split-footer" && this._externalOutputMode === "capture-stdout" && this._splitHeight > 0 && this.pendingSplitStartupCursorSeed && this.splitStartupSeedTimeoutId !== null;
  }
  canFlushSplitOutputBeforeTransition(allowSuspended = false, allowUnsetup = false) {
    return (this._terminalIsSetup || allowUnsetup) && (allowSuspended || this._controlState !== "explicit_suspended" /* EXPLICIT_SUSPENDED */) && !this.isSplitCursorSeedFrameBlocked();
  }
  clearSplitStartupCursorSeed() {
    this.pendingSplitStartupCursorSeed = false;
    if (this.splitStartupSeedTimeoutId !== null) {
      this.clock.clearTimeout(this.splitStartupSeedTimeoutId);
      this.splitStartupSeedTimeoutId = null;
    }
  }
  abortSplitStartupCursorSeed() {
    this.clearSplitStartupCursorSeed();
    this.stdinParser?.abortPendingStartupCursorCpr();
    this.updateStdinParserProtocolContext({ startupCursorCprActive: false });
  }
  flushPendingSplitOutputBeforeTransition(forceFooterRepaint = false, options = {}) {
    const hasDeferredCapturedOutput = this.externalOutputQueue.size > 0 || this.pendingExternalOutputMode !== null;
    if (this._screenMode !== "split-footer" || this._splitHeight <= 0 || this._externalOutputMode !== "capture-stdout" && !(options.allowPassthrough && hasDeferredCapturedOutput)) {
      return;
    }
    if (!this.canFlushSplitOutputBeforeTransition(options.allowSuspended ?? false, options.allowUnsetup ?? false)) {
      return;
    }
    if (this.externalOutputQueue.size === 0 && !forceFooterRepaint) {
      this.applyPendingExternalOutputModeIfReady();
      return;
    }
    this.flushPendingSplitCommits(this._externalOutputMode === "capture-stdout" ? forceFooterRepaint : false, true);
  }
  resetSplitScrollback(seedRows = 0) {
    this.splitTailColumn = 0;
    this.renderOffset = this.lib.resetSplitScrollback(this.rendererPtr, seedRows, this.getSplitPinnedRenderOffset());
  }
  syncSplitScrollback() {
    this.renderOffset = this.lib.syncSplitScrollback(this.rendererPtr, this.getSplitPinnedRenderOffset());
  }
  getSplitOutputOffset(surfaceOffset = this.renderOffset) {
    return this.lib.getSplitOutputOffset(this.rendererPtr, surfaceOffset);
  }
  clearPendingSplitFooterTransition() {
    if (this.pendingSplitFooterTransition === null) {
      return;
    }
    this.pendingSplitFooterTransition = null;
    this.lib.clearPendingSplitFooterTransition(this.rendererPtr);
  }
  setPendingSplitFooterTransition(transition) {
    this.pendingSplitFooterTransition = transition;
    this.lib.setPendingSplitFooterTransition(this.rendererPtr, transition.mode === "viewport-scroll" ? 1 : 2, transition.sourceTopLine, transition.sourceHeight, transition.targetTopLine, transition.targetHeight, transition.scrollLines ?? 0);
  }
  syncSplitFooterState() {
    const splitActive = this._screenMode === "split-footer" && this._splitHeight > 0;
    if (!splitActive) {
      this.clearPendingSplitFooterTransition();
      this.splitTailColumn = 0;
      this.lib.resetSplitScrollback(this.rendererPtr, 0, 0);
      this.renderOffset = 0;
      this.lib.setRenderOffset(this.rendererPtr, this.renderOffset);
      return;
    }
    if (this._externalOutputMode === "capture-stdout") {
      this.syncSplitScrollback();
    } else {
      this.clearPendingSplitFooterTransition();
      this.splitTailColumn = 0;
      this.lib.resetSplitScrollback(this.rendererPtr, 0, 0);
      this.renderOffset = this.getSplitPinnedRenderOffset();
      this.lib.setRenderOffset(this.rendererPtr, this.renderOffset);
    }
  }
  clearStaleSplitSurfaceRows(previousTopLine, previousHeight, nextTopLine, nextHeight) {
    if (!this._terminalIsSetup || previousHeight <= 0 || this._terminalHeight <= 0) {
      return;
    }
    const terminalBottom = this._terminalHeight;
    const previousStart = Math.max(1, previousTopLine);
    const previousEnd = Math.min(terminalBottom, previousTopLine + previousHeight - 1);
    if (previousEnd < previousStart) {
      return;
    }
    const nextStart = Math.max(1, nextTopLine);
    const nextEnd = Math.min(terminalBottom, nextTopLine + Math.max(nextHeight, 0) - 1);
    let clear = "";
    for (let line = previousStart;line <= previousEnd; line += 1) {
      if (line >= nextStart && line <= nextEnd) {
        continue;
      }
      clear += `${ANSI.moveCursor(line, 1)}\x1B[2K`;
    }
    if (clear.length > 0) {
      this.writeOut(clear);
    }
  }
  applyScreenMode(screenMode, emitResize = true, requestRender = true) {
    const prevScreenMode = this._screenMode;
    const prevSplitHeight = this._splitHeight;
    const nextGeometry = calculateRenderGeometry(screenMode, this._terminalWidth, this._terminalHeight, this._footerHeight);
    const nextSplitHeight = nextGeometry.effectiveFooterHeight;
    if (prevScreenMode === screenMode && prevSplitHeight === nextSplitHeight) {
      return;
    }
    const terminalWritable = this._terminalIsSetup && this._controlState !== "explicit_suspended" /* EXPLICIT_SUSPENDED */;
    const prevUseAlternateScreen = prevScreenMode === "alternate-screen";
    const nextUseAlternateScreen = screenMode === "alternate-screen";
    const terminalScreenModeChanged = this._terminalIsSetup && prevUseAlternateScreen !== nextUseAlternateScreen;
    const leavingSplitFooter = prevSplitHeight > 0 && nextSplitHeight === 0;
    if (terminalWritable && prevSplitHeight > 0) {
      this.flushPendingSplitOutputBeforeTransition();
    }
    const previousSurfaceTopLine = this.renderOffset + 1;
    const shouldDeferSplitFooterResizeTransition = this._terminalIsSetup && prevScreenMode === "split-footer" && screenMode === "split-footer" && this._externalOutputMode === "capture-stdout" && prevSplitHeight > 0 && nextSplitHeight > 0 && !terminalScreenModeChanged;
    const splitStartupSeedBlocksFirstNativeFrame = this.pendingSplitStartupCursorSeed && this.splitStartupSeedTimeoutId !== null;
    const splitTransitionSourceTopLine = this.pendingSplitFooterTransition?.sourceTopLine ?? previousSurfaceTopLine;
    const splitTransitionSourceHeight = this.pendingSplitFooterTransition?.sourceHeight ?? prevSplitHeight;
    const splitTransitionSourceSurfaceOffset = Math.max(splitTransitionSourceTopLine - 1, 0);
    const splitTransitionSourceOutputOffset = prevScreenMode === "split-footer" && prevSplitHeight > 0 && this._externalOutputMode === "capture-stdout" ? this.getSplitOutputOffset(splitTransitionSourceSurfaceOffset) : splitTransitionSourceSurfaceOffset;
    const nextPinnedRenderOffset = nextGeometry.renderOffset;
    const nextSplitOutputOffset = screenMode === "split-footer" && nextSplitHeight > 0 && this._externalOutputMode === "capture-stdout" ? this.getSplitOutputOffset(nextPinnedRenderOffset) : nextPinnedRenderOffset;
    const pendingSplitFooterTransition = this.pendingSplitFooterTransition;
    const pendingSplitFooterReturn = pendingSplitFooterTransition !== null && nextSplitHeight === splitTransitionSourceHeight;
    const pendingSplitFooterViewportReturn = pendingSplitFooterReturn && pendingSplitFooterTransition.mode === "viewport-scroll" && (pendingSplitFooterTransition.scrollLines ?? 0) > 0;
    const shrinkingSplitFooter = nextSplitHeight > 0 && nextSplitHeight < splitTransitionSourceHeight;
    const growingSplitFooter = nextSplitHeight > splitTransitionSourceHeight && splitTransitionSourceHeight > 0;
    const nextSplitSurfaceOffset = screenMode !== "split-footer" || nextSplitHeight === 0 ? 0 : pendingSplitFooterViewportReturn ? pendingSplitFooterTransition.targetTopLine - 1 : pendingSplitFooterReturn ? splitTransitionSourceSurfaceOffset : shrinkingSplitFooter && splitTransitionSourceSurfaceOffset > 0 ? splitTransitionSourceSurfaceOffset : shrinkingSplitFooter ? nextSplitOutputOffset : growingSplitFooter ? Math.max(nextSplitOutputOffset, Math.min(splitTransitionSourceSurfaceOffset, nextPinnedRenderOffset)) : nextPinnedRenderOffset;
    const splitTransitionTargetTopLine = nextSplitSurfaceOffset + 1;
    const splitViewportScrollLines = pendingSplitFooterViewportReturn ? pendingSplitFooterTransition.scrollLines ?? 0 : nextSplitHeight > 0 && !pendingSplitFooterReturn ? Math.max(splitTransitionSourceOutputOffset - nextSplitOutputOffset, 0) : 0;
    const splitTransitionMode = (!shrinkingSplitFooter || pendingSplitFooterViewportReturn) && splitViewportScrollLines > 0 ? "viewport-scroll" : "clear-stale-rows";
    const splitFooterSurfaceMovesDown = nextSplitSurfaceOffset > splitTransitionSourceSurfaceOffset;
    const splitFooterSurfaceLeavesStaleRows = splitFooterSurfaceMovesDown || shrinkingSplitFooter;
    const shouldClearSplitSurfaceRowsImmediately = terminalWritable && !terminalScreenModeChanged && !shouldDeferSplitFooterResizeTransition && splitFooterSurfaceLeavesStaleRows && nextSplitHeight > 0;
    if (terminalWritable && leavingSplitFooter) {
      this.clearPendingSplitFooterTransition();
      this.renderOffset = 0;
      this.lib.setRenderOffset(this.rendererPtr, 0);
    }
    if (terminalWritable && !terminalScreenModeChanged && !shouldDeferSplitFooterResizeTransition) {
      if (prevSplitHeight === 0 && nextSplitHeight > 0) {
        const freedLines = this._terminalHeight - nextSplitHeight;
        const scrollDown = ANSI.scrollDown(freedLines);
        this.writeOut(scrollDown);
      } else if (splitViewportScrollLines > 0) {
        const additionalLines = splitViewportScrollLines;
        const scrollUp = ANSI.scrollUp(additionalLines);
        this.writeOut(scrollUp);
      }
    }
    this._screenMode = screenMode;
    this._splitHeight = nextSplitHeight;
    this.width = nextGeometry.renderWidth;
    this.height = nextGeometry.renderHeight;
    this.lib.resizeRenderer(this.rendererPtr, this.width, this.height);
    if (this._screenMode === "split-footer" && this._externalOutputMode === "capture-stdout") {
      if (prevScreenMode !== "split-footer") {
        this.resetSplitScrollback(this.getSplitCursorSeedRows());
      } else {
        this.renderOffset = nextSplitSurfaceOffset;
        this.lib.setRenderOffset(this.rendererPtr, this.renderOffset);
      }
      if (shouldDeferSplitFooterResizeTransition) {
        if (splitStartupSeedBlocksFirstNativeFrame) {
          this.clearPendingSplitFooterTransition();
        } else {
          this.setPendingSplitFooterTransition({
            mode: splitTransitionMode,
            sourceTopLine: splitTransitionSourceTopLine,
            sourceHeight: splitTransitionSourceHeight,
            targetTopLine: splitTransitionTargetTopLine,
            targetHeight: nextSplitHeight,
            scrollLines: splitViewportScrollLines
          });
        }
        this.forceFullRepaintRequested = true;
      } else if (shouldClearSplitSurfaceRowsImmediately) {
        this.clearPendingSplitFooterTransition();
        this.clearStaleSplitSurfaceRows(splitTransitionSourceTopLine, splitTransitionSourceHeight, splitTransitionTargetTopLine, nextSplitHeight);
      } else {
        this.clearPendingSplitFooterTransition();
      }
    } else {
      this.syncSplitFooterState();
      if (shouldClearSplitSurfaceRowsImmediately) {
        this.clearStaleSplitSurfaceRows(splitTransitionSourceTopLine, splitTransitionSourceHeight, this.renderOffset + 1, nextSplitHeight);
      }
    }
    this.nextRenderBuffer = this.lib.getNextBuffer(this.rendererPtr);
    this.currentRenderBuffer = this.lib.getCurrentBuffer(this.rendererPtr);
    this._console.resize(this.width, this.height);
    this.root.resize(this.width, this.height);
    if (terminalScreenModeChanged) {
      if (terminalWritable) {
        this.lib.suspendRenderer(this.rendererPtr);
        this.lib.setupTerminal(this.rendererPtr, nextUseAlternateScreen);
        this.pendingSuspendedTerminalSetup = false;
      } else {
        this.pendingSuspendedTerminalSetup = true;
      }
      if (terminalWritable && this._useMouse) {
        this.enableMouse();
      }
    }
    if (emitResize) {
      this.emit("resize" /* RESIZE */, this.width, this.height);
    }
    if (requestRender) {
      this.requestRender();
    }
  }
  flushStdoutCache(space, force = false) {
    if (this.externalOutputQueue.size === 0 && !force)
      return false;
    const outputCommits = this.externalOutputQueue.claim();
    let output = "";
    for (const commit of outputCommits) {
      output += `[snapshot ${commit.snapshot.width}x${commit.snapshot.height}]
`;
      commit.snapshot.destroy();
    }
    const rendererStartLine = this.renderOffset + 1;
    const flush = ANSI.moveCursorAndClear(rendererStartLine, 1);
    const outputLine = this.renderOffset + 1;
    const move = ANSI.moveCursor(outputLine, 1);
    let clear = "";
    if (space > 0) {
      const backgroundColor = this.backgroundColor.toInts();
      const newlines = " ".repeat(this.width) + `
`.repeat(space);
      if (backgroundColor[3] === 0) {
        clear = newlines;
      } else {
        clear = ANSI.setRgbBackground(backgroundColor[0], backgroundColor[1], backgroundColor[2]) + newlines + ANSI.resetBackground;
      }
    }
    this.writeOut(flush + move + output + clear);
    return true;
  }
  enableMouse() {
    this._useMouse = true;
    this.lib.enableMouse(this.rendererPtr, this.enableMouseMovement);
  }
  disableMouse() {
    this._useMouse = false;
    this.setCapturedRenderable(undefined);
    this.stdinParser?.resetMouseState();
    this.lib.disableMouse(this.rendererPtr);
  }
  enableKittyKeyboard(flags = 3) {
    this.lib.enableKittyKeyboard(this.rendererPtr, flags);
    this.updateStdinParserProtocolContext({ kittyKeyboardEnabled: true });
  }
  disableKittyKeyboard() {
    this.lib.disableKittyKeyboard(this.rendererPtr);
    this.updateStdinParserProtocolContext({ kittyKeyboardEnabled: false }, true);
  }
  set useThread(useThread) {
    this._useThread = useThread;
    this.lib.setUseThread(this.rendererPtr, useThread);
  }
  async setupTerminal() {
    if (this._terminalIsSetup)
      return;
    this._terminalIsSetup = true;
    const startupCursorCprActive = this._screenMode === "split-footer" && this._externalOutputMode === "capture-stdout";
    this.updateStdinParserProtocolContext({
      privateCapabilityRepliesActive: true,
      explicitWidthCprActive: true,
      startupCursorCprActive
    });
    this.lib.setupTerminal(this.rendererPtr, this._screenMode === "alternate-screen");
    this._capabilities = this.lib.getTerminalCapabilities(this.rendererPtr);
    if (this.debugOverlay.enabled) {
      this.lib.setDebugOverlay(this.rendererPtr, true, this.debugOverlay.corner);
      if (!this.memorySnapshotInterval) {
        this.memorySnapshotInterval = 3000;
        this.startMemorySnapshotTimer();
        this.automaticMemorySnapshot = true;
      }
    }
    this.capabilityTimeoutId = this.clock.setTimeout(() => {
      this.capabilityTimeoutId = null;
      this.clearSplitStartupCursorSeed();
      if (this._screenMode === "split-footer" && this._externalOutputMode === "capture-stdout") {
        this.requestRender();
      }
      this.removeInputHandler(this.capabilityHandler);
      this.updateStdinParserProtocolContext({
        privateCapabilityRepliesActive: false,
        explicitWidthCprActive: false,
        startupCursorCprActive: false
      }, true);
      this.resolveXtVersionWaiters();
    }, 5000);
    if (this._useMouse) {
      this.enableMouse();
    }
    if (this._screenMode === "split-footer" && this._externalOutputMode === "capture-stdout") {
      this.pendingSplitStartupCursorSeed = true;
      if (this.splitStartupSeedTimeoutId !== null) {
        this.clock.clearTimeout(this.splitStartupSeedTimeoutId);
      }
      this.splitStartupSeedTimeoutId = this.clock.setTimeout(() => {
        this.splitStartupSeedTimeoutId = null;
        if (!this.pendingSplitStartupCursorSeed) {
          return;
        }
        this.updateStdinParserProtocolContext({ startupCursorCprActive: false });
        if (this._screenMode === "split-footer" && this._externalOutputMode === "capture-stdout") {
          this.requestRender();
        }
        this.flushPendingSplitOutputBeforeTransition(false, { allowPassthrough: true });
      }, 120);
    }
    this.queryPixelResolution();
    if (this.shouldSyncNativePaletteState()) {
      this.refreshPalette();
    }
    if (this._feed?.isBackpressured()) {
      await this._feed.idle();
    }
  }
  stdinListener = ((chunk) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (!this.stdinParser)
      return;
    try {
      this.stdinParser.push(data);
      this.drainStdinParser();
    } catch (error) {
      this.handleStdinParserFailure(error);
    }
  }).bind(this);
  addInputHandler(handler) {
    this.sequenceHandlers.push(handler);
  }
  prependInputHandler(handler) {
    this.sequenceHandlers.unshift(handler);
  }
  removeInputHandler(handler) {
    this.sequenceHandlers = this.sequenceHandlers.filter((candidate) => candidate !== handler);
  }
  updateStdinParserProtocolContext(patch, drain = false) {
    if (!this.stdinParser)
      return;
    this.stdinParser.updateProtocolContext(patch);
    if (drain)
      this.drainStdinParser();
  }
  subscribeOsc(handler) {
    this.oscSubscribers.add(handler);
    return () => {
      this.oscSubscribers.delete(handler);
    };
  }
  processCapabilitySequence(sequence, hasCursorReport) {
    const hasStandardCapabilitySignature = isCapabilityResponse(sequence);
    const shouldProcessAsCapability = hasStandardCapabilitySignature || hasCursorReport && this.capabilityTimeoutId !== null;
    if (!shouldProcessAsCapability) {
      return false;
    }
    this.lib.processCapabilityResponse(this.rendererPtr, sequence);
    this._capabilities = this.lib.getTerminalCapabilities(this.rendererPtr);
    if (this._capabilities?.terminal?.from_xtversion) {
      this.resolveXtVersionWaiters();
    }
    if (hasStandardCapabilitySignature) {
      this.forceFullRepaintRequested = true;
      this.requestRender();
    }
    this.emit("capabilities" /* CAPABILITIES */, this._capabilities);
    const hadPendingSplitStartupCursorSeed = this.pendingSplitStartupCursorSeed;
    if (hadPendingSplitStartupCursorSeed && hasCursorReport && this._screenMode === "split-footer" && this._externalOutputMode === "capture-stdout") {
      this.resetSplitScrollback(this.getSplitCursorSeedRows());
      this.clearPendingSplitFooterTransition();
      this.clearSplitStartupCursorSeed();
      this.updateStdinParserProtocolContext({ startupCursorCprActive: false });
      this.requestRender();
      if (this.pendingExternalOutputMode === "passthrough") {
        this.flushPendingSplitOutputBeforeTransition();
      }
    }
    const consumeStartupCursorReport = hadPendingSplitStartupCursorSeed && hasCursorReport && this.splitStartupSeedTimeoutId !== null;
    return hasStandardCapabilitySignature || consumeStartupCursorReport;
  }
  capabilityHandler = ((sequence) => {
    return this.processCapabilitySequence(sequence, false);
  }).bind(this);
  focusHandler = ((sequence) => {
    if (sequence === "\x1B[I") {
      if (this.shouldRestoreModesOnNextFocus) {
        this.lib.restoreTerminalModes(this.rendererPtr);
        this.shouldRestoreModesOnNextFocus = false;
      }
      if (this._terminalFocusState !== true) {
        this._terminalFocusState = true;
        this.emit("focus" /* FOCUS */);
      }
      return true;
    }
    if (sequence === "\x1B[O") {
      this.shouldRestoreModesOnNextFocus = true;
      if (this._terminalFocusState !== false) {
        this._terminalFocusState = false;
        this.emit("blur" /* BLUR */);
      }
      return true;
    }
    return false;
  }).bind(this);
  dispatchSequenceHandlers(sequence) {
    if (this._debugModeEnabled) {
      this._debugInputs.push({
        timestamp: new Date().toISOString(),
        sequence
      });
    }
    for (const handler of this.sequenceHandlers) {
      if (handler(sequence)) {
        return true;
      }
    }
    return false;
  }
  drainStdinParser() {
    if (!this.stdinParser)
      return;
    this.stdinParser.drain((event) => {
      this.handleStdinEvent(event);
    });
  }
  handleStdinEvent(event) {
    switch (event.type) {
      case "key":
        if (this.dispatchSequenceHandlers(event.raw)) {
          return;
        }
        this._keyHandler.processParsedKey(event.key);
        return;
      case "mouse":
        if (this._useMouse && this.processSingleMouseEvent(event.event)) {
          return;
        }
        this.dispatchSequenceHandlers(event.raw);
        return;
      case "paste":
        this._keyHandler.processPaste(event.bytes, event.metadata);
        return;
      case "response":
        if (event.protocol === "osc") {
          for (const subscriber of this.oscSubscribers) {
            subscriber(event.sequence);
          }
        }
        if (event.protocol === "cpr" && this.processCapabilitySequence(event.sequence, true)) {
          return;
        }
        this.dispatchSequenceHandlers(event.sequence);
        return;
    }
  }
  handleStdinParserFailure(error) {
    if (!this.hasLoggedStdinParserError) {
      this.hasLoggedStdinParserError = true;
      if (true) {
        console.error("[stdin-parser-error] parser failure, resetting parser", error);
      }
    }
    try {
      this.stdinParser?.reset();
    } catch (resetError) {
      console.error("stdin parser reset failed after parser error", resetError);
    }
  }
  setupInput() {
    for (const handler of this.prependedInputHandlers) {
      this.addInputHandler(handler);
    }
    this.addInputHandler((sequence) => {
      if (isPixelResolutionResponse(sequence) && this.waitingForPixelResolution) {
        const resolution = parsePixelResolution(sequence);
        if (resolution) {
          this._resolution = resolution;
        }
        this.waitingForPixelResolution = false;
        this.updateStdinParserProtocolContext({ pixelResolutionQueryActive: false }, true);
        return true;
      }
      return false;
    });
    this.addInputHandler(this.capabilityHandler);
    this.addInputHandler(this.focusHandler);
    this.addInputHandler(this.themeModeHandler);
    if (this.stdin.setRawMode) {
      this.stdin.setRawMode(true);
    }
    this.stdin.on("data", this.stdinListener);
    this.stdin.resume();
  }
  dispatchMouseEvent(target, attributes) {
    const event = new MouseEvent(target, attributes);
    target.processMouseEvent(event);
    if (this.autoFocus && event.type === "down" && event.button === 0 /* LEFT */ && !event.defaultPrevented) {
      let current = target;
      while (current) {
        if (current.focusable) {
          current.focus();
          break;
        }
        current = current.parent;
      }
    }
    return event;
  }
  processSingleMouseEvent(mouseEvent) {
    if (this._splitHeight > 0) {
      if (mouseEvent.y < this.renderOffset) {
        return false;
      }
      mouseEvent.y -= this.renderOffset;
    }
    this._latestPointer.x = mouseEvent.x;
    this._latestPointer.y = mouseEvent.y;
    this._hasPointer = true;
    this._lastPointerModifiers = mouseEvent.modifiers;
    if (this._console.visible) {
      const consoleBounds = this._console.bounds;
      if (mouseEvent.x >= consoleBounds.x && mouseEvent.x < consoleBounds.x + consoleBounds.width && mouseEvent.y >= consoleBounds.y && mouseEvent.y < consoleBounds.y + consoleBounds.height) {
        const event2 = new MouseEvent(null, mouseEvent);
        const handled = this._console.handleMouse(event2);
        if (handled)
          return true;
      }
    }
    if (mouseEvent.type === "scroll") {
      const maybeRenderableId2 = this.hitTest(mouseEvent.x, mouseEvent.y);
      const maybeRenderable2 = Renderable.renderablesByNumber.get(maybeRenderableId2);
      const fallbackTarget = this._currentFocusedRenderable && !this._currentFocusedRenderable.isDestroyed && this._currentFocusedRenderable.focused ? this._currentFocusedRenderable : null;
      const scrollTarget = maybeRenderable2 ?? fallbackTarget;
      if (scrollTarget) {
        const event2 = new MouseEvent(scrollTarget, mouseEvent);
        scrollTarget.processMouseEvent(event2);
      }
      return true;
    }
    const maybeRenderableId = this.hitTest(mouseEvent.x, mouseEvent.y);
    const sameElement = maybeRenderableId === this.lastOverRenderableNum;
    this.lastOverRenderableNum = maybeRenderableId;
    const maybeRenderable = Renderable.renderablesByNumber.get(maybeRenderableId);
    if (mouseEvent.type === "down" && mouseEvent.button === 0 /* LEFT */ && !this.currentSelection?.isDragging && !mouseEvent.modifiers.ctrl) {
      const canStartSelection = Boolean(maybeRenderable && maybeRenderable.selectable && !maybeRenderable.isDestroyed && maybeRenderable.shouldStartSelection(mouseEvent.x, mouseEvent.y));
      if (canStartSelection && maybeRenderable) {
        this.startSelection(maybeRenderable, mouseEvent.x, mouseEvent.y);
        this.dispatchMouseEvent(maybeRenderable, mouseEvent);
        return true;
      }
    }
    if (mouseEvent.type === "drag" && this.currentSelection?.isDragging) {
      this.updateSelection(maybeRenderable, mouseEvent.x, mouseEvent.y);
      if (maybeRenderable) {
        const event2 = new MouseEvent(maybeRenderable, {
          ...mouseEvent,
          isDragging: true
        });
        maybeRenderable.processMouseEvent(event2);
      }
      return true;
    }
    if (mouseEvent.type === "up" && this.currentSelection?.isDragging) {
      if (maybeRenderable) {
        const event2 = new MouseEvent(maybeRenderable, {
          ...mouseEvent,
          isDragging: true
        });
        maybeRenderable.processMouseEvent(event2);
      }
      this.finishSelection();
      return true;
    }
    if (mouseEvent.type === "down" && mouseEvent.button === 0 /* LEFT */ && this.currentSelection) {
      if (mouseEvent.modifiers.ctrl) {
        this.currentSelection.isDragging = true;
        this.updateSelection(maybeRenderable, mouseEvent.x, mouseEvent.y);
        return true;
      }
    }
    if (!sameElement && (mouseEvent.type === "drag" || mouseEvent.type === "move")) {
      if (this.lastOverRenderable && this.lastOverRenderable !== this.capturedRenderable && !this.lastOverRenderable.isDestroyed) {
        const event2 = new MouseEvent(this.lastOverRenderable, {
          ...mouseEvent,
          type: "out"
        });
        this.lastOverRenderable.processMouseEvent(event2);
      }
      this.lastOverRenderable = maybeRenderable;
      if (maybeRenderable) {
        const event2 = new MouseEvent(maybeRenderable, {
          ...mouseEvent,
          type: "over",
          source: this.capturedRenderable
        });
        maybeRenderable.processMouseEvent(event2);
      }
    }
    if (this.capturedRenderable && mouseEvent.type !== "up") {
      const event2 = new MouseEvent(this.capturedRenderable, mouseEvent);
      this.capturedRenderable.processMouseEvent(event2);
      return true;
    }
    if (this.capturedRenderable && mouseEvent.type === "up") {
      const event2 = new MouseEvent(this.capturedRenderable, {
        ...mouseEvent,
        type: "drag-end"
      });
      this.capturedRenderable.processMouseEvent(event2);
      this.capturedRenderable.processMouseEvent(new MouseEvent(this.capturedRenderable, mouseEvent));
      if (maybeRenderable) {
        const event3 = new MouseEvent(maybeRenderable, {
          ...mouseEvent,
          type: "drop",
          source: this.capturedRenderable
        });
        maybeRenderable.processMouseEvent(event3);
      }
      this.lastOverRenderable = this.capturedRenderable;
      this.lastOverRenderableNum = this.capturedRenderable.num;
      this.setCapturedRenderable(undefined);
      this.requestRender();
    }
    let event;
    if (maybeRenderable) {
      if (mouseEvent.type === "drag" && mouseEvent.button === 0 /* LEFT */) {
        this.setCapturedRenderable(maybeRenderable);
      } else {
        this.setCapturedRenderable(undefined);
      }
      event = this.dispatchMouseEvent(maybeRenderable, mouseEvent);
    } else {
      this.setCapturedRenderable(undefined);
      this.lastOverRenderable = undefined;
    }
    if (!event?.defaultPrevented && mouseEvent.type === "down" && this.currentSelection) {
      this.clearSelection();
    }
    return true;
  }
  recheckHoverState() {
    if (this._isDestroyed || !this._hasPointer)
      return;
    if (this.capturedRenderable)
      return;
    const hitId = this.hitTest(this._latestPointer.x, this._latestPointer.y);
    const hitRenderable = Renderable.renderablesByNumber.get(hitId);
    const lastOver = this.lastOverRenderable;
    if (lastOver?.num === hitId) {
      this.lastOverRenderableNum = hitId;
      return;
    }
    const baseEvent = {
      type: "move",
      button: 0,
      x: this._latestPointer.x,
      y: this._latestPointer.y,
      modifiers: this._lastPointerModifiers
    };
    if (lastOver && !lastOver.isDestroyed) {
      const event = new MouseEvent(lastOver, { ...baseEvent, type: "out" });
      lastOver.processMouseEvent(event);
    }
    this.lastOverRenderable = hitRenderable;
    this.lastOverRenderableNum = hitId;
    if (hitRenderable) {
      const event = new MouseEvent(hitRenderable, {
        ...baseEvent,
        type: "over"
      });
      hitRenderable.processMouseEvent(event);
    }
  }
  setMousePointer(style) {
    this._currentMousePointerStyle = style;
    this.lib.setCursorStyleOptions(this.rendererPtr, { cursor: style });
  }
  hitTest(x, y) {
    return this.lib.checkHit(this.rendererPtr, x, y);
  }
  takeMemorySnapshot() {
    if (this._isDestroyed)
      return;
    const memoryUsage = process.memoryUsage();
    this.lastMemorySnapshot = {
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      arrayBuffers: memoryUsage.arrayBuffers
    };
    this.lib.updateMemoryStats(this.rendererPtr, this.lastMemorySnapshot.heapUsed, this.lastMemorySnapshot.heapTotal, this.lastMemorySnapshot.arrayBuffers);
    this.emit("memory:snapshot" /* MEMORY_SNAPSHOT */, this.lastMemorySnapshot);
  }
  startMemorySnapshotTimer() {
    this.stopMemorySnapshotTimer();
    this.memorySnapshotTimer = this.clock.setInterval(() => {
      this.takeMemorySnapshot();
    }, this.memorySnapshotInterval);
  }
  stopMemorySnapshotTimer() {
    if (this.memorySnapshotTimer) {
      this.clock.clearInterval(this.memorySnapshotTimer);
      this.memorySnapshotTimer = null;
    }
  }
  setMemorySnapshotInterval(interval) {
    this.memorySnapshotInterval = interval;
    if (this._isRunning && interval > 0) {
      this.startMemorySnapshotTimer();
    } else if (interval <= 0 && this.memorySnapshotTimer) {
      this.clock.clearInterval(this.memorySnapshotTimer);
      this.memorySnapshotTimer = null;
    }
  }
  handleResize(width, height) {
    if (this._isDestroyed)
      return;
    if (this._splitHeight > 0) {
      this.processResize(width, height);
      return;
    }
    if (this.resizeTimeoutId !== null) {
      this.clock.clearTimeout(this.resizeTimeoutId);
      this.resizeTimeoutId = null;
    }
    this.resizeTimeoutId = this.clock.setTimeout(() => {
      this.resizeTimeoutId = null;
      this.processResize(width, height);
    }, this.resizeDebounceDelay);
  }
  queryPixelResolution() {
    this.waitingForPixelResolution = true;
    this.updateStdinParserProtocolContext({ pixelResolutionQueryActive: true });
    this.lib.queryPixelResolution(this.rendererPtr);
  }
  processResize(width, height) {
    if (width === this._terminalWidth && height === this._terminalHeight)
      return;
    if (this._terminalIsSetup && this._controlState !== "explicit_suspended" /* EXPLICIT_SUSPENDED */ && !this.isSplitCursorSeedFrameBlocked()) {
      this.flushPendingSplitOutputBeforeTransition();
    }
    const pendingSplitFooterTransition = this.pendingSplitFooterTransition;
    const previousGeometry = calculateRenderGeometry(this._screenMode, this._terminalWidth, this._terminalHeight, this._footerHeight);
    const prevWidth = this._terminalWidth;
    const previousTerminalHeight = this._terminalHeight;
    const visiblePreviousSplitHeight = pendingSplitFooterTransition?.sourceHeight ?? previousGeometry.effectiveFooterHeight;
    this._terminalWidth = width;
    this._terminalHeight = height;
    this.queryPixelResolution();
    this.setCapturedRenderable(undefined);
    this.stdinParser?.resetMouseState();
    const nextGeometry = calculateRenderGeometry(this._screenMode, this._terminalWidth, this._terminalHeight, this._footerHeight);
    const splitFooterActive = this._screenMode === "split-footer";
    if (splitFooterActive) {
      let clearStart = null;
      if (width < prevWidth && visiblePreviousSplitHeight > 0) {
        clearStart = Math.max(previousTerminalHeight - visiblePreviousSplitHeight * 2, 1);
      }
      if (pendingSplitFooterTransition !== null) {
        clearStart = clearStart === null ? pendingSplitFooterTransition.sourceTopLine : Math.min(clearStart, pendingSplitFooterTransition.sourceTopLine);
      }
      if (clearStart !== null) {
        const flush = ANSI.moveCursorAndClear(clearStart, 1);
        this.writeOut(flush);
      }
      this.currentRenderBuffer.clear(this.backgroundColor);
    }
    this.clearPendingSplitFooterTransition();
    this._splitHeight = nextGeometry.effectiveFooterHeight;
    this.width = nextGeometry.renderWidth;
    this.height = nextGeometry.renderHeight;
    this.lib.resizeRenderer(this.rendererPtr, this.width, this.height);
    if (this._screenMode === "split-footer" && this._externalOutputMode === "capture-stdout") {
      this.syncSplitScrollback();
    } else {
      this.syncSplitFooterState();
    }
    this.nextRenderBuffer = this.lib.getNextBuffer(this.rendererPtr);
    this.currentRenderBuffer = this.lib.getCurrentBuffer(this.rendererPtr);
    this._console.resize(this.width, this.height);
    this.root.resize(this.width, this.height);
    this.emit("resize" /* RESIZE */, this.width, this.height);
    this.requestRender();
  }
  resize(width, height) {
    if (this._isDestroyed)
      return;
    this.processResize(width, height);
  }
  setBackgroundColor(color) {
    const parsedColor = parseColor(color);
    this.lib.setBackgroundColor(this.rendererPtr, parsedColor);
    this.backgroundColor = parsedColor;
    this.nextRenderBuffer.clear(parsedColor);
    this.requestRender();
  }
  toggleDebugOverlay() {
    const willBeEnabled = !this.debugOverlay.enabled;
    if (willBeEnabled && !this.memorySnapshotInterval) {
      this.memorySnapshotInterval = 3000;
      this.startMemorySnapshotTimer();
      this.automaticMemorySnapshot = true;
    } else if (!willBeEnabled && this.automaticMemorySnapshot) {
      this.stopMemorySnapshotTimer();
      this.memorySnapshotInterval = 0;
      this.automaticMemorySnapshot = false;
    }
    this.debugOverlay.enabled = !this.debugOverlay.enabled;
    this.lib.setDebugOverlay(this.rendererPtr, this.debugOverlay.enabled, this.debugOverlay.corner);
    this.emit("debugOverlay:toggle" /* DEBUG_OVERLAY_TOGGLE */, this.debugOverlay.enabled);
    this.requestRender();
  }
  configureDebugOverlay(options) {
    this.debugOverlay.enabled = options.enabled ?? this.debugOverlay.enabled;
    this.debugOverlay.corner = options.corner ?? this.debugOverlay.corner;
    this.lib.setDebugOverlay(this.rendererPtr, this.debugOverlay.enabled, this.debugOverlay.corner);
    this.requestRender();
  }
  setTerminalTitle(title) {
    this.lib.setTerminalTitle(this.rendererPtr, title);
  }
  resetTerminalBgColor() {
    this.writeOut("\x1B]111\x07");
  }
  copyToClipboardOSC52(text, target) {
    return this.clipboard.copyToClipboardOSC52(text, target);
  }
  clearClipboardOSC52(target) {
    return this.clipboard.clearClipboardOSC52(target);
  }
  isOsc52Supported() {
    return this._capabilities ? this._capabilities.osc52_support !== "unsupported" : this.clipboard.isOsc52Supported();
  }
  dumpHitGrid() {
    this.lib.dumpHitGrid(this.rendererPtr);
  }
  dumpBuffers(timestamp) {
    this.lib.dumpBuffers(this.rendererPtr, timestamp);
  }
  dumpOutputBuffer(timestamp) {
    this.lib.dumpOutputBuffer(this.rendererPtr, timestamp);
  }
  static setCursorPosition(renderer, x, y, visible = true) {
    const lib = resolveRenderLib();
    lib.setCursorPosition(renderer.rendererPtr, x, y, visible);
  }
  static setCursorStyle(renderer, options) {
    const lib = resolveRenderLib();
    lib.setCursorStyleOptions(renderer.rendererPtr, options);
    if (options.cursor !== undefined) {
      renderer._currentMousePointerStyle = options.cursor;
    }
  }
  static setCursorColor(renderer, color) {
    const lib = resolveRenderLib();
    lib.setCursorColor(renderer.rendererPtr, color);
  }
  setCursorPosition(x, y, visible = true) {
    this.lib.setCursorPosition(this.rendererPtr, x, y, visible);
  }
  setCursorStyle(options) {
    this.lib.setCursorStyleOptions(this.rendererPtr, options);
    if (options.cursor !== undefined) {
      this._currentMousePointerStyle = options.cursor;
    }
  }
  setCursorColor(color) {
    this.lib.setCursorColor(this.rendererPtr, color);
  }
  getCursorState() {
    return this.lib.getCursorState(this.rendererPtr);
  }
  addPostProcessFn(processFn) {
    this.postProcessFns.push(processFn);
  }
  removePostProcessFn(processFn) {
    this.postProcessFns = this.postProcessFns.filter((fn) => fn !== processFn);
  }
  clearPostProcessFns() {
    this.postProcessFns = [];
  }
  setFrameCallback(callback) {
    this.frameCallbacks.push(callback);
  }
  removeFrameCallback(callback) {
    this.frameCallbacks = this.frameCallbacks.filter((cb) => cb !== callback);
  }
  clearFrameCallbacks() {
    this.frameCallbacks = [];
  }
  requestLive() {
    this.liveRequestCounter++;
    if (this._controlState === "idle" /* IDLE */ && this.liveRequestCounter > 0) {
      this._controlState = "auto_started" /* AUTO_STARTED */;
      this.internalStart();
    }
  }
  dropLive() {
    this.liveRequestCounter = Math.max(0, this.liveRequestCounter - 1);
    if (this._controlState === "auto_started" /* AUTO_STARTED */ && this.liveRequestCounter === 0) {
      this._controlState = "idle" /* IDLE */;
      this.internalPause();
    }
  }
  start() {
    this._controlState = "explicit_started" /* EXPLICIT_STARTED */;
    this.internalStart();
  }
  auto() {
    this._controlState = this._isRunning ? "auto_started" /* AUTO_STARTED */ : "idle" /* IDLE */;
  }
  internalStart() {
    if (!this._isRunning && !this._isDestroyed) {
      this._isRunning = true;
      this.updateScheduled = false;
      if (this.memorySnapshotInterval > 0) {
        this.startMemorySnapshotTimer();
      }
      this.startRenderLoop();
    }
  }
  pause() {
    this._controlState = "explicit_paused" /* EXPLICIT_PAUSED */;
    this.internalPause();
  }
  suspend() {
    this._previousControlState = this._controlState;
    this._controlState = "explicit_suspended" /* EXPLICIT_SUSPENDED */;
    this.updateScheduled = false;
    this.internalPause();
    if (this._terminalIsSetup) {
      this.clearSplitStartupCursorSeed();
      this.flushPendingSplitOutputBeforeTransition(true, { allowSuspended: true });
      this.suspendedNonAltSurfacePreserved = this._screenMode !== "alternate-screen" && this.renderOffset > 0;
    } else {
      this.suspendedNonAltSurfacePreserved = false;
    }
    this._suspendedMouseEnabled = this._useMouse;
    this.disableMouse();
    this.removeExitListeners();
    this.waitingForPixelResolution = false;
    this.updateStdinParserProtocolContext({
      privateCapabilityRepliesActive: false,
      pixelResolutionQueryActive: false,
      explicitWidthCprActive: false,
      startupCursorCprActive: false
    });
    this.stdinParser?.reset();
    this.stdin.removeListener("data", this.stdinListener);
    this.themeModeState.cancelRefresh();
    this.lib.suspendRenderer(this.rendererPtr);
    if (this.stdin.setRawMode) {
      this.stdin.setRawMode(false);
    }
    this.stdin.pause();
  }
  resume() {
    if (this.stdin.setRawMode) {
      this.stdin.setRawMode(true);
    }
    while (this.stdin.read() !== null) {}
    this.stdin.on("data", this.stdinListener);
    this.stdin.resume();
    this.addExitListeners();
    const resumePreservedNonAltSurface = this.pendingSuspendedTerminalSetup && this._screenMode !== "alternate-screen" && this.suspendedNonAltSurfacePreserved && this.renderOffset > 0;
    if (this.pendingSuspendedTerminalSetup) {
      this.pendingSuspendedTerminalSetup = false;
      if (resumePreservedNonAltSurface) {
        this.lib.resumeRenderer(this.rendererPtr);
      } else {
        this.lib.setupTerminal(this.rendererPtr, this._screenMode === "alternate-screen");
      }
    } else {
      this.lib.resumeRenderer(this.rendererPtr);
    }
    this.suspendedNonAltSurfacePreserved = false;
    this.flushPendingSplitOutputBeforeTransition(false, { allowSuspended: true, allowPassthrough: true });
    if (this._screenMode === "split-footer" && this._splitHeight > 0) {
      this.syncSplitFooterState();
    }
    if (this._suspendedMouseEnabled) {
      this.enableMouse();
    }
    this.forceFullRepaintRequested = true;
    this._controlState = this._previousControlState;
    if (this._previousControlState === "auto_started" /* AUTO_STARTED */ || this._previousControlState === "explicit_started" /* EXPLICIT_STARTED */) {
      this.internalStart();
    } else {
      this.requestRender();
    }
  }
  internalPause() {
    this._isRunning = false;
    if (this.renderTimeout) {
      this.clock.clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }
    if (!this.rendering) {
      this.resolveIdleIfNeeded();
    }
  }
  stop() {
    this._controlState = "explicit_stopped" /* EXPLICIT_STOPPED */;
    this.internalStop();
  }
  internalStop() {
    if (this.isRunning && !this._isDestroyed) {
      this._isRunning = false;
      if (this.memorySnapshotTimer) {
        this.clock.clearInterval(this.memorySnapshotTimer);
        this.memorySnapshotTimer = null;
      }
      if (this.renderTimeout) {
        this.clock.clearTimeout(this.renderTimeout);
        this.renderTimeout = null;
      }
      if (!this.rendering) {
        this.resolveIdleIfNeeded();
      }
    }
  }
  destroy() {
    if (this._isDestroyed)
      return;
    this._isDestroyed = true;
    this._destroyPending = true;
    this._palettePublishGeneration++;
    if (this.rendering) {
      this.prepareDestroyDuringRender();
      return;
    }
    this.finalizeDestroy();
  }
  cleanupBeforeDestroy() {
    if (this._destroyCleanupPrepared)
      return;
    this._destroyCleanupPrepared = true;
    if (this._usesProcessStdout) {
      process.removeListener("SIGWINCH", this.sigwinchHandler);
    }
    process.removeListener("uncaughtException", this.handleError);
    process.removeListener("unhandledRejection", this.handleError);
    process.removeListener("warning", this.warningHandler);
    process.removeListener("beforeExit", this.exitHandler);
    this.removeExitListeners();
    if (this.resizeTimeoutId !== null) {
      this.clock.clearTimeout(this.resizeTimeoutId);
      this.resizeTimeoutId = null;
    }
    if (this.capabilityTimeoutId !== null) {
      this.clock.clearTimeout(this.capabilityTimeoutId);
      this.capabilityTimeoutId = null;
    }
    this.clearSplitStartupCursorSeed();
    if (this.memorySnapshotTimer) {
      this.clock.clearInterval(this.memorySnapshotTimer);
      this.memorySnapshotTimer = null;
    }
    if (this.renderTimeout) {
      this.clock.clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }
    this.themeModeState.cancelRefresh();
    this._isRunning = false;
    this.waitingForPixelResolution = false;
    this.updateStdinParserProtocolContext({
      privateCapabilityRepliesActive: false,
      pixelResolutionQueryActive: false,
      explicitWidthCprActive: false,
      startupCursorCprActive: false
    }, true);
    this._useMouse = false;
    this.setCapturedRenderable(undefined);
    this.stdin.removeListener("data", this.stdinListener);
    if (this.stdin.setRawMode) {
      try {
        this.stdin.setRawMode(false);
      } catch (e) {
        console.error("Error disabling raw mode during destroy:", e);
      }
    }
    try {
      this.stdin.pause();
    } catch (e) {
      console.error("Error pausing stdin during destroy:", e);
    }
    if (this._feed !== null && this._splitHeight > 0 && !this._terminalIsSetup) {
      this.flushPendingSplitOutputBeforeTransition(false, { allowSuspended: true, allowUnsetup: true });
    }
    this.externalOutputMode = "passthrough";
    if (this._splitHeight > 0) {
      this.flushStdoutCache(this._splitHeight, true);
    }
  }
  prepareDestroyDuringRender() {
    this.cleanupBeforeDestroy();
    this.lib.suspendRenderer(this.rendererPtr);
  }
  finalizeDestroy() {
    if (this._destroyFinalized)
      return;
    this._destroyFinalized = true;
    this._destroyPending = false;
    this.cleanupBeforeDestroy();
    if (this._paletteDetector) {
      this._paletteDetector.cleanup();
      this._paletteDetector = null;
    }
    this._paletteCache.clear();
    this._paletteDetectionPromise = null;
    this._paletteDetectionSize = 0;
    this._nativePaletteSignature = null;
    this._emittedPaletteSignature = null;
    this._paletteEpoch = 0;
    this.resolveXtVersionWaiters();
    this.themeModeState.dispose();
    this.emit("destroy" /* DESTROY */);
    try {
      this.root.destroyRecursively();
    } catch (e) {
      console.error("Error destroying root renderable:", e instanceof Error ? e.stack : String(e));
    }
    this.stdinParser?.destroy();
    this.stdinParser = null;
    this.oscSubscribers.clear();
    this._console.destroy();
    if (this._splitHeight > 0 && this._terminalIsSetup && this._controlState !== "explicit_suspended" /* EXPLICIT_SUSPENDED */) {
      this.flushPendingSplitOutputBeforeTransition(true);
      this.renderOffset = 0;
      if (this.clearOnShutdown) {
        this.lib.setRenderOffset(this.rendererPtr, 0);
      }
    }
    this._externalOutputMode = "passthrough";
    this.pendingExternalOutputMode = null;
    this.stdout.write = this.realStdoutWrite;
    this.externalOutputQueue.clear();
    if (this._feed) {
      try {
        this._feed.drainAll();
      } catch (e) {
        console.error("Error draining NativeSpanFeed during destroy:", e);
      }
    }
    try {
      this.lib.destroyRenderer(this.rendererPtr);
    } catch (e) {
      console.error("Error in lib.destroyRenderer during destroy:", e);
    }
    rendererTracker.renderers.delete(this);
    if (rendererTracker.renderers.size === 0) {
      destroyTreeSitterClient().catch((error) => {
        console.error("Failed to destroy tree-sitter client:", error);
      });
    }
    if (this._feed) {
      try {
        this._feed.drainAll();
      } catch (e) {
        console.error("Error draining NativeSpanFeed shutdown frames:", e);
      }
      this._detachFeed?.();
      this._detachFeed = null;
      this._detachFeedError?.();
      this._detachFeedError = null;
      this._feed.close();
      this._feed = null;
    }
    if (this._streamLeaseAcquired) {
      if (rendererTracker.streamOwners.get(this.stdin) === this)
        rendererTracker.streamOwners.delete(this.stdin);
      if (rendererTracker.streamOwners.get(this.stdout) === this)
        rendererTracker.streamOwners.delete(this.stdout);
      this._streamLeaseAcquired = false;
    }
    if (this._onDestroy) {
      try {
        this._onDestroy();
      } catch (e) {
        console.error("Error in onDestroy callback:", e instanceof Error ? e.stack : String(e));
      }
    }
    this.resolveIdleIfNeeded();
  }
  startRenderLoop() {
    if (!this._isRunning)
      return;
    this.lastTime = this.normalizeClockTime(this.clock.now(), 0);
    this.frameCount = 0;
    this.lastFpsTime = this.lastTime;
    this.currentFps = 0;
    this.renderStats.fps = 0;
    if (this.feedIdleRenderScheduled)
      return;
    this.loop();
  }
  async loop() {
    if (this.rendering || this._isDestroyed)
      return;
    this.renderTimeout = null;
    this.rendering = true;
    if (this.renderTimeout) {
      this.clock.clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }
    try {
      this._frameId++;
      const now = this.normalizeClockTime(this.clock.now(), this.lastTime);
      const elapsed = this.getElapsedMs(now, this.lastTime);
      const deltaTime = elapsed;
      this.lastTime = now;
      this.renderStats.frameCount++;
      const overallStart = performance.now();
      const frameRequests = Array.from(this.animationRequest.values());
      this.animationRequest.clear();
      const animationRequestStart = performance.now();
      for (const callback of frameRequests) {
        callback(deltaTime);
        this.dropLive();
      }
      const animationRequestEnd = performance.now();
      const animationRequestTime = animationRequestEnd - animationRequestStart;
      const start = performance.now();
      for (const frameCallback of this.frameCallbacks) {
        try {
          await frameCallback(deltaTime);
        } catch (error) {
          console.error("Error in frame callback:", error);
        }
      }
      const end = performance.now();
      this.renderStats.frameCallbackTime = end - start;
      this.root.render(this.nextRenderBuffer, deltaTime);
      for (const postProcessFn of this.postProcessFns) {
        postProcessFn(this.nextRenderBuffer, deltaTime);
      }
      this._console.renderToBuffer(this.nextRenderBuffer);
      if (!this._isDestroyed) {
        const nativeStatus = this.renderNative() ?? "rendered";
        if (nativeStatus === "rendered")
          this.frameCount++;
        if (this.getElapsedMs(now, this.lastFpsTime) >= 1000) {
          this.currentFps = this.frameCount;
          this.frameCount = 0;
          this.lastFpsTime = now;
        }
        this.renderStats.fps = this.currentFps;
        if (nativeStatus === "rendered") {
          if (this._useMouse && this.lib.getHitGridDirty(this.rendererPtr)) {
            this.recheckHoverState();
          }
          const overallFrameTime = performance.now() - overallStart;
          this.lib.updateStats(this.rendererPtr, overallFrameTime, this.renderStats.fps, this.renderStats.frameCallbackTime);
          if (this.listenerCount("frame" /* FRAME */) > 0) {
            this.emit("frame" /* FRAME */, {
              frameId: this.frameId
            });
          }
          if (this.gatherStats) {
            this.collectStatSample(overallFrameTime);
          }
          if (this._isRunning || this.immediateRerenderRequested) {
            const targetFrameTime = this.immediateRerenderRequested ? this.minTargetFrameTime : this.targetFrameTime;
            const delay = Math.max(1, targetFrameTime - Math.floor(overallFrameTime));
            this.immediateRerenderRequested = false;
            this.renderTimeout = this.clock.setTimeout(() => {
              this.renderTimeout = null;
              this.loop();
            }, delay);
          } else {
            this.clock.clearTimeout(this.renderTimeout);
            this.renderTimeout = null;
          }
        } else if (nativeStatus === "blocked") {
          const overallFrameTime = performance.now() - overallStart;
          if (this._isRunning || this.immediateRerenderRequested) {
            const targetFrameTime = this.immediateRerenderRequested ? this.minTargetFrameTime : this.targetFrameTime;
            const delay = Math.max(1, targetFrameTime - Math.floor(overallFrameTime));
            this.immediateRerenderRequested = false;
            this.renderTimeout = this.clock.setTimeout(() => {
              this.renderTimeout = null;
              this.loop();
            }, delay);
          } else {
            this.clock.clearTimeout(this.renderTimeout);
            this.renderTimeout = null;
          }
        } else if (nativeStatus === "backpressured") {
          this.scheduleRenderAfterBackpressure();
        } else if (nativeStatus === "retryable-skip") {
          this.immediateRerenderRequested = false;
          this.renderTimeout = null;
        } else if (nativeStatus === "failed") {
          this.immediateRerenderRequested = false;
          this.renderTimeout = null;
        }
      }
    } finally {
      this.rendering = false;
      if (this._destroyPending) {
        this.finalizeDestroy();
      }
      this.resolveIdleIfNeeded();
    }
  }
  intermediateRender() {
    this.immediateRerenderRequested = true;
    this.loop();
  }
  renderNative() {
    if (this.renderingNative) {
      console.error("Rendering called concurrently");
      throw new Error("Rendering called concurrently");
    }
    this.renderingNative = true;
    try {
      if (this.isSplitCursorSeedFrameBlocked()) {
        return "blocked";
      }
      if (this._splitHeight > 0 && this._externalOutputMode === "capture-stdout") {
        const forceSplitRepaint = this.forceFullRepaintRequested;
        const status = this.flushPendingSplitCommits(forceSplitRepaint, this.pendingExternalOutputMode === "passthrough");
        if (status === "backpressured") {
          return "backpressured";
        }
        if (status === "failed") {
          return "failed";
        }
        this.forceFullRepaintRequested = false;
        this.pendingSplitFooterTransition = null;
        return "rendered";
      }
      const force = this.forceFullRepaintRequested;
      const nativeStatus = this.lib.render(this.rendererPtr, force);
      if (nativeStatus === NATIVE_RENDER_STATUS_SKIPPED || nativeStatus === NATIVE_RENDER_STATUS_FAILED) {
        return this.handleNativeRenderRejection(nativeStatus);
      }
      this.forceFullRepaintRequested = false;
      this.pendingSplitFooterTransition = null;
      return "rendered";
    } finally {
      this.renderingNative = false;
    }
  }
  collectStatSample(frameTime) {
    this.frameTimes.push(frameTime);
    if (this.frameTimes.length > this.maxStatSamples) {
      this.frameTimes.shift();
    }
  }
  getNativeStats() {
    return this.lib.getRenderStats(this.rendererPtr);
  }
  getStats() {
    const nativeStats = this.getNativeStats();
    const frameTimes = [...this.frameTimes];
    const sum = frameTimes.reduce((acc, time) => acc + time, 0);
    const avg = frameTimes.length ? sum / frameTimes.length : 0;
    const min = frameTimes.length ? Math.min(...frameTimes) : 0;
    const max = frameTimes.length ? Math.max(...frameTimes) : 0;
    return {
      ...nativeStats,
      fps: this.renderStats.fps,
      frameCount: this.renderStats.frameCount,
      frameTimes,
      averageFrameTime: avg,
      minFrameTime: min,
      maxFrameTime: max,
      frameCallbackTime: this.renderStats.frameCallbackTime
    };
  }
  resetStats() {
    this.frameTimes = [];
    this.renderStats.frameCount = 0;
  }
  setGatherStats(enabled) {
    this.gatherStats = enabled;
    if (!enabled) {
      this.frameTimes = [];
    }
  }
  getSelection() {
    return this.currentSelection;
  }
  get hasSelection() {
    return !!this.currentSelection;
  }
  getSelectionContainer() {
    return this.selectionContainers.length > 0 ? this.selectionContainers[this.selectionContainers.length - 1] : null;
  }
  clearSelection() {
    if (this.currentSelection) {
      for (const renderable of this.currentSelection.touchedRenderables) {
        if (renderable.selectable && !renderable.isDestroyed) {
          renderable.onSelectionChanged(null);
        }
      }
      this.currentSelection = null;
    }
    this.selectionContainers = [];
  }
  startSelection(renderable, x, y) {
    if (!renderable.selectable)
      return;
    this.clearSelection();
    this.selectionContainers.push(renderable.parent || this.root);
    this.currentSelection = new Selection(renderable, { x, y }, { x, y });
    this.currentSelection.isStart = true;
    this.notifySelectablesOfSelectionChange();
  }
  updateSelection(currentRenderable, x, y, options) {
    if (this.currentSelection) {
      this.currentSelection.isStart = false;
      this.currentSelection.focus = { x, y };
      if (options?.finishDragging) {
        this.currentSelection.isDragging = false;
      }
      if (this.selectionContainers.length > 0) {
        const currentContainer = this.selectionContainers[this.selectionContainers.length - 1];
        if (!currentRenderable || !this.isWithinContainer(currentRenderable, currentContainer)) {
          const parentContainer = currentContainer.parent || this.root;
          this.selectionContainers.push(parentContainer);
        } else if (currentRenderable && this.selectionContainers.length > 1) {
          let containerIndex = this.selectionContainers.indexOf(currentRenderable);
          if (containerIndex === -1) {
            const immediateParent = currentRenderable.parent || this.root;
            containerIndex = this.selectionContainers.indexOf(immediateParent);
          }
          if (containerIndex !== -1 && containerIndex < this.selectionContainers.length - 1) {
            this.selectionContainers = this.selectionContainers.slice(0, containerIndex + 1);
          }
        }
      }
      this.notifySelectablesOfSelectionChange();
    }
  }
  requestSelectionUpdate() {
    if (this.currentSelection?.isDragging) {
      const pointer = this._latestPointer;
      const maybeRenderableId = this.hitTest(pointer.x, pointer.y);
      const maybeRenderable = Renderable.renderablesByNumber.get(maybeRenderableId);
      this.updateSelection(maybeRenderable, pointer.x, pointer.y);
    }
  }
  isWithinContainer(renderable, container) {
    let current = renderable;
    while (current) {
      if (current === container)
        return true;
      current = current.parent;
    }
    return false;
  }
  finishSelection() {
    if (this.currentSelection) {
      this.currentSelection.isDragging = false;
      this.emit("selection" /* SELECTION */, this.currentSelection);
      this.notifySelectablesOfSelectionChange();
    }
  }
  notifySelectablesOfSelectionChange() {
    const selectedRenderables = [];
    const touchedRenderables = [];
    const currentContainer = this.selectionContainers.length > 0 ? this.selectionContainers[this.selectionContainers.length - 1] : this.root;
    if (this.currentSelection) {
      this.walkSelectableRenderables(currentContainer, this.currentSelection.bounds, selectedRenderables, touchedRenderables);
      for (const renderable of this.currentSelection.touchedRenderables) {
        if (!touchedRenderables.includes(renderable) && !renderable.isDestroyed) {
          renderable.onSelectionChanged(null);
        }
      }
      this.currentSelection.updateSelectedRenderables(selectedRenderables);
      this.currentSelection.updateTouchedRenderables(touchedRenderables);
    }
  }
  walkSelectableRenderables(container, selectionBounds, selectedRenderables, touchedRenderables) {
    const children = getObjectsInViewport(selectionBounds, container.getChildrenSortedByPrimaryAxis(), container.primaryAxis, 0, 0);
    for (const child of children) {
      if (child.selectable) {
        const hasSelection = child.onSelectionChanged(this.currentSelection);
        if (hasSelection) {
          selectedRenderables.push(child);
        }
        touchedRenderables.push(child);
      }
      if (child.getChildrenCount() > 0) {
        this.walkSelectableRenderables(child, selectionBounds, selectedRenderables, touchedRenderables);
      }
    }
  }
  get paletteDetectionStatus() {
    if (this._paletteDetectionPromise)
      return "detecting";
    if (this._paletteCache.size > 0)
      return "cached";
    return "idle";
  }
  getCachedPaletteBySize(size) {
    const exactMatch = this._paletteCache.get(size);
    if (exactMatch) {
      return exactMatch;
    }
    const largerSize = [...this._paletteCache.keys()].sort((a, b) => a - b).find((candidate) => candidate >= size);
    if (largerSize === undefined) {
      return null;
    }
    const source = this._paletteCache.get(largerSize);
    if (!source) {
      return null;
    }
    const projected = {
      ...source,
      palette: source.palette.slice(0, size)
    };
    this._paletteCache.set(size, projected);
    return projected;
  }
  ensurePaletteDetector() {
    if (!this._paletteDetector) {
      const isTmux = Boolean(this.capabilities?.multiplexer === "tmux" || this.capabilities?.terminal?.name?.toLowerCase()?.includes("tmux"));
      const isLegacyTmux = this.capabilities?.terminal?.name?.toLowerCase()?.includes("tmux") && this.capabilities?.terminal?.version?.localeCompare("3.6") < 0;
      this._paletteDetector = createTerminalPalette({
        stdin: this.stdin,
        stdout: this.stdout,
        writeFn: (data) => this._isDestroyed ? false : this.writeOut(data),
        isLegacyTmux,
        isTmux,
        oscSource: {
          subscribeOsc: this.subscribeOsc.bind(this)
        },
        clock: this.clock
      });
    }
    return this._paletteDetector;
  }
  syncNativePaletteState(colors) {
    const signature = buildTerminalPaletteSignature(colors);
    if (this._nativePaletteSignature !== signature) {
      this._paletteEpoch = this._paletteEpoch + 1 >>> 0;
    }
    this._nativePaletteSignature = signature;
    const normalized = normalizeTerminalPalette(colors);
    this.lib.rendererSetPaletteState(this.rendererPtr, normalized.palette, normalized.defaultForeground, normalized.defaultBackground, this._paletteEpoch);
  }
  emitPaletteChange(colors) {
    if (this.listenerCount("palette" /* PALETTE */) === 0)
      return;
    const signature = buildTerminalPaletteSignature(colors);
    if (this._emittedPaletteSignature === signature)
      return;
    this._emittedPaletteSignature = signature;
    this.emit("palette" /* PALETTE */, colors);
  }
  resolveXtVersionWaiters() {
    if (this.xtVersionWaiters.size === 0)
      return;
    const resolvers = [...this.xtVersionWaiters];
    this.xtVersionWaiters.clear();
    for (const resolve of resolvers) {
      resolve();
    }
  }
  waitForXtVersion() {
    if (this.capabilityTimeoutId === null || this._capabilities?.terminal?.from_xtversion) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.xtVersionWaiters.add(resolve);
    });
  }
  shouldSyncNativePaletteState() {
    return Boolean(this._terminalIsSetup && !this._isDestroyed && this._capabilities?.ansi256 && !this._capabilities?.rgb);
  }
  refreshPalette() {
    const publishGeneration = this._palettePublishGeneration;
    this.getPalette({ size: NATIVE_PALETTE_QUERY_SIZE }).then(() => {
      if (this._isDestroyed)
        return;
      if (this._palettePublishGeneration === publishGeneration)
        this.requestRender();
    }).catch(() => {});
  }
  clearPaletteCache() {
    this._palettePublishGeneration++;
    this._paletteCache.clear();
  }
  async getPalette(options) {
    if (this._controlState === "explicit_suspended" /* EXPLICIT_SUSPENDED */) {
      throw new Error("Cannot detect palette while renderer is suspended");
    }
    const requestedSize = options?.size ?? 16;
    const detectionTimeout = options?.timeout;
    const cachedPalette = this.getCachedPaletteBySize(requestedSize);
    if (cachedPalette) {
      return cachedPalette;
    }
    const terminal = this._capabilities?.terminal;
    const hasTmuxVersion = terminal?.name?.toLowerCase() === "tmux" && Boolean(terminal.version);
    if (this._capabilities?.multiplexer === "tmux" && !hasTmuxVersion) {
      await this.waitForXtVersion();
      const afterCapabilityWait = this.getCachedPaletteBySize(requestedSize);
      if (afterCapabilityWait) {
        return afterCapabilityWait;
      }
    }
    if (this._paletteDetectionPromise) {
      if (this._paletteDetectionSize >= requestedSize) {
        return this._paletteDetectionPromise.then((palette) => {
          const cached = this.getCachedPaletteBySize(requestedSize);
          if (cached) {
            return cached;
          }
          const projected = {
            ...palette,
            palette: palette.palette.slice(0, requestedSize)
          };
          this._paletteCache.set(requestedSize, projected);
          return projected;
        });
      }
      await this._paletteDetectionPromise;
      const afterWait = this.getCachedPaletteBySize(requestedSize);
      if (afterWait) {
        return afterWait;
      }
    }
    const detector = this.ensurePaletteDetector();
    const publishGeneration = this._palettePublishGeneration;
    this._paletteDetectionSize = requestedSize;
    this._paletteDetectionPromise = detector.detect({ ...options, timeout: detectionTimeout }).then((result) => {
      this._paletteCache.set(result.palette.length, result);
      this._paletteDetectionPromise = null;
      this._paletteDetectionSize = 0;
      if (!this._isDestroyed && this._palettePublishGeneration === publishGeneration) {
        this.emitPaletteChange(result);
        if (this.shouldSyncNativePaletteState() && result.palette.length >= NATIVE_PALETTE_QUERY_SIZE) {
          this.syncNativePaletteState(result);
        } else if (this.shouldSyncNativePaletteState() && !this._paletteCache.has(NATIVE_PALETTE_QUERY_SIZE)) {
          this.refreshPalette();
        }
      }
      return result;
    }).catch((error) => {
      this._paletteDetectionPromise = null;
      this._paletteDetectionSize = 0;
      throw error;
    });
    const detected = await this._paletteDetectionPromise;
    const finalPalette = this.getCachedPaletteBySize(requestedSize) ?? detected;
    return finalPalette;
  }
}

export { h, isVNode, maybeMakeRenderable, wrapWithDelegates, instantiate, delegate, LayoutEvents, RenderableEvents, isRenderable, BaseRenderable, Renderable, RootRenderable, TextBufferView, EditBuffer, EditorView, convertThemeToStyles, SyntaxStyle, ANSI, BoxRenderable, TextBufferRenderable, CodeRenderable, isTextNodeRenderable, TextNodeRenderable, RootTextNodeRenderable, TextRenderable, NativeSpanFeed, defaultKeyAliases, mergeKeyAliases, mergeKeyBindings, getKeyBindingAction, buildKeyBindingsMap, capture, ConsolePosition, TerminalConsole, getObjectsInViewport, EditBufferRenderableEvents, isEditBufferRenderable, EditBufferRenderable, buildKittyKeyboardFlags, MouseEvent, MouseButton, createCliRenderer, CliRenderEvents, RendererControlState, CliRenderer };

//# debugId=505B20901D301C3264756E2164756E21
//# sourceMappingURL=chunk-node-51kpf0mz.js.map
