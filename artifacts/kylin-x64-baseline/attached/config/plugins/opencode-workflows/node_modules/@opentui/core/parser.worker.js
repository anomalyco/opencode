import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// ../../node_modules/.bun/web-tree-sitter@0.25.10/node_modules/web-tree-sitter/tree-sitter.js
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var SIZE_OF_SHORT = 2;
var SIZE_OF_INT = 4;
var SIZE_OF_CURSOR = 4 * SIZE_OF_INT;
var SIZE_OF_NODE = 5 * SIZE_OF_INT;
var SIZE_OF_POINT = 2 * SIZE_OF_INT;
var SIZE_OF_RANGE = 2 * SIZE_OF_INT + 2 * SIZE_OF_POINT;
var ZERO_POINT = { row: 0, column: 0 };
var INTERNAL = Symbol("INTERNAL");
function assertInternal(x) {
  if (x !== INTERNAL)
    throw new Error("Illegal constructor");
}
__name(assertInternal, "assertInternal");
function isPoint(point) {
  return !!point && typeof point.row === "number" && typeof point.column === "number";
}
__name(isPoint, "isPoint");
function setModule(module2) {
  C = module2;
}
__name(setModule, "setModule");
var C;
var LookaheadIterator = class {
  static {
    __name(this, "LookaheadIterator");
  }
  [0] = 0;
  language;
  constructor(internal, address, language) {
    assertInternal(internal);
    this[0] = address;
    this.language = language;
  }
  get currentTypeId() {
    return C._ts_lookahead_iterator_current_symbol(this[0]);
  }
  get currentType() {
    return this.language.types[this.currentTypeId] || "ERROR";
  }
  delete() {
    C._ts_lookahead_iterator_delete(this[0]);
    this[0] = 0;
  }
  reset(language, stateId) {
    if (C._ts_lookahead_iterator_reset(this[0], language[0], stateId)) {
      this.language = language;
      return true;
    }
    return false;
  }
  resetState(stateId) {
    return Boolean(C._ts_lookahead_iterator_reset_state(this[0], stateId));
  }
  [Symbol.iterator]() {
    return {
      next: /* @__PURE__ */ __name(() => {
        if (C._ts_lookahead_iterator_next(this[0])) {
          return { done: false, value: this.currentType };
        }
        return { done: true, value: "" };
      }, "next")
    };
  }
};
function getText(tree, startIndex, endIndex, startPosition) {
  const length = endIndex - startIndex;
  let result = tree.textCallback(startIndex, startPosition);
  if (result) {
    startIndex += result.length;
    while (startIndex < endIndex) {
      const string = tree.textCallback(startIndex, startPosition);
      if (string && string.length > 0) {
        startIndex += string.length;
        result += string;
      } else {
        break;
      }
    }
    if (startIndex > endIndex) {
      result = result.slice(0, length);
    }
  }
  return result ?? "";
}
__name(getText, "getText");
var Tree = class _Tree {
  static {
    __name(this, "Tree");
  }
  [0] = 0;
  textCallback;
  language;
  constructor(internal, address, language, textCallback) {
    assertInternal(internal);
    this[0] = address;
    this.language = language;
    this.textCallback = textCallback;
  }
  copy() {
    const address = C._ts_tree_copy(this[0]);
    return new _Tree(INTERNAL, address, this.language, this.textCallback);
  }
  delete() {
    C._ts_tree_delete(this[0]);
    this[0] = 0;
  }
  get rootNode() {
    C._ts_tree_root_node_wasm(this[0]);
    return unmarshalNode(this);
  }
  rootNodeWithOffset(offsetBytes, offsetExtent) {
    const address = TRANSFER_BUFFER + SIZE_OF_NODE;
    C.setValue(address, offsetBytes, "i32");
    marshalPoint(address + SIZE_OF_INT, offsetExtent);
    C._ts_tree_root_node_with_offset_wasm(this[0]);
    return unmarshalNode(this);
  }
  edit(edit) {
    marshalEdit(edit);
    C._ts_tree_edit_wasm(this[0]);
  }
  walk() {
    return this.rootNode.walk();
  }
  getChangedRanges(other) {
    if (!(other instanceof _Tree)) {
      throw new TypeError("Argument must be a Tree");
    }
    C._ts_tree_get_changed_ranges_wasm(this[0], other[0]);
    const count = C.getValue(TRANSFER_BUFFER, "i32");
    const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const result = new Array(count);
    if (count > 0) {
      let address = buffer;
      for (let i2 = 0;i2 < count; i2++) {
        result[i2] = unmarshalRange(address);
        address += SIZE_OF_RANGE;
      }
      C._free(buffer);
    }
    return result;
  }
  getIncludedRanges() {
    C._ts_tree_included_ranges_wasm(this[0]);
    const count = C.getValue(TRANSFER_BUFFER, "i32");
    const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const result = new Array(count);
    if (count > 0) {
      let address = buffer;
      for (let i2 = 0;i2 < count; i2++) {
        result[i2] = unmarshalRange(address);
        address += SIZE_OF_RANGE;
      }
      C._free(buffer);
    }
    return result;
  }
};
var TreeCursor = class _TreeCursor {
  static {
    __name(this, "TreeCursor");
  }
  [0] = 0;
  [1] = 0;
  [2] = 0;
  [3] = 0;
  tree;
  constructor(internal, tree) {
    assertInternal(internal);
    this.tree = tree;
    unmarshalTreeCursor(this);
  }
  copy() {
    const copy = new _TreeCursor(INTERNAL, this.tree);
    C._ts_tree_cursor_copy_wasm(this.tree[0]);
    unmarshalTreeCursor(copy);
    return copy;
  }
  delete() {
    marshalTreeCursor(this);
    C._ts_tree_cursor_delete_wasm(this.tree[0]);
    this[0] = this[1] = this[2] = 0;
  }
  get currentNode() {
    marshalTreeCursor(this);
    C._ts_tree_cursor_current_node_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  get currentFieldId() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_field_id_wasm(this.tree[0]);
  }
  get currentFieldName() {
    return this.tree.language.fields[this.currentFieldId];
  }
  get currentDepth() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_depth_wasm(this.tree[0]);
  }
  get currentDescendantIndex() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_descendant_index_wasm(this.tree[0]);
  }
  get nodeType() {
    return this.tree.language.types[this.nodeTypeId] || "ERROR";
  }
  get nodeTypeId() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_node_type_id_wasm(this.tree[0]);
  }
  get nodeStateId() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_node_state_id_wasm(this.tree[0]);
  }
  get nodeId() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_node_id_wasm(this.tree[0]);
  }
  get nodeIsNamed() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_node_is_named_wasm(this.tree[0]) === 1;
  }
  get nodeIsMissing() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_node_is_missing_wasm(this.tree[0]) === 1;
  }
  get nodeText() {
    marshalTreeCursor(this);
    const startIndex = C._ts_tree_cursor_start_index_wasm(this.tree[0]);
    const endIndex = C._ts_tree_cursor_end_index_wasm(this.tree[0]);
    C._ts_tree_cursor_start_position_wasm(this.tree[0]);
    const startPosition = unmarshalPoint(TRANSFER_BUFFER);
    return getText(this.tree, startIndex, endIndex, startPosition);
  }
  get startPosition() {
    marshalTreeCursor(this);
    C._ts_tree_cursor_start_position_wasm(this.tree[0]);
    return unmarshalPoint(TRANSFER_BUFFER);
  }
  get endPosition() {
    marshalTreeCursor(this);
    C._ts_tree_cursor_end_position_wasm(this.tree[0]);
    return unmarshalPoint(TRANSFER_BUFFER);
  }
  get startIndex() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_start_index_wasm(this.tree[0]);
  }
  get endIndex() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_end_index_wasm(this.tree[0]);
  }
  gotoFirstChild() {
    marshalTreeCursor(this);
    const result = C._ts_tree_cursor_goto_first_child_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
    return result === 1;
  }
  gotoLastChild() {
    marshalTreeCursor(this);
    const result = C._ts_tree_cursor_goto_last_child_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
    return result === 1;
  }
  gotoParent() {
    marshalTreeCursor(this);
    const result = C._ts_tree_cursor_goto_parent_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
    return result === 1;
  }
  gotoNextSibling() {
    marshalTreeCursor(this);
    const result = C._ts_tree_cursor_goto_next_sibling_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
    return result === 1;
  }
  gotoPreviousSibling() {
    marshalTreeCursor(this);
    const result = C._ts_tree_cursor_goto_previous_sibling_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
    return result === 1;
  }
  gotoDescendant(goalDescendantIndex) {
    marshalTreeCursor(this);
    C._ts_tree_cursor_goto_descendant_wasm(this.tree[0], goalDescendantIndex);
    unmarshalTreeCursor(this);
  }
  gotoFirstChildForIndex(goalIndex) {
    marshalTreeCursor(this);
    C.setValue(TRANSFER_BUFFER + SIZE_OF_CURSOR, goalIndex, "i32");
    const result = C._ts_tree_cursor_goto_first_child_for_index_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
    return result === 1;
  }
  gotoFirstChildForPosition(goalPosition) {
    marshalTreeCursor(this);
    marshalPoint(TRANSFER_BUFFER + SIZE_OF_CURSOR, goalPosition);
    const result = C._ts_tree_cursor_goto_first_child_for_position_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
    return result === 1;
  }
  reset(node) {
    marshalNode(node);
    marshalTreeCursor(this, TRANSFER_BUFFER + SIZE_OF_NODE);
    C._ts_tree_cursor_reset_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
  }
  resetTo(cursor) {
    marshalTreeCursor(this, TRANSFER_BUFFER);
    marshalTreeCursor(cursor, TRANSFER_BUFFER + SIZE_OF_CURSOR);
    C._ts_tree_cursor_reset_to_wasm(this.tree[0], cursor.tree[0]);
    unmarshalTreeCursor(this);
  }
};
var Node = class {
  static {
    __name(this, "Node");
  }
  [0] = 0;
  _children;
  _namedChildren;
  constructor(internal, {
    id,
    tree,
    startIndex,
    startPosition,
    other
  }) {
    assertInternal(internal);
    this[0] = other;
    this.id = id;
    this.tree = tree;
    this.startIndex = startIndex;
    this.startPosition = startPosition;
  }
  id;
  startIndex;
  startPosition;
  tree;
  get typeId() {
    marshalNode(this);
    return C._ts_node_symbol_wasm(this.tree[0]);
  }
  get grammarId() {
    marshalNode(this);
    return C._ts_node_grammar_symbol_wasm(this.tree[0]);
  }
  get type() {
    return this.tree.language.types[this.typeId] || "ERROR";
  }
  get grammarType() {
    return this.tree.language.types[this.grammarId] || "ERROR";
  }
  get isNamed() {
    marshalNode(this);
    return C._ts_node_is_named_wasm(this.tree[0]) === 1;
  }
  get isExtra() {
    marshalNode(this);
    return C._ts_node_is_extra_wasm(this.tree[0]) === 1;
  }
  get isError() {
    marshalNode(this);
    return C._ts_node_is_error_wasm(this.tree[0]) === 1;
  }
  get isMissing() {
    marshalNode(this);
    return C._ts_node_is_missing_wasm(this.tree[0]) === 1;
  }
  get hasChanges() {
    marshalNode(this);
    return C._ts_node_has_changes_wasm(this.tree[0]) === 1;
  }
  get hasError() {
    marshalNode(this);
    return C._ts_node_has_error_wasm(this.tree[0]) === 1;
  }
  get endIndex() {
    marshalNode(this);
    return C._ts_node_end_index_wasm(this.tree[0]);
  }
  get endPosition() {
    marshalNode(this);
    C._ts_node_end_point_wasm(this.tree[0]);
    return unmarshalPoint(TRANSFER_BUFFER);
  }
  get text() {
    return getText(this.tree, this.startIndex, this.endIndex, this.startPosition);
  }
  get parseState() {
    marshalNode(this);
    return C._ts_node_parse_state_wasm(this.tree[0]);
  }
  get nextParseState() {
    marshalNode(this);
    return C._ts_node_next_parse_state_wasm(this.tree[0]);
  }
  equals(other) {
    return this.tree === other.tree && this.id === other.id;
  }
  child(index) {
    marshalNode(this);
    C._ts_node_child_wasm(this.tree[0], index);
    return unmarshalNode(this.tree);
  }
  namedChild(index) {
    marshalNode(this);
    C._ts_node_named_child_wasm(this.tree[0], index);
    return unmarshalNode(this.tree);
  }
  childForFieldId(fieldId) {
    marshalNode(this);
    C._ts_node_child_by_field_id_wasm(this.tree[0], fieldId);
    return unmarshalNode(this.tree);
  }
  childForFieldName(fieldName) {
    const fieldId = this.tree.language.fields.indexOf(fieldName);
    if (fieldId !== -1)
      return this.childForFieldId(fieldId);
    return null;
  }
  fieldNameForChild(index) {
    marshalNode(this);
    const address = C._ts_node_field_name_for_child_wasm(this.tree[0], index);
    if (!address)
      return null;
    return C.AsciiToString(address);
  }
  fieldNameForNamedChild(index) {
    marshalNode(this);
    const address = C._ts_node_field_name_for_named_child_wasm(this.tree[0], index);
    if (!address)
      return null;
    return C.AsciiToString(address);
  }
  childrenForFieldName(fieldName) {
    const fieldId = this.tree.language.fields.indexOf(fieldName);
    if (fieldId !== -1 && fieldId !== 0)
      return this.childrenForFieldId(fieldId);
    return [];
  }
  childrenForFieldId(fieldId) {
    marshalNode(this);
    C._ts_node_children_by_field_id_wasm(this.tree[0], fieldId);
    const count = C.getValue(TRANSFER_BUFFER, "i32");
    const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const result = new Array(count);
    if (count > 0) {
      let address = buffer;
      for (let i2 = 0;i2 < count; i2++) {
        result[i2] = unmarshalNode(this.tree, address);
        address += SIZE_OF_NODE;
      }
      C._free(buffer);
    }
    return result;
  }
  firstChildForIndex(index) {
    marshalNode(this);
    const address = TRANSFER_BUFFER + SIZE_OF_NODE;
    C.setValue(address, index, "i32");
    C._ts_node_first_child_for_byte_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  firstNamedChildForIndex(index) {
    marshalNode(this);
    const address = TRANSFER_BUFFER + SIZE_OF_NODE;
    C.setValue(address, index, "i32");
    C._ts_node_first_named_child_for_byte_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  get childCount() {
    marshalNode(this);
    return C._ts_node_child_count_wasm(this.tree[0]);
  }
  get namedChildCount() {
    marshalNode(this);
    return C._ts_node_named_child_count_wasm(this.tree[0]);
  }
  get firstChild() {
    return this.child(0);
  }
  get firstNamedChild() {
    return this.namedChild(0);
  }
  get lastChild() {
    return this.child(this.childCount - 1);
  }
  get lastNamedChild() {
    return this.namedChild(this.namedChildCount - 1);
  }
  get children() {
    if (!this._children) {
      marshalNode(this);
      C._ts_node_children_wasm(this.tree[0]);
      const count = C.getValue(TRANSFER_BUFFER, "i32");
      const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      this._children = new Array(count);
      if (count > 0) {
        let address = buffer;
        for (let i2 = 0;i2 < count; i2++) {
          this._children[i2] = unmarshalNode(this.tree, address);
          address += SIZE_OF_NODE;
        }
        C._free(buffer);
      }
    }
    return this._children;
  }
  get namedChildren() {
    if (!this._namedChildren) {
      marshalNode(this);
      C._ts_node_named_children_wasm(this.tree[0]);
      const count = C.getValue(TRANSFER_BUFFER, "i32");
      const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      this._namedChildren = new Array(count);
      if (count > 0) {
        let address = buffer;
        for (let i2 = 0;i2 < count; i2++) {
          this._namedChildren[i2] = unmarshalNode(this.tree, address);
          address += SIZE_OF_NODE;
        }
        C._free(buffer);
      }
    }
    return this._namedChildren;
  }
  descendantsOfType(types, startPosition = ZERO_POINT, endPosition = ZERO_POINT) {
    if (!Array.isArray(types))
      types = [types];
    const symbols = [];
    const typesBySymbol = this.tree.language.types;
    for (const node_type of types) {
      if (node_type == "ERROR") {
        symbols.push(65535);
      }
    }
    for (let i2 = 0, n = typesBySymbol.length;i2 < n; i2++) {
      if (types.includes(typesBySymbol[i2])) {
        symbols.push(i2);
      }
    }
    const symbolsAddress = C._malloc(SIZE_OF_INT * symbols.length);
    for (let i2 = 0, n = symbols.length;i2 < n; i2++) {
      C.setValue(symbolsAddress + i2 * SIZE_OF_INT, symbols[i2], "i32");
    }
    marshalNode(this);
    C._ts_node_descendants_of_type_wasm(this.tree[0], symbolsAddress, symbols.length, startPosition.row, startPosition.column, endPosition.row, endPosition.column);
    const descendantCount = C.getValue(TRANSFER_BUFFER, "i32");
    const descendantAddress = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const result = new Array(descendantCount);
    if (descendantCount > 0) {
      let address = descendantAddress;
      for (let i2 = 0;i2 < descendantCount; i2++) {
        result[i2] = unmarshalNode(this.tree, address);
        address += SIZE_OF_NODE;
      }
    }
    C._free(descendantAddress);
    C._free(symbolsAddress);
    return result;
  }
  get nextSibling() {
    marshalNode(this);
    C._ts_node_next_sibling_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  get previousSibling() {
    marshalNode(this);
    C._ts_node_prev_sibling_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  get nextNamedSibling() {
    marshalNode(this);
    C._ts_node_next_named_sibling_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  get previousNamedSibling() {
    marshalNode(this);
    C._ts_node_prev_named_sibling_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  get descendantCount() {
    marshalNode(this);
    return C._ts_node_descendant_count_wasm(this.tree[0]);
  }
  get parent() {
    marshalNode(this);
    C._ts_node_parent_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  childWithDescendant(descendant) {
    marshalNode(this);
    marshalNode(descendant, 1);
    C._ts_node_child_with_descendant_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  descendantForIndex(start2, end = start2) {
    if (typeof start2 !== "number" || typeof end !== "number") {
      throw new Error("Arguments must be numbers");
    }
    marshalNode(this);
    const address = TRANSFER_BUFFER + SIZE_OF_NODE;
    C.setValue(address, start2, "i32");
    C.setValue(address + SIZE_OF_INT, end, "i32");
    C._ts_node_descendant_for_index_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  namedDescendantForIndex(start2, end = start2) {
    if (typeof start2 !== "number" || typeof end !== "number") {
      throw new Error("Arguments must be numbers");
    }
    marshalNode(this);
    const address = TRANSFER_BUFFER + SIZE_OF_NODE;
    C.setValue(address, start2, "i32");
    C.setValue(address + SIZE_OF_INT, end, "i32");
    C._ts_node_named_descendant_for_index_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  descendantForPosition(start2, end = start2) {
    if (!isPoint(start2) || !isPoint(end)) {
      throw new Error("Arguments must be {row, column} objects");
    }
    marshalNode(this);
    const address = TRANSFER_BUFFER + SIZE_OF_NODE;
    marshalPoint(address, start2);
    marshalPoint(address + SIZE_OF_POINT, end);
    C._ts_node_descendant_for_position_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  namedDescendantForPosition(start2, end = start2) {
    if (!isPoint(start2) || !isPoint(end)) {
      throw new Error("Arguments must be {row, column} objects");
    }
    marshalNode(this);
    const address = TRANSFER_BUFFER + SIZE_OF_NODE;
    marshalPoint(address, start2);
    marshalPoint(address + SIZE_OF_POINT, end);
    C._ts_node_named_descendant_for_position_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  walk() {
    marshalNode(this);
    C._ts_tree_cursor_new_wasm(this.tree[0]);
    return new TreeCursor(INTERNAL, this.tree);
  }
  edit(edit) {
    if (this.startIndex >= edit.oldEndIndex) {
      this.startIndex = edit.newEndIndex + (this.startIndex - edit.oldEndIndex);
      let subbedPointRow;
      let subbedPointColumn;
      if (this.startPosition.row > edit.oldEndPosition.row) {
        subbedPointRow = this.startPosition.row - edit.oldEndPosition.row;
        subbedPointColumn = this.startPosition.column;
      } else {
        subbedPointRow = 0;
        subbedPointColumn = this.startPosition.column;
        if (this.startPosition.column >= edit.oldEndPosition.column) {
          subbedPointColumn = this.startPosition.column - edit.oldEndPosition.column;
        }
      }
      if (subbedPointRow > 0) {
        this.startPosition.row += subbedPointRow;
        this.startPosition.column = subbedPointColumn;
      } else {
        this.startPosition.column += subbedPointColumn;
      }
    } else if (this.startIndex > edit.startIndex) {
      this.startIndex = edit.newEndIndex;
      this.startPosition.row = edit.newEndPosition.row;
      this.startPosition.column = edit.newEndPosition.column;
    }
  }
  toString() {
    marshalNode(this);
    const address = C._ts_node_to_string_wasm(this.tree[0]);
    const result = C.AsciiToString(address);
    C._free(address);
    return result;
  }
};
function unmarshalCaptures(query, tree, address, patternIndex, result) {
  for (let i2 = 0, n = result.length;i2 < n; i2++) {
    const captureIndex = C.getValue(address, "i32");
    address += SIZE_OF_INT;
    const node = unmarshalNode(tree, address);
    address += SIZE_OF_NODE;
    result[i2] = { patternIndex, name: query.captureNames[captureIndex], node };
  }
  return address;
}
__name(unmarshalCaptures, "unmarshalCaptures");
function marshalNode(node, index = 0) {
  let address = TRANSFER_BUFFER + index * SIZE_OF_NODE;
  C.setValue(address, node.id, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, node.startIndex, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, node.startPosition.row, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, node.startPosition.column, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, node[0], "i32");
}
__name(marshalNode, "marshalNode");
function unmarshalNode(tree, address = TRANSFER_BUFFER) {
  const id = C.getValue(address, "i32");
  address += SIZE_OF_INT;
  if (id === 0)
    return null;
  const index = C.getValue(address, "i32");
  address += SIZE_OF_INT;
  const row = C.getValue(address, "i32");
  address += SIZE_OF_INT;
  const column = C.getValue(address, "i32");
  address += SIZE_OF_INT;
  const other = C.getValue(address, "i32");
  const result = new Node(INTERNAL, {
    id,
    tree,
    startIndex: index,
    startPosition: { row, column },
    other
  });
  return result;
}
__name(unmarshalNode, "unmarshalNode");
function marshalTreeCursor(cursor, address = TRANSFER_BUFFER) {
  C.setValue(address + 0 * SIZE_OF_INT, cursor[0], "i32");
  C.setValue(address + 1 * SIZE_OF_INT, cursor[1], "i32");
  C.setValue(address + 2 * SIZE_OF_INT, cursor[2], "i32");
  C.setValue(address + 3 * SIZE_OF_INT, cursor[3], "i32");
}
__name(marshalTreeCursor, "marshalTreeCursor");
function unmarshalTreeCursor(cursor) {
  cursor[0] = C.getValue(TRANSFER_BUFFER + 0 * SIZE_OF_INT, "i32");
  cursor[1] = C.getValue(TRANSFER_BUFFER + 1 * SIZE_OF_INT, "i32");
  cursor[2] = C.getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, "i32");
  cursor[3] = C.getValue(TRANSFER_BUFFER + 3 * SIZE_OF_INT, "i32");
}
__name(unmarshalTreeCursor, "unmarshalTreeCursor");
function marshalPoint(address, point) {
  C.setValue(address, point.row, "i32");
  C.setValue(address + SIZE_OF_INT, point.column, "i32");
}
__name(marshalPoint, "marshalPoint");
function unmarshalPoint(address) {
  const result = {
    row: C.getValue(address, "i32") >>> 0,
    column: C.getValue(address + SIZE_OF_INT, "i32") >>> 0
  };
  return result;
}
__name(unmarshalPoint, "unmarshalPoint");
function marshalRange(address, range) {
  marshalPoint(address, range.startPosition);
  address += SIZE_OF_POINT;
  marshalPoint(address, range.endPosition);
  address += SIZE_OF_POINT;
  C.setValue(address, range.startIndex, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, range.endIndex, "i32");
  address += SIZE_OF_INT;
}
__name(marshalRange, "marshalRange");
function unmarshalRange(address) {
  const result = {};
  result.startPosition = unmarshalPoint(address);
  address += SIZE_OF_POINT;
  result.endPosition = unmarshalPoint(address);
  address += SIZE_OF_POINT;
  result.startIndex = C.getValue(address, "i32") >>> 0;
  address += SIZE_OF_INT;
  result.endIndex = C.getValue(address, "i32") >>> 0;
  return result;
}
__name(unmarshalRange, "unmarshalRange");
function marshalEdit(edit, address = TRANSFER_BUFFER) {
  marshalPoint(address, edit.startPosition);
  address += SIZE_OF_POINT;
  marshalPoint(address, edit.oldEndPosition);
  address += SIZE_OF_POINT;
  marshalPoint(address, edit.newEndPosition);
  address += SIZE_OF_POINT;
  C.setValue(address, edit.startIndex, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, edit.oldEndIndex, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, edit.newEndIndex, "i32");
  address += SIZE_OF_INT;
}
__name(marshalEdit, "marshalEdit");
function unmarshalLanguageMetadata(address) {
  const major_version = C.getValue(address, "i32");
  const minor_version = C.getValue(address += SIZE_OF_INT, "i32");
  const patch_version = C.getValue(address += SIZE_OF_INT, "i32");
  return { major_version, minor_version, patch_version };
}
__name(unmarshalLanguageMetadata, "unmarshalLanguageMetadata");
var PREDICATE_STEP_TYPE_CAPTURE = 1;
var PREDICATE_STEP_TYPE_STRING = 2;
var QUERY_WORD_REGEX = /[\w-]+/g;
var CaptureQuantifier = {
  Zero: 0,
  ZeroOrOne: 1,
  ZeroOrMore: 2,
  One: 3,
  OneOrMore: 4
};
var isCaptureStep = /* @__PURE__ */ __name((step) => step.type === "capture", "isCaptureStep");
var isStringStep = /* @__PURE__ */ __name((step) => step.type === "string", "isStringStep");
var QueryErrorKind = {
  Syntax: 1,
  NodeName: 2,
  FieldName: 3,
  CaptureName: 4,
  PatternStructure: 5
};
var QueryError = class _QueryError extends Error {
  constructor(kind, info2, index, length) {
    super(_QueryError.formatMessage(kind, info2));
    this.kind = kind;
    this.info = info2;
    this.index = index;
    this.length = length;
    this.name = "QueryError";
  }
  static {
    __name(this, "QueryError");
  }
  static formatMessage(kind, info2) {
    switch (kind) {
      case QueryErrorKind.NodeName:
        return `Bad node name '${info2.word}'`;
      case QueryErrorKind.FieldName:
        return `Bad field name '${info2.word}'`;
      case QueryErrorKind.CaptureName:
        return `Bad capture name @${info2.word}`;
      case QueryErrorKind.PatternStructure:
        return `Bad pattern structure at offset ${info2.suffix}`;
      case QueryErrorKind.Syntax:
        return `Bad syntax at offset ${info2.suffix}`;
    }
  }
};
function parseAnyPredicate(steps, index, operator, textPredicates) {
  if (steps.length !== 3) {
    throw new Error(`Wrong number of arguments to \`#${operator}\` predicate. Expected 2, got ${steps.length - 1}`);
  }
  if (!isCaptureStep(steps[1])) {
    throw new Error(`First argument of \`#${operator}\` predicate must be a capture. Got "${steps[1].value}"`);
  }
  const isPositive = operator === "eq?" || operator === "any-eq?";
  const matchAll = !operator.startsWith("any-");
  if (isCaptureStep(steps[2])) {
    const captureName1 = steps[1].name;
    const captureName2 = steps[2].name;
    textPredicates[index].push((captures) => {
      const nodes1 = [];
      const nodes2 = [];
      for (const c of captures) {
        if (c.name === captureName1)
          nodes1.push(c.node);
        if (c.name === captureName2)
          nodes2.push(c.node);
      }
      const compare = /* @__PURE__ */ __name((n1, n2, positive) => {
        return positive ? n1.text === n2.text : n1.text !== n2.text;
      }, "compare");
      return matchAll ? nodes1.every((n1) => nodes2.some((n2) => compare(n1, n2, isPositive))) : nodes1.some((n1) => nodes2.some((n2) => compare(n1, n2, isPositive)));
    });
  } else {
    const captureName = steps[1].name;
    const stringValue = steps[2].value;
    const matches = /* @__PURE__ */ __name((n) => n.text === stringValue, "matches");
    const doesNotMatch = /* @__PURE__ */ __name((n) => n.text !== stringValue, "doesNotMatch");
    textPredicates[index].push((captures) => {
      const nodes = [];
      for (const c of captures) {
        if (c.name === captureName)
          nodes.push(c.node);
      }
      const test = isPositive ? matches : doesNotMatch;
      return matchAll ? nodes.every(test) : nodes.some(test);
    });
  }
}
__name(parseAnyPredicate, "parseAnyPredicate");
function parseMatchPredicate(steps, index, operator, textPredicates) {
  if (steps.length !== 3) {
    throw new Error(`Wrong number of arguments to \`#${operator}\` predicate. Expected 2, got ${steps.length - 1}.`);
  }
  if (steps[1].type !== "capture") {
    throw new Error(`First argument of \`#${operator}\` predicate must be a capture. Got "${steps[1].value}".`);
  }
  if (steps[2].type !== "string") {
    throw new Error(`Second argument of \`#${operator}\` predicate must be a string. Got @${steps[2].name}.`);
  }
  const isPositive = operator === "match?" || operator === "any-match?";
  const matchAll = !operator.startsWith("any-");
  const captureName = steps[1].name;
  const regex = new RegExp(steps[2].value);
  textPredicates[index].push((captures) => {
    const nodes = [];
    for (const c of captures) {
      if (c.name === captureName)
        nodes.push(c.node.text);
    }
    const test = /* @__PURE__ */ __name((text, positive) => {
      return positive ? regex.test(text) : !regex.test(text);
    }, "test");
    if (nodes.length === 0)
      return !isPositive;
    return matchAll ? nodes.every((text) => test(text, isPositive)) : nodes.some((text) => test(text, isPositive));
  });
}
__name(parseMatchPredicate, "parseMatchPredicate");
function parseAnyOfPredicate(steps, index, operator, textPredicates) {
  if (steps.length < 2) {
    throw new Error(`Wrong number of arguments to \`#${operator}\` predicate. Expected at least 1. Got ${steps.length - 1}.`);
  }
  if (steps[1].type !== "capture") {
    throw new Error(`First argument of \`#${operator}\` predicate must be a capture. Got "${steps[1].value}".`);
  }
  const isPositive = operator === "any-of?";
  const captureName = steps[1].name;
  const stringSteps = steps.slice(2);
  if (!stringSteps.every(isStringStep)) {
    throw new Error(`Arguments to \`#${operator}\` predicate must be strings.".`);
  }
  const values = stringSteps.map((s) => s.value);
  textPredicates[index].push((captures) => {
    const nodes = [];
    for (const c of captures) {
      if (c.name === captureName)
        nodes.push(c.node.text);
    }
    if (nodes.length === 0)
      return !isPositive;
    return nodes.every((text) => values.includes(text)) === isPositive;
  });
}
__name(parseAnyOfPredicate, "parseAnyOfPredicate");
function parseIsPredicate(steps, index, operator, assertedProperties, refutedProperties) {
  if (steps.length < 2 || steps.length > 3) {
    throw new Error(`Wrong number of arguments to \`#${operator}\` predicate. Expected 1 or 2. Got ${steps.length - 1}.`);
  }
  if (!steps.every(isStringStep)) {
    throw new Error(`Arguments to \`#${operator}\` predicate must be strings.".`);
  }
  const properties = operator === "is?" ? assertedProperties : refutedProperties;
  if (!properties[index])
    properties[index] = {};
  properties[index][steps[1].value] = steps[2]?.value ?? null;
}
__name(parseIsPredicate, "parseIsPredicate");
function parseSetDirective(steps, index, setProperties) {
  if (steps.length < 2 || steps.length > 3) {
    throw new Error(`Wrong number of arguments to \`#set!\` predicate. Expected 1 or 2. Got ${steps.length - 1}.`);
  }
  if (!steps.every(isStringStep)) {
    throw new Error(`Arguments to \`#set!\` predicate must be strings.".`);
  }
  if (!setProperties[index])
    setProperties[index] = {};
  setProperties[index][steps[1].value] = steps[2]?.value ?? null;
}
__name(parseSetDirective, "parseSetDirective");
function parsePattern(index, stepType, stepValueId, captureNames, stringValues, steps, textPredicates, predicates, setProperties, assertedProperties, refutedProperties) {
  if (stepType === PREDICATE_STEP_TYPE_CAPTURE) {
    const name2 = captureNames[stepValueId];
    steps.push({ type: "capture", name: name2 });
  } else if (stepType === PREDICATE_STEP_TYPE_STRING) {
    steps.push({ type: "string", value: stringValues[stepValueId] });
  } else if (steps.length > 0) {
    if (steps[0].type !== "string") {
      throw new Error("Predicates must begin with a literal value");
    }
    const operator = steps[0].value;
    switch (operator) {
      case "any-not-eq?":
      case "not-eq?":
      case "any-eq?":
      case "eq?":
        parseAnyPredicate(steps, index, operator, textPredicates);
        break;
      case "any-not-match?":
      case "not-match?":
      case "any-match?":
      case "match?":
        parseMatchPredicate(steps, index, operator, textPredicates);
        break;
      case "not-any-of?":
      case "any-of?":
        parseAnyOfPredicate(steps, index, operator, textPredicates);
        break;
      case "is?":
      case "is-not?":
        parseIsPredicate(steps, index, operator, assertedProperties, refutedProperties);
        break;
      case "set!":
        parseSetDirective(steps, index, setProperties);
        break;
      default:
        predicates[index].push({ operator, operands: steps.slice(1) });
    }
    steps.length = 0;
  }
}
__name(parsePattern, "parsePattern");
var Query = class {
  static {
    __name(this, "Query");
  }
  [0] = 0;
  exceededMatchLimit;
  textPredicates;
  captureNames;
  captureQuantifiers;
  predicates;
  setProperties;
  assertedProperties;
  refutedProperties;
  matchLimit;
  constructor(language, source) {
    const sourceLength = C.lengthBytesUTF8(source);
    const sourceAddress = C._malloc(sourceLength + 1);
    C.stringToUTF8(source, sourceAddress, sourceLength + 1);
    const address = C._ts_query_new(language[0], sourceAddress, sourceLength, TRANSFER_BUFFER, TRANSFER_BUFFER + SIZE_OF_INT);
    if (!address) {
      const errorId = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      const errorByte = C.getValue(TRANSFER_BUFFER, "i32");
      const errorIndex = C.UTF8ToString(sourceAddress, errorByte).length;
      const suffix = source.slice(errorIndex, errorIndex + 100).split(`
`)[0];
      const word = suffix.match(QUERY_WORD_REGEX)?.[0] ?? "";
      C._free(sourceAddress);
      switch (errorId) {
        case QueryErrorKind.Syntax:
          throw new QueryError(QueryErrorKind.Syntax, { suffix: `${errorIndex}: '${suffix}'...` }, errorIndex, 0);
        case QueryErrorKind.NodeName:
          throw new QueryError(errorId, { word }, errorIndex, word.length);
        case QueryErrorKind.FieldName:
          throw new QueryError(errorId, { word }, errorIndex, word.length);
        case QueryErrorKind.CaptureName:
          throw new QueryError(errorId, { word }, errorIndex, word.length);
        case QueryErrorKind.PatternStructure:
          throw new QueryError(errorId, { suffix: `${errorIndex}: '${suffix}'...` }, errorIndex, 0);
      }
    }
    const stringCount = C._ts_query_string_count(address);
    const captureCount = C._ts_query_capture_count(address);
    const patternCount = C._ts_query_pattern_count(address);
    const captureNames = new Array(captureCount);
    const captureQuantifiers = new Array(patternCount);
    const stringValues = new Array(stringCount);
    for (let i2 = 0;i2 < captureCount; i2++) {
      const nameAddress = C._ts_query_capture_name_for_id(address, i2, TRANSFER_BUFFER);
      const nameLength = C.getValue(TRANSFER_BUFFER, "i32");
      captureNames[i2] = C.UTF8ToString(nameAddress, nameLength);
    }
    for (let i2 = 0;i2 < patternCount; i2++) {
      const captureQuantifiersArray = new Array(captureCount);
      for (let j = 0;j < captureCount; j++) {
        const quantifier = C._ts_query_capture_quantifier_for_id(address, i2, j);
        captureQuantifiersArray[j] = quantifier;
      }
      captureQuantifiers[i2] = captureQuantifiersArray;
    }
    for (let i2 = 0;i2 < stringCount; i2++) {
      const valueAddress = C._ts_query_string_value_for_id(address, i2, TRANSFER_BUFFER);
      const nameLength = C.getValue(TRANSFER_BUFFER, "i32");
      stringValues[i2] = C.UTF8ToString(valueAddress, nameLength);
    }
    const setProperties = new Array(patternCount);
    const assertedProperties = new Array(patternCount);
    const refutedProperties = new Array(patternCount);
    const predicates = new Array(patternCount);
    const textPredicates = new Array(patternCount);
    for (let i2 = 0;i2 < patternCount; i2++) {
      const predicatesAddress = C._ts_query_predicates_for_pattern(address, i2, TRANSFER_BUFFER);
      const stepCount = C.getValue(TRANSFER_BUFFER, "i32");
      predicates[i2] = [];
      textPredicates[i2] = [];
      const steps = new Array;
      let stepAddress = predicatesAddress;
      for (let j = 0;j < stepCount; j++) {
        const stepType = C.getValue(stepAddress, "i32");
        stepAddress += SIZE_OF_INT;
        const stepValueId = C.getValue(stepAddress, "i32");
        stepAddress += SIZE_OF_INT;
        parsePattern(i2, stepType, stepValueId, captureNames, stringValues, steps, textPredicates, predicates, setProperties, assertedProperties, refutedProperties);
      }
      Object.freeze(textPredicates[i2]);
      Object.freeze(predicates[i2]);
      Object.freeze(setProperties[i2]);
      Object.freeze(assertedProperties[i2]);
      Object.freeze(refutedProperties[i2]);
    }
    C._free(sourceAddress);
    this[0] = address;
    this.captureNames = captureNames;
    this.captureQuantifiers = captureQuantifiers;
    this.textPredicates = textPredicates;
    this.predicates = predicates;
    this.setProperties = setProperties;
    this.assertedProperties = assertedProperties;
    this.refutedProperties = refutedProperties;
    this.exceededMatchLimit = false;
  }
  delete() {
    C._ts_query_delete(this[0]);
    this[0] = 0;
  }
  matches(node, options = {}) {
    const startPosition = options.startPosition ?? ZERO_POINT;
    const endPosition = options.endPosition ?? ZERO_POINT;
    const startIndex = options.startIndex ?? 0;
    const endIndex = options.endIndex ?? 0;
    const matchLimit = options.matchLimit ?? 4294967295;
    const maxStartDepth = options.maxStartDepth ?? 4294967295;
    const timeoutMicros = options.timeoutMicros ?? 0;
    const progressCallback = options.progressCallback;
    if (typeof matchLimit !== "number") {
      throw new Error("Arguments must be numbers");
    }
    this.matchLimit = matchLimit;
    if (endIndex !== 0 && startIndex > endIndex) {
      throw new Error("`startIndex` cannot be greater than `endIndex`");
    }
    if (endPosition !== ZERO_POINT && (startPosition.row > endPosition.row || startPosition.row === endPosition.row && startPosition.column > endPosition.column)) {
      throw new Error("`startPosition` cannot be greater than `endPosition`");
    }
    if (progressCallback) {
      C.currentQueryProgressCallback = progressCallback;
    }
    marshalNode(node);
    C._ts_query_matches_wasm(this[0], node.tree[0], startPosition.row, startPosition.column, endPosition.row, endPosition.column, startIndex, endIndex, matchLimit, maxStartDepth, timeoutMicros);
    const rawCount = C.getValue(TRANSFER_BUFFER, "i32");
    const startAddress = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const didExceedMatchLimit = C.getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, "i32");
    const result = new Array(rawCount);
    this.exceededMatchLimit = Boolean(didExceedMatchLimit);
    let filteredCount = 0;
    let address = startAddress;
    for (let i2 = 0;i2 < rawCount; i2++) {
      const patternIndex = C.getValue(address, "i32");
      address += SIZE_OF_INT;
      const captureCount = C.getValue(address, "i32");
      address += SIZE_OF_INT;
      const captures = new Array(captureCount);
      address = unmarshalCaptures(this, node.tree, address, patternIndex, captures);
      if (this.textPredicates[patternIndex].every((p) => p(captures))) {
        result[filteredCount] = { pattern: patternIndex, patternIndex, captures };
        const setProperties = this.setProperties[patternIndex];
        result[filteredCount].setProperties = setProperties;
        const assertedProperties = this.assertedProperties[patternIndex];
        result[filteredCount].assertedProperties = assertedProperties;
        const refutedProperties = this.refutedProperties[patternIndex];
        result[filteredCount].refutedProperties = refutedProperties;
        filteredCount++;
      }
    }
    result.length = filteredCount;
    C._free(startAddress);
    C.currentQueryProgressCallback = null;
    return result;
  }
  captures(node, options = {}) {
    const startPosition = options.startPosition ?? ZERO_POINT;
    const endPosition = options.endPosition ?? ZERO_POINT;
    const startIndex = options.startIndex ?? 0;
    const endIndex = options.endIndex ?? 0;
    const matchLimit = options.matchLimit ?? 4294967295;
    const maxStartDepth = options.maxStartDepth ?? 4294967295;
    const timeoutMicros = options.timeoutMicros ?? 0;
    const progressCallback = options.progressCallback;
    if (typeof matchLimit !== "number") {
      throw new Error("Arguments must be numbers");
    }
    this.matchLimit = matchLimit;
    if (endIndex !== 0 && startIndex > endIndex) {
      throw new Error("`startIndex` cannot be greater than `endIndex`");
    }
    if (endPosition !== ZERO_POINT && (startPosition.row > endPosition.row || startPosition.row === endPosition.row && startPosition.column > endPosition.column)) {
      throw new Error("`startPosition` cannot be greater than `endPosition`");
    }
    if (progressCallback) {
      C.currentQueryProgressCallback = progressCallback;
    }
    marshalNode(node);
    C._ts_query_captures_wasm(this[0], node.tree[0], startPosition.row, startPosition.column, endPosition.row, endPosition.column, startIndex, endIndex, matchLimit, maxStartDepth, timeoutMicros);
    const count = C.getValue(TRANSFER_BUFFER, "i32");
    const startAddress = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const didExceedMatchLimit = C.getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, "i32");
    const result = new Array;
    this.exceededMatchLimit = Boolean(didExceedMatchLimit);
    const captures = new Array;
    let address = startAddress;
    for (let i2 = 0;i2 < count; i2++) {
      const patternIndex = C.getValue(address, "i32");
      address += SIZE_OF_INT;
      const captureCount = C.getValue(address, "i32");
      address += SIZE_OF_INT;
      const captureIndex = C.getValue(address, "i32");
      address += SIZE_OF_INT;
      captures.length = captureCount;
      address = unmarshalCaptures(this, node.tree, address, patternIndex, captures);
      if (this.textPredicates[patternIndex].every((p) => p(captures))) {
        const capture = captures[captureIndex];
        const setProperties = this.setProperties[patternIndex];
        capture.setProperties = setProperties;
        const assertedProperties = this.assertedProperties[patternIndex];
        capture.assertedProperties = assertedProperties;
        const refutedProperties = this.refutedProperties[patternIndex];
        capture.refutedProperties = refutedProperties;
        result.push(capture);
      }
    }
    C._free(startAddress);
    C.currentQueryProgressCallback = null;
    return result;
  }
  predicatesForPattern(patternIndex) {
    return this.predicates[patternIndex];
  }
  disableCapture(captureName) {
    const captureNameLength = C.lengthBytesUTF8(captureName);
    const captureNameAddress = C._malloc(captureNameLength + 1);
    C.stringToUTF8(captureName, captureNameAddress, captureNameLength + 1);
    C._ts_query_disable_capture(this[0], captureNameAddress, captureNameLength);
    C._free(captureNameAddress);
  }
  disablePattern(patternIndex) {
    if (patternIndex >= this.predicates.length) {
      throw new Error(`Pattern index is ${patternIndex} but the pattern count is ${this.predicates.length}`);
    }
    C._ts_query_disable_pattern(this[0], patternIndex);
  }
  didExceedMatchLimit() {
    return this.exceededMatchLimit;
  }
  startIndexForPattern(patternIndex) {
    if (patternIndex >= this.predicates.length) {
      throw new Error(`Pattern index is ${patternIndex} but the pattern count is ${this.predicates.length}`);
    }
    return C._ts_query_start_byte_for_pattern(this[0], patternIndex);
  }
  endIndexForPattern(patternIndex) {
    if (patternIndex >= this.predicates.length) {
      throw new Error(`Pattern index is ${patternIndex} but the pattern count is ${this.predicates.length}`);
    }
    return C._ts_query_end_byte_for_pattern(this[0], patternIndex);
  }
  patternCount() {
    return C._ts_query_pattern_count(this[0]);
  }
  captureIndexForName(captureName) {
    return this.captureNames.indexOf(captureName);
  }
  isPatternRooted(patternIndex) {
    return C._ts_query_is_pattern_rooted(this[0], patternIndex) === 1;
  }
  isPatternNonLocal(patternIndex) {
    return C._ts_query_is_pattern_non_local(this[0], patternIndex) === 1;
  }
  isPatternGuaranteedAtStep(byteIndex) {
    return C._ts_query_is_pattern_guaranteed_at_step(this[0], byteIndex) === 1;
  }
};
var LANGUAGE_FUNCTION_REGEX = /^tree_sitter_\w+$/;
var Language = class _Language {
  static {
    __name(this, "Language");
  }
  [0] = 0;
  types;
  fields;
  constructor(internal, address) {
    assertInternal(internal);
    this[0] = address;
    this.types = new Array(C._ts_language_symbol_count(this[0]));
    for (let i2 = 0, n = this.types.length;i2 < n; i2++) {
      if (C._ts_language_symbol_type(this[0], i2) < 2) {
        this.types[i2] = C.UTF8ToString(C._ts_language_symbol_name(this[0], i2));
      }
    }
    this.fields = new Array(C._ts_language_field_count(this[0]) + 1);
    for (let i2 = 0, n = this.fields.length;i2 < n; i2++) {
      const fieldName = C._ts_language_field_name_for_id(this[0], i2);
      if (fieldName !== 0) {
        this.fields[i2] = C.UTF8ToString(fieldName);
      } else {
        this.fields[i2] = null;
      }
    }
  }
  get name() {
    const ptr = C._ts_language_name(this[0]);
    if (ptr === 0)
      return null;
    return C.UTF8ToString(ptr);
  }
  get version() {
    return C._ts_language_version(this[0]);
  }
  get abiVersion() {
    return C._ts_language_abi_version(this[0]);
  }
  get metadata() {
    C._ts_language_metadata(this[0]);
    const length = C.getValue(TRANSFER_BUFFER, "i32");
    const address = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    if (length === 0)
      return null;
    return unmarshalLanguageMetadata(address);
  }
  get fieldCount() {
    return this.fields.length - 1;
  }
  get stateCount() {
    return C._ts_language_state_count(this[0]);
  }
  fieldIdForName(fieldName) {
    const result = this.fields.indexOf(fieldName);
    return result !== -1 ? result : null;
  }
  fieldNameForId(fieldId) {
    return this.fields[fieldId] ?? null;
  }
  idForNodeType(type, named) {
    const typeLength = C.lengthBytesUTF8(type);
    const typeAddress = C._malloc(typeLength + 1);
    C.stringToUTF8(type, typeAddress, typeLength + 1);
    const result = C._ts_language_symbol_for_name(this[0], typeAddress, typeLength, named ? 1 : 0);
    C._free(typeAddress);
    return result || null;
  }
  get nodeTypeCount() {
    return C._ts_language_symbol_count(this[0]);
  }
  nodeTypeForId(typeId) {
    const name2 = C._ts_language_symbol_name(this[0], typeId);
    return name2 ? C.UTF8ToString(name2) : null;
  }
  nodeTypeIsNamed(typeId) {
    return C._ts_language_type_is_named_wasm(this[0], typeId) ? true : false;
  }
  nodeTypeIsVisible(typeId) {
    return C._ts_language_type_is_visible_wasm(this[0], typeId) ? true : false;
  }
  get supertypes() {
    C._ts_language_supertypes_wasm(this[0]);
    const count = C.getValue(TRANSFER_BUFFER, "i32");
    const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const result = new Array(count);
    if (count > 0) {
      let address = buffer;
      for (let i2 = 0;i2 < count; i2++) {
        result[i2] = C.getValue(address, "i16");
        address += SIZE_OF_SHORT;
      }
    }
    return result;
  }
  subtypes(supertype) {
    C._ts_language_subtypes_wasm(this[0], supertype);
    const count = C.getValue(TRANSFER_BUFFER, "i32");
    const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const result = new Array(count);
    if (count > 0) {
      let address = buffer;
      for (let i2 = 0;i2 < count; i2++) {
        result[i2] = C.getValue(address, "i16");
        address += SIZE_OF_SHORT;
      }
    }
    return result;
  }
  nextState(stateId, typeId) {
    return C._ts_language_next_state(this[0], stateId, typeId);
  }
  lookaheadIterator(stateId) {
    const address = C._ts_lookahead_iterator_new(this[0], stateId);
    if (address)
      return new LookaheadIterator(INTERNAL, address, this);
    return null;
  }
  query(source) {
    console.warn("Language.query is deprecated. Use new Query(language, source) instead.");
    return new Query(this, source);
  }
  static async load(input) {
    let bytes;
    if (input instanceof Uint8Array) {
      bytes = Promise.resolve(input);
    } else {
      if (globalThis.process?.versions.node) {
        const fs2 = await import("fs/promises");
        bytes = fs2.readFile(input);
      } else {
        bytes = fetch(input).then((response) => response.arrayBuffer().then((buffer) => {
          if (response.ok) {
            return new Uint8Array(buffer);
          } else {
            const body2 = new TextDecoder("utf-8").decode(buffer);
            throw new Error(`Language.load failed with status ${response.status}.

${body2}`);
          }
        }));
      }
    }
    const mod = await C.loadWebAssemblyModule(await bytes, { loadAsync: true });
    const symbolNames = Object.keys(mod);
    const functionName = symbolNames.find((key) => LANGUAGE_FUNCTION_REGEX.test(key) && !key.includes("external_scanner_"));
    if (!functionName) {
      console.log(`Couldn't find language function in WASM file. Symbols:
${JSON.stringify(symbolNames, null, 2)}`);
      throw new Error("Language.load failed: no language function found in WASM file");
    }
    const languageAddress = mod[functionName]();
    return new _Language(INTERNAL, languageAddress);
  }
};
var Module2 = (() => {
  var _scriptName = import.meta.url;
  return async function(moduleArg = {}) {
    var moduleRtn;
    var Module = moduleArg;
    var readyPromiseResolve, readyPromiseReject;
    var readyPromise = new Promise((resolve, reject) => {
      readyPromiseResolve = resolve;
      readyPromiseReject = reject;
    });
    var ENVIRONMENT_IS_WEB = typeof window == "object";
    var ENVIRONMENT_IS_WORKER = typeof WorkerGlobalScope != "undefined";
    var ENVIRONMENT_IS_NODE = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string" && process.type != "renderer";
    var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;
    if (ENVIRONMENT_IS_NODE) {
      const { createRequire: createRequire2 } = await import("module");
      var require = createRequire2(import.meta.url);
    }
    Module.currentQueryProgressCallback = null;
    Module.currentProgressCallback = null;
    Module.currentLogCallback = null;
    Module.currentParseCallback = null;
    var moduleOverrides = Object.assign({}, Module);
    var arguments_ = [];
    var thisProgram = "./this.program";
    var quit_ = /* @__PURE__ */ __name((status, toThrow) => {
      throw toThrow;
    }, "quit_");
    var scriptDirectory = "";
    function locateFile(path) {
      if (Module["locateFile"]) {
        return Module["locateFile"](path, scriptDirectory);
      }
      return scriptDirectory + path;
    }
    __name(locateFile, "locateFile");
    var readAsync, readBinary;
    if (ENVIRONMENT_IS_NODE) {
      var fs = require("fs");
      var nodePath = require("path");
      if (!import.meta.url.startsWith("data:")) {
        scriptDirectory = nodePath.dirname(require("url").fileURLToPath(import.meta.url)) + "/";
      }
      readBinary = /* @__PURE__ */ __name((filename) => {
        filename = isFileURI(filename) ? new URL(filename) : filename;
        var ret = fs.readFileSync(filename);
        return ret;
      }, "readBinary");
      readAsync = /* @__PURE__ */ __name(async (filename, binary2 = true) => {
        filename = isFileURI(filename) ? new URL(filename) : filename;
        var ret = fs.readFileSync(filename, binary2 ? undefined : "utf8");
        return ret;
      }, "readAsync");
      if (!Module["thisProgram"] && process.argv.length > 1) {
        thisProgram = process.argv[1].replace(/\\/g, "/");
      }
      arguments_ = process.argv.slice(2);
      quit_ = /* @__PURE__ */ __name((status, toThrow) => {
        process.exitCode = status;
        throw toThrow;
      }, "quit_");
    } else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
      if (ENVIRONMENT_IS_WORKER) {
        scriptDirectory = self.location.href;
      } else if (typeof document != "undefined" && document.currentScript) {
        scriptDirectory = document.currentScript.src;
      }
      if (_scriptName) {
        scriptDirectory = _scriptName;
      }
      if (scriptDirectory.startsWith("blob:")) {
        scriptDirectory = "";
      } else {
        scriptDirectory = scriptDirectory.slice(0, scriptDirectory.replace(/[?#].*/, "").lastIndexOf("/") + 1);
      }
      {
        if (ENVIRONMENT_IS_WORKER) {
          readBinary = /* @__PURE__ */ __name((url) => {
            var xhr = new XMLHttpRequest;
            xhr.open("GET", url, false);
            xhr.responseType = "arraybuffer";
            xhr.send(null);
            return new Uint8Array(xhr.response);
          }, "readBinary");
        }
        readAsync = /* @__PURE__ */ __name(async (url) => {
          if (isFileURI(url)) {
            return new Promise((resolve, reject) => {
              var xhr = new XMLHttpRequest;
              xhr.open("GET", url, true);
              xhr.responseType = "arraybuffer";
              xhr.onload = () => {
                if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
                  resolve(xhr.response);
                  return;
                }
                reject(xhr.status);
              };
              xhr.onerror = reject;
              xhr.send(null);
            });
          }
          var response = await fetch(url, {
            credentials: "same-origin"
          });
          if (response.ok) {
            return response.arrayBuffer();
          }
          throw new Error(response.status + " : " + response.url);
        }, "readAsync");
      }
    }
    var out = Module["print"] || console.log.bind(console);
    var err = Module["printErr"] || console.error.bind(console);
    Object.assign(Module, moduleOverrides);
    moduleOverrides = null;
    if (Module["arguments"])
      arguments_ = Module["arguments"];
    if (Module["thisProgram"])
      thisProgram = Module["thisProgram"];
    var dynamicLibraries = Module["dynamicLibraries"] || [];
    var wasmBinary = Module["wasmBinary"];
    var wasmMemory;
    var ABORT = false;
    var EXITSTATUS;
    function assert(condition, text) {
      if (!condition) {
        abort(text);
      }
    }
    __name(assert, "assert");
    var HEAP, HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAP64, HEAPU64, HEAPF64;
    var HEAP_DATA_VIEW;
    var runtimeInitialized = false;
    var isFileURI = /* @__PURE__ */ __name((filename) => filename.startsWith("file://"), "isFileURI");
    function updateMemoryViews() {
      var b = wasmMemory.buffer;
      Module["HEAP_DATA_VIEW"] = HEAP_DATA_VIEW = new DataView(b);
      Module["HEAP8"] = HEAP8 = new Int8Array(b);
      Module["HEAP16"] = HEAP16 = new Int16Array(b);
      Module["HEAPU8"] = HEAPU8 = new Uint8Array(b);
      Module["HEAPU16"] = HEAPU16 = new Uint16Array(b);
      Module["HEAP32"] = HEAP32 = new Int32Array(b);
      Module["HEAPU32"] = HEAPU32 = new Uint32Array(b);
      Module["HEAPF32"] = HEAPF32 = new Float32Array(b);
      Module["HEAPF64"] = HEAPF64 = new Float64Array(b);
      Module["HEAP64"] = HEAP64 = new BigInt64Array(b);
      Module["HEAPU64"] = HEAPU64 = new BigUint64Array(b);
    }
    __name(updateMemoryViews, "updateMemoryViews");
    if (Module["wasmMemory"]) {
      wasmMemory = Module["wasmMemory"];
    } else {
      var INITIAL_MEMORY = Module["INITIAL_MEMORY"] || 33554432;
      wasmMemory = new WebAssembly.Memory({
        initial: INITIAL_MEMORY / 65536,
        maximum: 32768
      });
    }
    updateMemoryViews();
    var __RELOC_FUNCS__ = [];
    function preRun() {
      if (Module["preRun"]) {
        if (typeof Module["preRun"] == "function")
          Module["preRun"] = [Module["preRun"]];
        while (Module["preRun"].length) {
          addOnPreRun(Module["preRun"].shift());
        }
      }
      callRuntimeCallbacks(onPreRuns);
    }
    __name(preRun, "preRun");
    function initRuntime() {
      runtimeInitialized = true;
      callRuntimeCallbacks(__RELOC_FUNCS__);
      wasmExports["__wasm_call_ctors"]();
      callRuntimeCallbacks(onPostCtors);
    }
    __name(initRuntime, "initRuntime");
    function preMain() {}
    __name(preMain, "preMain");
    function postRun() {
      if (Module["postRun"]) {
        if (typeof Module["postRun"] == "function")
          Module["postRun"] = [Module["postRun"]];
        while (Module["postRun"].length) {
          addOnPostRun(Module["postRun"].shift());
        }
      }
      callRuntimeCallbacks(onPostRuns);
    }
    __name(postRun, "postRun");
    var runDependencies = 0;
    var dependenciesFulfilled = null;
    function getUniqueRunDependency(id) {
      return id;
    }
    __name(getUniqueRunDependency, "getUniqueRunDependency");
    function addRunDependency(id) {
      runDependencies++;
      Module["monitorRunDependencies"]?.(runDependencies);
    }
    __name(addRunDependency, "addRunDependency");
    function removeRunDependency(id) {
      runDependencies--;
      Module["monitorRunDependencies"]?.(runDependencies);
      if (runDependencies == 0) {
        if (dependenciesFulfilled) {
          var callback = dependenciesFulfilled;
          dependenciesFulfilled = null;
          callback();
        }
      }
    }
    __name(removeRunDependency, "removeRunDependency");
    function abort(what) {
      Module["onAbort"]?.(what);
      what = "Aborted(" + what + ")";
      err(what);
      ABORT = true;
      what += ". Build with -sASSERTIONS for more info.";
      var e = new WebAssembly.RuntimeError(what);
      readyPromiseReject(e);
      throw e;
    }
    __name(abort, "abort");
    var wasmBinaryFile;
    function findWasmBinary() {
      if (Module["locateFile"]) {
        return locateFile("tree-sitter.wasm");
      }
      return new URL("tree-sitter.wasm", import.meta.url).href;
    }
    __name(findWasmBinary, "findWasmBinary");
    function getBinarySync(file) {
      if (file == wasmBinaryFile && wasmBinary) {
        return new Uint8Array(wasmBinary);
      }
      if (readBinary) {
        return readBinary(file);
      }
      throw "both async and sync fetching of the wasm failed";
    }
    __name(getBinarySync, "getBinarySync");
    async function getWasmBinary(binaryFile) {
      if (!wasmBinary) {
        try {
          var response = await readAsync(binaryFile);
          return new Uint8Array(response);
        } catch {}
      }
      return getBinarySync(binaryFile);
    }
    __name(getWasmBinary, "getWasmBinary");
    async function instantiateArrayBuffer(binaryFile, imports) {
      try {
        var binary2 = await getWasmBinary(binaryFile);
        var instance2 = await WebAssembly.instantiate(binary2, imports);
        return instance2;
      } catch (reason) {
        err(`failed to asynchronously prepare wasm: ${reason}`);
        abort(reason);
      }
    }
    __name(instantiateArrayBuffer, "instantiateArrayBuffer");
    async function instantiateAsync(binary2, binaryFile, imports) {
      if (!binary2 && typeof WebAssembly.instantiateStreaming == "function" && !isFileURI(binaryFile) && !ENVIRONMENT_IS_NODE) {
        try {
          var response = fetch(binaryFile, {
            credentials: "same-origin"
          });
          var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
          return instantiationResult;
        } catch (reason) {
          err(`wasm streaming compile failed: ${reason}`);
          err("falling back to ArrayBuffer instantiation");
        }
      }
      return instantiateArrayBuffer(binaryFile, imports);
    }
    __name(instantiateAsync, "instantiateAsync");
    function getWasmImports() {
      return {
        env: wasmImports,
        wasi_snapshot_preview1: wasmImports,
        "GOT.mem": new Proxy(wasmImports, GOTHandler),
        "GOT.func": new Proxy(wasmImports, GOTHandler)
      };
    }
    __name(getWasmImports, "getWasmImports");
    async function createWasm() {
      function receiveInstance(instance2, module2) {
        wasmExports = instance2.exports;
        wasmExports = relocateExports(wasmExports, 1024);
        var metadata2 = getDylinkMetadata(module2);
        if (metadata2.neededDynlibs) {
          dynamicLibraries = metadata2.neededDynlibs.concat(dynamicLibraries);
        }
        mergeLibSymbols(wasmExports, "main");
        LDSO.init();
        loadDylibs();
        __RELOC_FUNCS__.push(wasmExports["__wasm_apply_data_relocs"]);
        removeRunDependency("wasm-instantiate");
        return wasmExports;
      }
      __name(receiveInstance, "receiveInstance");
      addRunDependency("wasm-instantiate");
      function receiveInstantiationResult(result2) {
        return receiveInstance(result2["instance"], result2["module"]);
      }
      __name(receiveInstantiationResult, "receiveInstantiationResult");
      var info2 = getWasmImports();
      if (Module["instantiateWasm"]) {
        return new Promise((resolve, reject) => {
          Module["instantiateWasm"](info2, (mod, inst) => {
            receiveInstance(mod, inst);
            resolve(mod.exports);
          });
        });
      }
      wasmBinaryFile ??= findWasmBinary();
      try {
        var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info2);
        var exports = receiveInstantiationResult(result);
        return exports;
      } catch (e) {
        readyPromiseReject(e);
        return Promise.reject(e);
      }
    }
    __name(createWasm, "createWasm");
    var ASM_CONSTS = {};

    class ExitStatus {
      static {
        __name(this, "ExitStatus");
      }
      name = "ExitStatus";
      constructor(status) {
        this.message = `Program terminated with exit(${status})`;
        this.status = status;
      }
    }
    var GOT = {};
    var currentModuleWeakSymbols = /* @__PURE__ */ new Set([]);
    var GOTHandler = {
      get(obj, symName) {
        var rtn = GOT[symName];
        if (!rtn) {
          rtn = GOT[symName] = new WebAssembly.Global({
            value: "i32",
            mutable: true
          });
        }
        if (!currentModuleWeakSymbols.has(symName)) {
          rtn.required = true;
        }
        return rtn;
      }
    };
    var LE_HEAP_LOAD_F32 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getFloat32(byteOffset, true), "LE_HEAP_LOAD_F32");
    var LE_HEAP_LOAD_F64 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getFloat64(byteOffset, true), "LE_HEAP_LOAD_F64");
    var LE_HEAP_LOAD_I16 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getInt16(byteOffset, true), "LE_HEAP_LOAD_I16");
    var LE_HEAP_LOAD_I32 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getInt32(byteOffset, true), "LE_HEAP_LOAD_I32");
    var LE_HEAP_LOAD_U16 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getUint16(byteOffset, true), "LE_HEAP_LOAD_U16");
    var LE_HEAP_LOAD_U32 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getUint32(byteOffset, true), "LE_HEAP_LOAD_U32");
    var LE_HEAP_STORE_F32 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setFloat32(byteOffset, value, true), "LE_HEAP_STORE_F32");
    var LE_HEAP_STORE_F64 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setFloat64(byteOffset, value, true), "LE_HEAP_STORE_F64");
    var LE_HEAP_STORE_I16 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setInt16(byteOffset, value, true), "LE_HEAP_STORE_I16");
    var LE_HEAP_STORE_I32 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setInt32(byteOffset, value, true), "LE_HEAP_STORE_I32");
    var LE_HEAP_STORE_U16 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setUint16(byteOffset, value, true), "LE_HEAP_STORE_U16");
    var LE_HEAP_STORE_U32 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setUint32(byteOffset, value, true), "LE_HEAP_STORE_U32");
    var callRuntimeCallbacks = /* @__PURE__ */ __name((callbacks) => {
      while (callbacks.length > 0) {
        callbacks.shift()(Module);
      }
    }, "callRuntimeCallbacks");
    var onPostRuns = [];
    var addOnPostRun = /* @__PURE__ */ __name((cb) => onPostRuns.unshift(cb), "addOnPostRun");
    var onPreRuns = [];
    var addOnPreRun = /* @__PURE__ */ __name((cb) => onPreRuns.unshift(cb), "addOnPreRun");
    var UTF8Decoder = typeof TextDecoder != "undefined" ? new TextDecoder : undefined;
    var UTF8ArrayToString = /* @__PURE__ */ __name((heapOrArray, idx = 0, maxBytesToRead = NaN) => {
      var endIdx = idx + maxBytesToRead;
      var endPtr = idx;
      while (heapOrArray[endPtr] && !(endPtr >= endIdx))
        ++endPtr;
      if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
        return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
      }
      var str = "";
      while (idx < endPtr) {
        var u0 = heapOrArray[idx++];
        if (!(u0 & 128)) {
          str += String.fromCharCode(u0);
          continue;
        }
        var u1 = heapOrArray[idx++] & 63;
        if ((u0 & 224) == 192) {
          str += String.fromCharCode((u0 & 31) << 6 | u1);
          continue;
        }
        var u2 = heapOrArray[idx++] & 63;
        if ((u0 & 240) == 224) {
          u0 = (u0 & 15) << 12 | u1 << 6 | u2;
        } else {
          u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
        }
        if (u0 < 65536) {
          str += String.fromCharCode(u0);
        } else {
          var ch = u0 - 65536;
          str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
        }
      }
      return str;
    }, "UTF8ArrayToString");
    var getDylinkMetadata = /* @__PURE__ */ __name((binary2) => {
      var offset = 0;
      var end = 0;
      function getU8() {
        return binary2[offset++];
      }
      __name(getU8, "getU8");
      function getLEB() {
        var ret = 0;
        var mul = 1;
        while (true) {
          var byte = binary2[offset++];
          ret += (byte & 127) * mul;
          mul *= 128;
          if (!(byte & 128))
            break;
        }
        return ret;
      }
      __name(getLEB, "getLEB");
      function getString() {
        var len = getLEB();
        offset += len;
        return UTF8ArrayToString(binary2, offset - len, len);
      }
      __name(getString, "getString");
      function failIf(condition, message) {
        if (condition)
          throw new Error(message);
      }
      __name(failIf, "failIf");
      var name2 = "dylink.0";
      if (binary2 instanceof WebAssembly.Module) {
        var dylinkSection = WebAssembly.Module.customSections(binary2, name2);
        if (dylinkSection.length === 0) {
          name2 = "dylink";
          dylinkSection = WebAssembly.Module.customSections(binary2, name2);
        }
        failIf(dylinkSection.length === 0, "need dylink section");
        binary2 = new Uint8Array(dylinkSection[0]);
        end = binary2.length;
      } else {
        var int32View = new Uint32Array(new Uint8Array(binary2.subarray(0, 24)).buffer);
        var magicNumberFound = int32View[0] == 1836278016 || int32View[0] == 6386541;
        failIf(!magicNumberFound, "need to see wasm magic number");
        failIf(binary2[8] !== 0, "need the dylink section to be first");
        offset = 9;
        var section_size = getLEB();
        end = offset + section_size;
        name2 = getString();
      }
      var customSection = {
        neededDynlibs: [],
        tlsExports: /* @__PURE__ */ new Set,
        weakImports: /* @__PURE__ */ new Set
      };
      if (name2 == "dylink") {
        customSection.memorySize = getLEB();
        customSection.memoryAlign = getLEB();
        customSection.tableSize = getLEB();
        customSection.tableAlign = getLEB();
        var neededDynlibsCount = getLEB();
        for (var i2 = 0;i2 < neededDynlibsCount; ++i2) {
          var libname = getString();
          customSection.neededDynlibs.push(libname);
        }
      } else {
        failIf(name2 !== "dylink.0");
        var WASM_DYLINK_MEM_INFO = 1;
        var WASM_DYLINK_NEEDED = 2;
        var WASM_DYLINK_EXPORT_INFO = 3;
        var WASM_DYLINK_IMPORT_INFO = 4;
        var WASM_SYMBOL_TLS = 256;
        var WASM_SYMBOL_BINDING_MASK = 3;
        var WASM_SYMBOL_BINDING_WEAK = 1;
        while (offset < end) {
          var subsectionType = getU8();
          var subsectionSize = getLEB();
          if (subsectionType === WASM_DYLINK_MEM_INFO) {
            customSection.memorySize = getLEB();
            customSection.memoryAlign = getLEB();
            customSection.tableSize = getLEB();
            customSection.tableAlign = getLEB();
          } else if (subsectionType === WASM_DYLINK_NEEDED) {
            var neededDynlibsCount = getLEB();
            for (var i2 = 0;i2 < neededDynlibsCount; ++i2) {
              libname = getString();
              customSection.neededDynlibs.push(libname);
            }
          } else if (subsectionType === WASM_DYLINK_EXPORT_INFO) {
            var count = getLEB();
            while (count--) {
              var symname = getString();
              var flags2 = getLEB();
              if (flags2 & WASM_SYMBOL_TLS) {
                customSection.tlsExports.add(symname);
              }
            }
          } else if (subsectionType === WASM_DYLINK_IMPORT_INFO) {
            var count = getLEB();
            while (count--) {
              var modname = getString();
              var symname = getString();
              var flags2 = getLEB();
              if ((flags2 & WASM_SYMBOL_BINDING_MASK) == WASM_SYMBOL_BINDING_WEAK) {
                customSection.weakImports.add(symname);
              }
            }
          } else {
            offset += subsectionSize;
          }
        }
      }
      return customSection;
    }, "getDylinkMetadata");
    function getValue(ptr, type = "i8") {
      if (type.endsWith("*"))
        type = "*";
      switch (type) {
        case "i1":
          return HEAP8[ptr];
        case "i8":
          return HEAP8[ptr];
        case "i16":
          return LE_HEAP_LOAD_I16((ptr >> 1) * 2);
        case "i32":
          return LE_HEAP_LOAD_I32((ptr >> 2) * 4);
        case "i64":
          return HEAP64[ptr >> 3];
        case "float":
          return LE_HEAP_LOAD_F32((ptr >> 2) * 4);
        case "double":
          return LE_HEAP_LOAD_F64((ptr >> 3) * 8);
        case "*":
          return LE_HEAP_LOAD_U32((ptr >> 2) * 4);
        default:
          abort(`invalid type for getValue: ${type}`);
      }
    }
    __name(getValue, "getValue");
    var newDSO = /* @__PURE__ */ __name((name2, handle2, syms) => {
      var dso = {
        refcount: Infinity,
        name: name2,
        exports: syms,
        global: true
      };
      LDSO.loadedLibsByName[name2] = dso;
      if (handle2 != null) {
        LDSO.loadedLibsByHandle[handle2] = dso;
      }
      return dso;
    }, "newDSO");
    var LDSO = {
      loadedLibsByName: {},
      loadedLibsByHandle: {},
      init() {
        newDSO("__main__", 0, wasmImports);
      }
    };
    var ___heap_base = 78224;
    var alignMemory = /* @__PURE__ */ __name((size, alignment) => Math.ceil(size / alignment) * alignment, "alignMemory");
    var getMemory = /* @__PURE__ */ __name((size) => {
      if (runtimeInitialized) {
        return _calloc(size, 1);
      }
      var ret = ___heap_base;
      var end = ret + alignMemory(size, 16);
      ___heap_base = end;
      GOT["__heap_base"].value = end;
      return ret;
    }, "getMemory");
    var isInternalSym = /* @__PURE__ */ __name((symName) => ["__cpp_exception", "__c_longjmp", "__wasm_apply_data_relocs", "__dso_handle", "__tls_size", "__tls_align", "__set_stack_limits", "_emscripten_tls_init", "__wasm_init_tls", "__wasm_call_ctors", "__start_em_asm", "__stop_em_asm", "__start_em_js", "__stop_em_js"].includes(symName) || symName.startsWith("__em_js__"), "isInternalSym");
    var uleb128Encode = /* @__PURE__ */ __name((n, target) => {
      if (n < 128) {
        target.push(n);
      } else {
        target.push(n % 128 | 128, n >> 7);
      }
    }, "uleb128Encode");
    var sigToWasmTypes = /* @__PURE__ */ __name((sig) => {
      var typeNames = {
        i: "i32",
        j: "i64",
        f: "f32",
        d: "f64",
        e: "externref",
        p: "i32"
      };
      var type = {
        parameters: [],
        results: sig[0] == "v" ? [] : [typeNames[sig[0]]]
      };
      for (var i2 = 1;i2 < sig.length; ++i2) {
        type.parameters.push(typeNames[sig[i2]]);
      }
      return type;
    }, "sigToWasmTypes");
    var generateFuncType = /* @__PURE__ */ __name((sig, target) => {
      var sigRet = sig.slice(0, 1);
      var sigParam = sig.slice(1);
      var typeCodes = {
        i: 127,
        p: 127,
        j: 126,
        f: 125,
        d: 124,
        e: 111
      };
      target.push(96);
      uleb128Encode(sigParam.length, target);
      for (var i2 = 0;i2 < sigParam.length; ++i2) {
        target.push(typeCodes[sigParam[i2]]);
      }
      if (sigRet == "v") {
        target.push(0);
      } else {
        target.push(1, typeCodes[sigRet]);
      }
    }, "generateFuncType");
    var convertJsFunctionToWasm = /* @__PURE__ */ __name((func2, sig) => {
      if (typeof WebAssembly.Function == "function") {
        return new WebAssembly.Function(sigToWasmTypes(sig), func2);
      }
      var typeSectionBody = [1];
      generateFuncType(sig, typeSectionBody);
      var bytes = [
        0,
        97,
        115,
        109,
        1,
        0,
        0,
        0,
        1
      ];
      uleb128Encode(typeSectionBody.length, bytes);
      bytes.push(...typeSectionBody);
      bytes.push(2, 7, 1, 1, 101, 1, 102, 0, 0, 7, 5, 1, 1, 102, 0, 0);
      var module2 = new WebAssembly.Module(new Uint8Array(bytes));
      var instance2 = new WebAssembly.Instance(module2, {
        e: {
          f: func2
        }
      });
      var wrappedFunc = instance2.exports["f"];
      return wrappedFunc;
    }, "convertJsFunctionToWasm");
    var wasmTableMirror = [];
    var wasmTable = new WebAssembly.Table({
      initial: 31,
      element: "anyfunc"
    });
    var getWasmTableEntry = /* @__PURE__ */ __name((funcPtr) => {
      var func2 = wasmTableMirror[funcPtr];
      if (!func2) {
        if (funcPtr >= wasmTableMirror.length)
          wasmTableMirror.length = funcPtr + 1;
        wasmTableMirror[funcPtr] = func2 = wasmTable.get(funcPtr);
      }
      return func2;
    }, "getWasmTableEntry");
    var updateTableMap = /* @__PURE__ */ __name((offset, count) => {
      if (functionsInTableMap) {
        for (var i2 = offset;i2 < offset + count; i2++) {
          var item = getWasmTableEntry(i2);
          if (item) {
            functionsInTableMap.set(item, i2);
          }
        }
      }
    }, "updateTableMap");
    var functionsInTableMap;
    var getFunctionAddress = /* @__PURE__ */ __name((func2) => {
      if (!functionsInTableMap) {
        functionsInTableMap = /* @__PURE__ */ new WeakMap;
        updateTableMap(0, wasmTable.length);
      }
      return functionsInTableMap.get(func2) || 0;
    }, "getFunctionAddress");
    var freeTableIndexes = [];
    var getEmptyTableSlot = /* @__PURE__ */ __name(() => {
      if (freeTableIndexes.length) {
        return freeTableIndexes.pop();
      }
      try {
        wasmTable.grow(1);
      } catch (err2) {
        if (!(err2 instanceof RangeError)) {
          throw err2;
        }
        throw "Unable to grow wasm table. Set ALLOW_TABLE_GROWTH.";
      }
      return wasmTable.length - 1;
    }, "getEmptyTableSlot");
    var setWasmTableEntry = /* @__PURE__ */ __name((idx, func2) => {
      wasmTable.set(idx, func2);
      wasmTableMirror[idx] = wasmTable.get(idx);
    }, "setWasmTableEntry");
    var addFunction = /* @__PURE__ */ __name((func2, sig) => {
      var rtn = getFunctionAddress(func2);
      if (rtn) {
        return rtn;
      }
      var ret = getEmptyTableSlot();
      try {
        setWasmTableEntry(ret, func2);
      } catch (err2) {
        if (!(err2 instanceof TypeError)) {
          throw err2;
        }
        var wrapped = convertJsFunctionToWasm(func2, sig);
        setWasmTableEntry(ret, wrapped);
      }
      functionsInTableMap.set(func2, ret);
      return ret;
    }, "addFunction");
    var updateGOT = /* @__PURE__ */ __name((exports, replace) => {
      for (var symName in exports) {
        if (isInternalSym(symName)) {
          continue;
        }
        var value = exports[symName];
        GOT[symName] ||= new WebAssembly.Global({
          value: "i32",
          mutable: true
        });
        if (replace || GOT[symName].value == 0) {
          if (typeof value == "function") {
            GOT[symName].value = addFunction(value);
          } else if (typeof value == "number") {
            GOT[symName].value = value;
          } else {
            err(`unhandled export type for '${symName}': ${typeof value}`);
          }
        }
      }
    }, "updateGOT");
    var relocateExports = /* @__PURE__ */ __name((exports, memoryBase2, replace) => {
      var relocated = {};
      for (var e in exports) {
        var value = exports[e];
        if (typeof value == "object") {
          value = value.value;
        }
        if (typeof value == "number") {
          value += memoryBase2;
        }
        relocated[e] = value;
      }
      updateGOT(relocated, replace);
      return relocated;
    }, "relocateExports");
    var isSymbolDefined = /* @__PURE__ */ __name((symName) => {
      var existing = wasmImports[symName];
      if (!existing || existing.stub) {
        return false;
      }
      return true;
    }, "isSymbolDefined");
    var dynCall = /* @__PURE__ */ __name((sig, ptr, args2 = []) => {
      var rtn = getWasmTableEntry(ptr)(...args2);
      return rtn;
    }, "dynCall");
    var stackSave = /* @__PURE__ */ __name(() => _emscripten_stack_get_current(), "stackSave");
    var stackRestore = /* @__PURE__ */ __name((val) => __emscripten_stack_restore(val), "stackRestore");
    var createInvokeFunction = /* @__PURE__ */ __name((sig) => (ptr, ...args2) => {
      var sp = stackSave();
      try {
        return dynCall(sig, ptr, args2);
      } catch (e) {
        stackRestore(sp);
        if (e !== e + 0)
          throw e;
        _setThrew(1, 0);
        if (sig[0] == "j")
          return 0n;
      }
    }, "createInvokeFunction");
    var resolveGlobalSymbol = /* @__PURE__ */ __name((symName, direct = false) => {
      var sym;
      if (isSymbolDefined(symName)) {
        sym = wasmImports[symName];
      } else if (symName.startsWith("invoke_")) {
        sym = wasmImports[symName] = createInvokeFunction(symName.split("_")[1]);
      }
      return {
        sym,
        name: symName
      };
    }, "resolveGlobalSymbol");
    var onPostCtors = [];
    var addOnPostCtor = /* @__PURE__ */ __name((cb) => onPostCtors.unshift(cb), "addOnPostCtor");
    var UTF8ToString = /* @__PURE__ */ __name((ptr, maxBytesToRead) => ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "", "UTF8ToString");
    var loadWebAssemblyModule = /* @__PURE__ */ __name((binary, flags, libName, localScope, handle) => {
      var metadata = getDylinkMetadata(binary);
      currentModuleWeakSymbols = metadata.weakImports;
      function loadModule() {
        var memAlign = Math.pow(2, metadata.memoryAlign);
        var memoryBase = metadata.memorySize ? alignMemory(getMemory(metadata.memorySize + memAlign), memAlign) : 0;
        var tableBase = metadata.tableSize ? wasmTable.length : 0;
        if (handle) {
          HEAP8[handle + 8] = 1;
          LE_HEAP_STORE_U32((handle + 12 >> 2) * 4, memoryBase);
          LE_HEAP_STORE_I32((handle + 16 >> 2) * 4, metadata.memorySize);
          LE_HEAP_STORE_U32((handle + 20 >> 2) * 4, tableBase);
          LE_HEAP_STORE_I32((handle + 24 >> 2) * 4, metadata.tableSize);
        }
        if (metadata.tableSize) {
          wasmTable.grow(metadata.tableSize);
        }
        var moduleExports;
        function resolveSymbol(sym) {
          var resolved = resolveGlobalSymbol(sym).sym;
          if (!resolved && localScope) {
            resolved = localScope[sym];
          }
          if (!resolved) {
            resolved = moduleExports[sym];
          }
          return resolved;
        }
        __name(resolveSymbol, "resolveSymbol");
        var proxyHandler = {
          get(stubs, prop) {
            switch (prop) {
              case "__memory_base":
                return memoryBase;
              case "__table_base":
                return tableBase;
            }
            if (prop in wasmImports && !wasmImports[prop].stub) {
              var res = wasmImports[prop];
              return res;
            }
            if (!(prop in stubs)) {
              var resolved;
              stubs[prop] = (...args2) => {
                resolved ||= resolveSymbol(prop);
                return resolved(...args2);
              };
            }
            return stubs[prop];
          }
        };
        var proxy = new Proxy({}, proxyHandler);
        var info = {
          "GOT.mem": new Proxy({}, GOTHandler),
          "GOT.func": new Proxy({}, GOTHandler),
          env: proxy,
          wasi_snapshot_preview1: proxy
        };
        function postInstantiation(module, instance) {
          updateTableMap(tableBase, metadata.tableSize);
          moduleExports = relocateExports(instance.exports, memoryBase);
          if (!flags.allowUndefined) {
            reportUndefinedSymbols();
          }
          function addEmAsm(addr, body) {
            var args = [];
            var arity = 0;
            for (;arity < 16; arity++) {
              if (body.indexOf("$" + arity) != -1) {
                args.push("$" + arity);
              } else {
                break;
              }
            }
            args = args.join(",");
            var func = `(${args}) => { ${body} };`;
            ASM_CONSTS[start] = eval(func);
          }
          __name(addEmAsm, "addEmAsm");
          if ("__start_em_asm" in moduleExports) {
            var start = moduleExports["__start_em_asm"];
            var stop = moduleExports["__stop_em_asm"];
            while (start < stop) {
              var jsString = UTF8ToString(start);
              addEmAsm(start, jsString);
              start = HEAPU8.indexOf(0, start) + 1;
            }
          }
          function addEmJs(name, cSig, body) {
            var jsArgs = [];
            cSig = cSig.slice(1, -1);
            if (cSig != "void") {
              cSig = cSig.split(",");
              for (var i in cSig) {
                var jsArg = cSig[i].split(" ").pop();
                jsArgs.push(jsArg.replace("*", ""));
              }
            }
            var func = `(${jsArgs}) => ${body};`;
            moduleExports[name] = eval(func);
          }
          __name(addEmJs, "addEmJs");
          for (var name in moduleExports) {
            if (name.startsWith("__em_js__")) {
              var start = moduleExports[name];
              var jsString = UTF8ToString(start);
              var parts = jsString.split("<::>");
              addEmJs(name.replace("__em_js__", ""), parts[0], parts[1]);
              delete moduleExports[name];
            }
          }
          var applyRelocs = moduleExports["__wasm_apply_data_relocs"];
          if (applyRelocs) {
            if (runtimeInitialized) {
              applyRelocs();
            } else {
              __RELOC_FUNCS__.push(applyRelocs);
            }
          }
          var init = moduleExports["__wasm_call_ctors"];
          if (init) {
            if (runtimeInitialized) {
              init();
            } else {
              addOnPostCtor(init);
            }
          }
          return moduleExports;
        }
        __name(postInstantiation, "postInstantiation");
        if (flags.loadAsync) {
          if (binary instanceof WebAssembly.Module) {
            var instance = new WebAssembly.Instance(binary, info);
            return Promise.resolve(postInstantiation(binary, instance));
          }
          return WebAssembly.instantiate(binary, info).then((result) => postInstantiation(result.module, result.instance));
        }
        var module = binary instanceof WebAssembly.Module ? binary : new WebAssembly.Module(binary);
        var instance = new WebAssembly.Instance(module, info);
        return postInstantiation(module, instance);
      }
      __name(loadModule, "loadModule");
      if (flags.loadAsync) {
        return metadata.neededDynlibs.reduce((chain, dynNeeded) => chain.then(() => loadDynamicLibrary(dynNeeded, flags, localScope)), Promise.resolve()).then(loadModule);
      }
      metadata.neededDynlibs.forEach((needed) => loadDynamicLibrary(needed, flags, localScope));
      return loadModule();
    }, "loadWebAssemblyModule");
    var mergeLibSymbols = /* @__PURE__ */ __name((exports, libName2) => {
      for (var [sym, exp] of Object.entries(exports)) {
        const setImport = /* @__PURE__ */ __name((target) => {
          if (!isSymbolDefined(target)) {
            wasmImports[target] = exp;
          }
        }, "setImport");
        setImport(sym);
        const main_alias = "__main_argc_argv";
        if (sym == "main") {
          setImport(main_alias);
        }
        if (sym == main_alias) {
          setImport("main");
        }
      }
    }, "mergeLibSymbols");
    var asyncLoad = /* @__PURE__ */ __name(async (url) => {
      var arrayBuffer = await readAsync(url);
      return new Uint8Array(arrayBuffer);
    }, "asyncLoad");
    function loadDynamicLibrary(libName2, flags2 = {
      global: true,
      nodelete: true
    }, localScope2, handle2) {
      var dso = LDSO.loadedLibsByName[libName2];
      if (dso) {
        if (!flags2.global) {
          if (localScope2) {
            Object.assign(localScope2, dso.exports);
          }
        } else if (!dso.global) {
          dso.global = true;
          mergeLibSymbols(dso.exports, libName2);
        }
        if (flags2.nodelete && dso.refcount !== Infinity) {
          dso.refcount = Infinity;
        }
        dso.refcount++;
        if (handle2) {
          LDSO.loadedLibsByHandle[handle2] = dso;
        }
        return flags2.loadAsync ? Promise.resolve(true) : true;
      }
      dso = newDSO(libName2, handle2, "loading");
      dso.refcount = flags2.nodelete ? Infinity : 1;
      dso.global = flags2.global;
      function loadLibData() {
        if (handle2) {
          var data = LE_HEAP_LOAD_U32((handle2 + 28 >> 2) * 4);
          var dataSize = LE_HEAP_LOAD_U32((handle2 + 32 >> 2) * 4);
          if (data && dataSize) {
            var libData = HEAP8.slice(data, data + dataSize);
            return flags2.loadAsync ? Promise.resolve(libData) : libData;
          }
        }
        var libFile = locateFile(libName2);
        if (flags2.loadAsync) {
          return asyncLoad(libFile);
        }
        if (!readBinary) {
          throw new Error(`${libFile}: file not found, and synchronous loading of external files is not available`);
        }
        return readBinary(libFile);
      }
      __name(loadLibData, "loadLibData");
      function getExports() {
        if (flags2.loadAsync) {
          return loadLibData().then((libData) => loadWebAssemblyModule(libData, flags2, libName2, localScope2, handle2));
        }
        return loadWebAssemblyModule(loadLibData(), flags2, libName2, localScope2, handle2);
      }
      __name(getExports, "getExports");
      function moduleLoaded(exports) {
        if (dso.global) {
          mergeLibSymbols(exports, libName2);
        } else if (localScope2) {
          Object.assign(localScope2, exports);
        }
        dso.exports = exports;
      }
      __name(moduleLoaded, "moduleLoaded");
      if (flags2.loadAsync) {
        return getExports().then((exports) => {
          moduleLoaded(exports);
          return true;
        });
      }
      moduleLoaded(getExports());
      return true;
    }
    __name(loadDynamicLibrary, "loadDynamicLibrary");
    var reportUndefinedSymbols = /* @__PURE__ */ __name(() => {
      for (var [symName, entry] of Object.entries(GOT)) {
        if (entry.value == 0) {
          var value = resolveGlobalSymbol(symName, true).sym;
          if (!value && !entry.required) {
            continue;
          }
          if (typeof value == "function") {
            entry.value = addFunction(value, value.sig);
          } else if (typeof value == "number") {
            entry.value = value;
          } else {
            throw new Error(`bad export type for '${symName}': ${typeof value}`);
          }
        }
      }
    }, "reportUndefinedSymbols");
    var loadDylibs = /* @__PURE__ */ __name(() => {
      if (!dynamicLibraries.length) {
        reportUndefinedSymbols();
        return;
      }
      addRunDependency("loadDylibs");
      dynamicLibraries.reduce((chain, lib) => chain.then(() => loadDynamicLibrary(lib, {
        loadAsync: true,
        global: true,
        nodelete: true,
        allowUndefined: true
      })), Promise.resolve()).then(() => {
        reportUndefinedSymbols();
        removeRunDependency("loadDylibs");
      });
    }, "loadDylibs");
    var noExitRuntime = Module["noExitRuntime"] || true;
    function setValue(ptr, value, type = "i8") {
      if (type.endsWith("*"))
        type = "*";
      switch (type) {
        case "i1":
          HEAP8[ptr] = value;
          break;
        case "i8":
          HEAP8[ptr] = value;
          break;
        case "i16":
          LE_HEAP_STORE_I16((ptr >> 1) * 2, value);
          break;
        case "i32":
          LE_HEAP_STORE_I32((ptr >> 2) * 4, value);
          break;
        case "i64":
          HEAP64[ptr >> 3] = BigInt(value);
          break;
        case "float":
          LE_HEAP_STORE_F32((ptr >> 2) * 4, value);
          break;
        case "double":
          LE_HEAP_STORE_F64((ptr >> 3) * 8, value);
          break;
        case "*":
          LE_HEAP_STORE_U32((ptr >> 2) * 4, value);
          break;
        default:
          abort(`invalid type for setValue: ${type}`);
      }
    }
    __name(setValue, "setValue");
    var ___memory_base = new WebAssembly.Global({
      value: "i32",
      mutable: false
    }, 1024);
    var ___stack_pointer = new WebAssembly.Global({
      value: "i32",
      mutable: true
    }, 78224);
    var ___table_base = new WebAssembly.Global({
      value: "i32",
      mutable: false
    }, 1);
    var __abort_js = /* @__PURE__ */ __name(() => abort(""), "__abort_js");
    __abort_js.sig = "v";
    var _emscripten_get_now = /* @__PURE__ */ __name(() => performance.now(), "_emscripten_get_now");
    _emscripten_get_now.sig = "d";
    var _emscripten_date_now = /* @__PURE__ */ __name(() => Date.now(), "_emscripten_date_now");
    _emscripten_date_now.sig = "d";
    var nowIsMonotonic = 1;
    var checkWasiClock = /* @__PURE__ */ __name((clock_id) => clock_id >= 0 && clock_id <= 3, "checkWasiClock");
    var INT53_MAX = 9007199254740992;
    var INT53_MIN = -9007199254740992;
    var bigintToI53Checked = /* @__PURE__ */ __name((num) => num < INT53_MIN || num > INT53_MAX ? NaN : Number(num), "bigintToI53Checked");
    function _clock_time_get(clk_id, ignored_precision, ptime) {
      ignored_precision = bigintToI53Checked(ignored_precision);
      if (!checkWasiClock(clk_id)) {
        return 28;
      }
      var now;
      if (clk_id === 0) {
        now = _emscripten_date_now();
      } else if (nowIsMonotonic) {
        now = _emscripten_get_now();
      } else {
        return 52;
      }
      var nsec = Math.round(now * 1000 * 1000);
      HEAP64[ptime >> 3] = BigInt(nsec);
      return 0;
    }
    __name(_clock_time_get, "_clock_time_get");
    _clock_time_get.sig = "iijp";
    var getHeapMax = /* @__PURE__ */ __name(() => 2147483648, "getHeapMax");
    var growMemory = /* @__PURE__ */ __name((size) => {
      var b = wasmMemory.buffer;
      var pages = (size - b.byteLength + 65535) / 65536 | 0;
      try {
        wasmMemory.grow(pages);
        updateMemoryViews();
        return 1;
      } catch (e) {}
    }, "growMemory");
    var _emscripten_resize_heap = /* @__PURE__ */ __name((requestedSize) => {
      var oldSize = HEAPU8.length;
      requestedSize >>>= 0;
      var maxHeapSize = getHeapMax();
      if (requestedSize > maxHeapSize) {
        return false;
      }
      for (var cutDown = 1;cutDown <= 4; cutDown *= 2) {
        var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
        overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
        var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
        var replacement = growMemory(newSize);
        if (replacement) {
          return true;
        }
      }
      return false;
    }, "_emscripten_resize_heap");
    _emscripten_resize_heap.sig = "ip";
    var _fd_close = /* @__PURE__ */ __name((fd) => 52, "_fd_close");
    _fd_close.sig = "ii";
    function _fd_seek(fd, offset, whence, newOffset) {
      offset = bigintToI53Checked(offset);
      return 70;
    }
    __name(_fd_seek, "_fd_seek");
    _fd_seek.sig = "iijip";
    var printCharBuffers = [null, [], []];
    var printChar = /* @__PURE__ */ __name((stream, curr) => {
      var buffer = printCharBuffers[stream];
      if (curr === 0 || curr === 10) {
        (stream === 1 ? out : err)(UTF8ArrayToString(buffer));
        buffer.length = 0;
      } else {
        buffer.push(curr);
      }
    }, "printChar");
    var flush_NO_FILESYSTEM = /* @__PURE__ */ __name(() => {
      if (printCharBuffers[1].length)
        printChar(1, 10);
      if (printCharBuffers[2].length)
        printChar(2, 10);
    }, "flush_NO_FILESYSTEM");
    var SYSCALLS = {
      varargs: undefined,
      getStr(ptr) {
        var ret = UTF8ToString(ptr);
        return ret;
      }
    };
    var _fd_write = /* @__PURE__ */ __name((fd, iov, iovcnt, pnum) => {
      var num = 0;
      for (var i2 = 0;i2 < iovcnt; i2++) {
        var ptr = LE_HEAP_LOAD_U32((iov >> 2) * 4);
        var len = LE_HEAP_LOAD_U32((iov + 4 >> 2) * 4);
        iov += 8;
        for (var j = 0;j < len; j++) {
          printChar(fd, HEAPU8[ptr + j]);
        }
        num += len;
      }
      LE_HEAP_STORE_U32((pnum >> 2) * 4, num);
      return 0;
    }, "_fd_write");
    _fd_write.sig = "iippp";
    function _tree_sitter_log_callback(isLexMessage, messageAddress) {
      if (Module.currentLogCallback) {
        const message = UTF8ToString(messageAddress);
        Module.currentLogCallback(message, isLexMessage !== 0);
      }
    }
    __name(_tree_sitter_log_callback, "_tree_sitter_log_callback");
    function _tree_sitter_parse_callback(inputBufferAddress, index, row, column, lengthAddress) {
      const INPUT_BUFFER_SIZE = 10240;
      const string = Module.currentParseCallback(index, {
        row,
        column
      });
      if (typeof string === "string") {
        setValue(lengthAddress, string.length, "i32");
        stringToUTF16(string, inputBufferAddress, INPUT_BUFFER_SIZE);
      } else {
        setValue(lengthAddress, 0, "i32");
      }
    }
    __name(_tree_sitter_parse_callback, "_tree_sitter_parse_callback");
    function _tree_sitter_progress_callback(currentOffset, hasError) {
      if (Module.currentProgressCallback) {
        return Module.currentProgressCallback({
          currentOffset,
          hasError
        });
      }
      return false;
    }
    __name(_tree_sitter_progress_callback, "_tree_sitter_progress_callback");
    function _tree_sitter_query_progress_callback(currentOffset) {
      if (Module.currentQueryProgressCallback) {
        return Module.currentQueryProgressCallback({
          currentOffset
        });
      }
      return false;
    }
    __name(_tree_sitter_query_progress_callback, "_tree_sitter_query_progress_callback");
    var runtimeKeepaliveCounter = 0;
    var keepRuntimeAlive = /* @__PURE__ */ __name(() => noExitRuntime || runtimeKeepaliveCounter > 0, "keepRuntimeAlive");
    var _proc_exit = /* @__PURE__ */ __name((code) => {
      EXITSTATUS = code;
      if (!keepRuntimeAlive()) {
        Module["onExit"]?.(code);
        ABORT = true;
      }
      quit_(code, new ExitStatus(code));
    }, "_proc_exit");
    _proc_exit.sig = "vi";
    var exitJS = /* @__PURE__ */ __name((status, implicit) => {
      EXITSTATUS = status;
      _proc_exit(status);
    }, "exitJS");
    var handleException = /* @__PURE__ */ __name((e) => {
      if (e instanceof ExitStatus || e == "unwind") {
        return EXITSTATUS;
      }
      quit_(1, e);
    }, "handleException");
    var lengthBytesUTF8 = /* @__PURE__ */ __name((str) => {
      var len = 0;
      for (var i2 = 0;i2 < str.length; ++i2) {
        var c = str.charCodeAt(i2);
        if (c <= 127) {
          len++;
        } else if (c <= 2047) {
          len += 2;
        } else if (c >= 55296 && c <= 57343) {
          len += 4;
          ++i2;
        } else {
          len += 3;
        }
      }
      return len;
    }, "lengthBytesUTF8");
    var stringToUTF8Array = /* @__PURE__ */ __name((str, heap, outIdx, maxBytesToWrite) => {
      if (!(maxBytesToWrite > 0))
        return 0;
      var startIdx = outIdx;
      var endIdx = outIdx + maxBytesToWrite - 1;
      for (var i2 = 0;i2 < str.length; ++i2) {
        var u = str.charCodeAt(i2);
        if (u >= 55296 && u <= 57343) {
          var u1 = str.charCodeAt(++i2);
          u = 65536 + ((u & 1023) << 10) | u1 & 1023;
        }
        if (u <= 127) {
          if (outIdx >= endIdx)
            break;
          heap[outIdx++] = u;
        } else if (u <= 2047) {
          if (outIdx + 1 >= endIdx)
            break;
          heap[outIdx++] = 192 | u >> 6;
          heap[outIdx++] = 128 | u & 63;
        } else if (u <= 65535) {
          if (outIdx + 2 >= endIdx)
            break;
          heap[outIdx++] = 224 | u >> 12;
          heap[outIdx++] = 128 | u >> 6 & 63;
          heap[outIdx++] = 128 | u & 63;
        } else {
          if (outIdx + 3 >= endIdx)
            break;
          heap[outIdx++] = 240 | u >> 18;
          heap[outIdx++] = 128 | u >> 12 & 63;
          heap[outIdx++] = 128 | u >> 6 & 63;
          heap[outIdx++] = 128 | u & 63;
        }
      }
      heap[outIdx] = 0;
      return outIdx - startIdx;
    }, "stringToUTF8Array");
    var stringToUTF8 = /* @__PURE__ */ __name((str, outPtr, maxBytesToWrite) => stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite), "stringToUTF8");
    var stackAlloc = /* @__PURE__ */ __name((sz) => __emscripten_stack_alloc(sz), "stackAlloc");
    var stringToUTF8OnStack = /* @__PURE__ */ __name((str) => {
      var size = lengthBytesUTF8(str) + 1;
      var ret = stackAlloc(size);
      stringToUTF8(str, ret, size);
      return ret;
    }, "stringToUTF8OnStack");
    var AsciiToString = /* @__PURE__ */ __name((ptr) => {
      var str = "";
      while (true) {
        var ch = HEAPU8[ptr++];
        if (!ch)
          return str;
        str += String.fromCharCode(ch);
      }
    }, "AsciiToString");
    var stringToUTF16 = /* @__PURE__ */ __name((str, outPtr, maxBytesToWrite) => {
      maxBytesToWrite ??= 2147483647;
      if (maxBytesToWrite < 2)
        return 0;
      maxBytesToWrite -= 2;
      var startPtr = outPtr;
      var numCharsToWrite = maxBytesToWrite < str.length * 2 ? maxBytesToWrite / 2 : str.length;
      for (var i2 = 0;i2 < numCharsToWrite; ++i2) {
        var codeUnit = str.charCodeAt(i2);
        LE_HEAP_STORE_I16((outPtr >> 1) * 2, codeUnit);
        outPtr += 2;
      }
      LE_HEAP_STORE_I16((outPtr >> 1) * 2, 0);
      return outPtr - startPtr;
    }, "stringToUTF16");
    var wasmImports = {
      __heap_base: ___heap_base,
      __indirect_function_table: wasmTable,
      __memory_base: ___memory_base,
      __stack_pointer: ___stack_pointer,
      __table_base: ___table_base,
      _abort_js: __abort_js,
      clock_time_get: _clock_time_get,
      emscripten_resize_heap: _emscripten_resize_heap,
      fd_close: _fd_close,
      fd_seek: _fd_seek,
      fd_write: _fd_write,
      memory: wasmMemory,
      tree_sitter_log_callback: _tree_sitter_log_callback,
      tree_sitter_parse_callback: _tree_sitter_parse_callback,
      tree_sitter_progress_callback: _tree_sitter_progress_callback,
      tree_sitter_query_progress_callback: _tree_sitter_query_progress_callback
    };
    var wasmExports = await createWasm();
    var ___wasm_call_ctors = wasmExports["__wasm_call_ctors"];
    var _malloc = Module["_malloc"] = wasmExports["malloc"];
    var _calloc = Module["_calloc"] = wasmExports["calloc"];
    var _realloc = Module["_realloc"] = wasmExports["realloc"];
    var _free = Module["_free"] = wasmExports["free"];
    var _memcmp = Module["_memcmp"] = wasmExports["memcmp"];
    var _ts_language_symbol_count = Module["_ts_language_symbol_count"] = wasmExports["ts_language_symbol_count"];
    var _ts_language_state_count = Module["_ts_language_state_count"] = wasmExports["ts_language_state_count"];
    var _ts_language_version = Module["_ts_language_version"] = wasmExports["ts_language_version"];
    var _ts_language_abi_version = Module["_ts_language_abi_version"] = wasmExports["ts_language_abi_version"];
    var _ts_language_metadata = Module["_ts_language_metadata"] = wasmExports["ts_language_metadata"];
    var _ts_language_name = Module["_ts_language_name"] = wasmExports["ts_language_name"];
    var _ts_language_field_count = Module["_ts_language_field_count"] = wasmExports["ts_language_field_count"];
    var _ts_language_next_state = Module["_ts_language_next_state"] = wasmExports["ts_language_next_state"];
    var _ts_language_symbol_name = Module["_ts_language_symbol_name"] = wasmExports["ts_language_symbol_name"];
    var _ts_language_symbol_for_name = Module["_ts_language_symbol_for_name"] = wasmExports["ts_language_symbol_for_name"];
    var _strncmp = Module["_strncmp"] = wasmExports["strncmp"];
    var _ts_language_symbol_type = Module["_ts_language_symbol_type"] = wasmExports["ts_language_symbol_type"];
    var _ts_language_field_name_for_id = Module["_ts_language_field_name_for_id"] = wasmExports["ts_language_field_name_for_id"];
    var _ts_lookahead_iterator_new = Module["_ts_lookahead_iterator_new"] = wasmExports["ts_lookahead_iterator_new"];
    var _ts_lookahead_iterator_delete = Module["_ts_lookahead_iterator_delete"] = wasmExports["ts_lookahead_iterator_delete"];
    var _ts_lookahead_iterator_reset_state = Module["_ts_lookahead_iterator_reset_state"] = wasmExports["ts_lookahead_iterator_reset_state"];
    var _ts_lookahead_iterator_reset = Module["_ts_lookahead_iterator_reset"] = wasmExports["ts_lookahead_iterator_reset"];
    var _ts_lookahead_iterator_next = Module["_ts_lookahead_iterator_next"] = wasmExports["ts_lookahead_iterator_next"];
    var _ts_lookahead_iterator_current_symbol = Module["_ts_lookahead_iterator_current_symbol"] = wasmExports["ts_lookahead_iterator_current_symbol"];
    var _ts_parser_delete = Module["_ts_parser_delete"] = wasmExports["ts_parser_delete"];
    var _ts_parser_reset = Module["_ts_parser_reset"] = wasmExports["ts_parser_reset"];
    var _ts_parser_set_language = Module["_ts_parser_set_language"] = wasmExports["ts_parser_set_language"];
    var _ts_parser_timeout_micros = Module["_ts_parser_timeout_micros"] = wasmExports["ts_parser_timeout_micros"];
    var _ts_parser_set_timeout_micros = Module["_ts_parser_set_timeout_micros"] = wasmExports["ts_parser_set_timeout_micros"];
    var _ts_parser_set_included_ranges = Module["_ts_parser_set_included_ranges"] = wasmExports["ts_parser_set_included_ranges"];
    var _ts_query_new = Module["_ts_query_new"] = wasmExports["ts_query_new"];
    var _ts_query_delete = Module["_ts_query_delete"] = wasmExports["ts_query_delete"];
    var _iswspace = Module["_iswspace"] = wasmExports["iswspace"];
    var _iswalnum = Module["_iswalnum"] = wasmExports["iswalnum"];
    var _ts_query_pattern_count = Module["_ts_query_pattern_count"] = wasmExports["ts_query_pattern_count"];
    var _ts_query_capture_count = Module["_ts_query_capture_count"] = wasmExports["ts_query_capture_count"];
    var _ts_query_string_count = Module["_ts_query_string_count"] = wasmExports["ts_query_string_count"];
    var _ts_query_capture_name_for_id = Module["_ts_query_capture_name_for_id"] = wasmExports["ts_query_capture_name_for_id"];
    var _ts_query_capture_quantifier_for_id = Module["_ts_query_capture_quantifier_for_id"] = wasmExports["ts_query_capture_quantifier_for_id"];
    var _ts_query_string_value_for_id = Module["_ts_query_string_value_for_id"] = wasmExports["ts_query_string_value_for_id"];
    var _ts_query_predicates_for_pattern = Module["_ts_query_predicates_for_pattern"] = wasmExports["ts_query_predicates_for_pattern"];
    var _ts_query_start_byte_for_pattern = Module["_ts_query_start_byte_for_pattern"] = wasmExports["ts_query_start_byte_for_pattern"];
    var _ts_query_end_byte_for_pattern = Module["_ts_query_end_byte_for_pattern"] = wasmExports["ts_query_end_byte_for_pattern"];
    var _ts_query_is_pattern_rooted = Module["_ts_query_is_pattern_rooted"] = wasmExports["ts_query_is_pattern_rooted"];
    var _ts_query_is_pattern_non_local = Module["_ts_query_is_pattern_non_local"] = wasmExports["ts_query_is_pattern_non_local"];
    var _ts_query_is_pattern_guaranteed_at_step = Module["_ts_query_is_pattern_guaranteed_at_step"] = wasmExports["ts_query_is_pattern_guaranteed_at_step"];
    var _ts_query_disable_capture = Module["_ts_query_disable_capture"] = wasmExports["ts_query_disable_capture"];
    var _ts_query_disable_pattern = Module["_ts_query_disable_pattern"] = wasmExports["ts_query_disable_pattern"];
    var _ts_tree_copy = Module["_ts_tree_copy"] = wasmExports["ts_tree_copy"];
    var _ts_tree_delete = Module["_ts_tree_delete"] = wasmExports["ts_tree_delete"];
    var _ts_init = Module["_ts_init"] = wasmExports["ts_init"];
    var _ts_parser_new_wasm = Module["_ts_parser_new_wasm"] = wasmExports["ts_parser_new_wasm"];
    var _ts_parser_enable_logger_wasm = Module["_ts_parser_enable_logger_wasm"] = wasmExports["ts_parser_enable_logger_wasm"];
    var _ts_parser_parse_wasm = Module["_ts_parser_parse_wasm"] = wasmExports["ts_parser_parse_wasm"];
    var _ts_parser_included_ranges_wasm = Module["_ts_parser_included_ranges_wasm"] = wasmExports["ts_parser_included_ranges_wasm"];
    var _ts_language_type_is_named_wasm = Module["_ts_language_type_is_named_wasm"] = wasmExports["ts_language_type_is_named_wasm"];
    var _ts_language_type_is_visible_wasm = Module["_ts_language_type_is_visible_wasm"] = wasmExports["ts_language_type_is_visible_wasm"];
    var _ts_language_supertypes_wasm = Module["_ts_language_supertypes_wasm"] = wasmExports["ts_language_supertypes_wasm"];
    var _ts_language_subtypes_wasm = Module["_ts_language_subtypes_wasm"] = wasmExports["ts_language_subtypes_wasm"];
    var _ts_tree_root_node_wasm = Module["_ts_tree_root_node_wasm"] = wasmExports["ts_tree_root_node_wasm"];
    var _ts_tree_root_node_with_offset_wasm = Module["_ts_tree_root_node_with_offset_wasm"] = wasmExports["ts_tree_root_node_with_offset_wasm"];
    var _ts_tree_edit_wasm = Module["_ts_tree_edit_wasm"] = wasmExports["ts_tree_edit_wasm"];
    var _ts_tree_included_ranges_wasm = Module["_ts_tree_included_ranges_wasm"] = wasmExports["ts_tree_included_ranges_wasm"];
    var _ts_tree_get_changed_ranges_wasm = Module["_ts_tree_get_changed_ranges_wasm"] = wasmExports["ts_tree_get_changed_ranges_wasm"];
    var _ts_tree_cursor_new_wasm = Module["_ts_tree_cursor_new_wasm"] = wasmExports["ts_tree_cursor_new_wasm"];
    var _ts_tree_cursor_copy_wasm = Module["_ts_tree_cursor_copy_wasm"] = wasmExports["ts_tree_cursor_copy_wasm"];
    var _ts_tree_cursor_delete_wasm = Module["_ts_tree_cursor_delete_wasm"] = wasmExports["ts_tree_cursor_delete_wasm"];
    var _ts_tree_cursor_reset_wasm = Module["_ts_tree_cursor_reset_wasm"] = wasmExports["ts_tree_cursor_reset_wasm"];
    var _ts_tree_cursor_reset_to_wasm = Module["_ts_tree_cursor_reset_to_wasm"] = wasmExports["ts_tree_cursor_reset_to_wasm"];
    var _ts_tree_cursor_goto_first_child_wasm = Module["_ts_tree_cursor_goto_first_child_wasm"] = wasmExports["ts_tree_cursor_goto_first_child_wasm"];
    var _ts_tree_cursor_goto_last_child_wasm = Module["_ts_tree_cursor_goto_last_child_wasm"] = wasmExports["ts_tree_cursor_goto_last_child_wasm"];
    var _ts_tree_cursor_goto_first_child_for_index_wasm = Module["_ts_tree_cursor_goto_first_child_for_index_wasm"] = wasmExports["ts_tree_cursor_goto_first_child_for_index_wasm"];
    var _ts_tree_cursor_goto_first_child_for_position_wasm = Module["_ts_tree_cursor_goto_first_child_for_position_wasm"] = wasmExports["ts_tree_cursor_goto_first_child_for_position_wasm"];
    var _ts_tree_cursor_goto_next_sibling_wasm = Module["_ts_tree_cursor_goto_next_sibling_wasm"] = wasmExports["ts_tree_cursor_goto_next_sibling_wasm"];
    var _ts_tree_cursor_goto_previous_sibling_wasm = Module["_ts_tree_cursor_goto_previous_sibling_wasm"] = wasmExports["ts_tree_cursor_goto_previous_sibling_wasm"];
    var _ts_tree_cursor_goto_descendant_wasm = Module["_ts_tree_cursor_goto_descendant_wasm"] = wasmExports["ts_tree_cursor_goto_descendant_wasm"];
    var _ts_tree_cursor_goto_parent_wasm = Module["_ts_tree_cursor_goto_parent_wasm"] = wasmExports["ts_tree_cursor_goto_parent_wasm"];
    var _ts_tree_cursor_current_node_type_id_wasm = Module["_ts_tree_cursor_current_node_type_id_wasm"] = wasmExports["ts_tree_cursor_current_node_type_id_wasm"];
    var _ts_tree_cursor_current_node_state_id_wasm = Module["_ts_tree_cursor_current_node_state_id_wasm"] = wasmExports["ts_tree_cursor_current_node_state_id_wasm"];
    var _ts_tree_cursor_current_node_is_named_wasm = Module["_ts_tree_cursor_current_node_is_named_wasm"] = wasmExports["ts_tree_cursor_current_node_is_named_wasm"];
    var _ts_tree_cursor_current_node_is_missing_wasm = Module["_ts_tree_cursor_current_node_is_missing_wasm"] = wasmExports["ts_tree_cursor_current_node_is_missing_wasm"];
    var _ts_tree_cursor_current_node_id_wasm = Module["_ts_tree_cursor_current_node_id_wasm"] = wasmExports["ts_tree_cursor_current_node_id_wasm"];
    var _ts_tree_cursor_start_position_wasm = Module["_ts_tree_cursor_start_position_wasm"] = wasmExports["ts_tree_cursor_start_position_wasm"];
    var _ts_tree_cursor_end_position_wasm = Module["_ts_tree_cursor_end_position_wasm"] = wasmExports["ts_tree_cursor_end_position_wasm"];
    var _ts_tree_cursor_start_index_wasm = Module["_ts_tree_cursor_start_index_wasm"] = wasmExports["ts_tree_cursor_start_index_wasm"];
    var _ts_tree_cursor_end_index_wasm = Module["_ts_tree_cursor_end_index_wasm"] = wasmExports["ts_tree_cursor_end_index_wasm"];
    var _ts_tree_cursor_current_field_id_wasm = Module["_ts_tree_cursor_current_field_id_wasm"] = wasmExports["ts_tree_cursor_current_field_id_wasm"];
    var _ts_tree_cursor_current_depth_wasm = Module["_ts_tree_cursor_current_depth_wasm"] = wasmExports["ts_tree_cursor_current_depth_wasm"];
    var _ts_tree_cursor_current_descendant_index_wasm = Module["_ts_tree_cursor_current_descendant_index_wasm"] = wasmExports["ts_tree_cursor_current_descendant_index_wasm"];
    var _ts_tree_cursor_current_node_wasm = Module["_ts_tree_cursor_current_node_wasm"] = wasmExports["ts_tree_cursor_current_node_wasm"];
    var _ts_node_symbol_wasm = Module["_ts_node_symbol_wasm"] = wasmExports["ts_node_symbol_wasm"];
    var _ts_node_field_name_for_child_wasm = Module["_ts_node_field_name_for_child_wasm"] = wasmExports["ts_node_field_name_for_child_wasm"];
    var _ts_node_field_name_for_named_child_wasm = Module["_ts_node_field_name_for_named_child_wasm"] = wasmExports["ts_node_field_name_for_named_child_wasm"];
    var _ts_node_children_by_field_id_wasm = Module["_ts_node_children_by_field_id_wasm"] = wasmExports["ts_node_children_by_field_id_wasm"];
    var _ts_node_first_child_for_byte_wasm = Module["_ts_node_first_child_for_byte_wasm"] = wasmExports["ts_node_first_child_for_byte_wasm"];
    var _ts_node_first_named_child_for_byte_wasm = Module["_ts_node_first_named_child_for_byte_wasm"] = wasmExports["ts_node_first_named_child_for_byte_wasm"];
    var _ts_node_grammar_symbol_wasm = Module["_ts_node_grammar_symbol_wasm"] = wasmExports["ts_node_grammar_symbol_wasm"];
    var _ts_node_child_count_wasm = Module["_ts_node_child_count_wasm"] = wasmExports["ts_node_child_count_wasm"];
    var _ts_node_named_child_count_wasm = Module["_ts_node_named_child_count_wasm"] = wasmExports["ts_node_named_child_count_wasm"];
    var _ts_node_child_wasm = Module["_ts_node_child_wasm"] = wasmExports["ts_node_child_wasm"];
    var _ts_node_named_child_wasm = Module["_ts_node_named_child_wasm"] = wasmExports["ts_node_named_child_wasm"];
    var _ts_node_child_by_field_id_wasm = Module["_ts_node_child_by_field_id_wasm"] = wasmExports["ts_node_child_by_field_id_wasm"];
    var _ts_node_next_sibling_wasm = Module["_ts_node_next_sibling_wasm"] = wasmExports["ts_node_next_sibling_wasm"];
    var _ts_node_prev_sibling_wasm = Module["_ts_node_prev_sibling_wasm"] = wasmExports["ts_node_prev_sibling_wasm"];
    var _ts_node_next_named_sibling_wasm = Module["_ts_node_next_named_sibling_wasm"] = wasmExports["ts_node_next_named_sibling_wasm"];
    var _ts_node_prev_named_sibling_wasm = Module["_ts_node_prev_named_sibling_wasm"] = wasmExports["ts_node_prev_named_sibling_wasm"];
    var _ts_node_descendant_count_wasm = Module["_ts_node_descendant_count_wasm"] = wasmExports["ts_node_descendant_count_wasm"];
    var _ts_node_parent_wasm = Module["_ts_node_parent_wasm"] = wasmExports["ts_node_parent_wasm"];
    var _ts_node_child_with_descendant_wasm = Module["_ts_node_child_with_descendant_wasm"] = wasmExports["ts_node_child_with_descendant_wasm"];
    var _ts_node_descendant_for_index_wasm = Module["_ts_node_descendant_for_index_wasm"] = wasmExports["ts_node_descendant_for_index_wasm"];
    var _ts_node_named_descendant_for_index_wasm = Module["_ts_node_named_descendant_for_index_wasm"] = wasmExports["ts_node_named_descendant_for_index_wasm"];
    var _ts_node_descendant_for_position_wasm = Module["_ts_node_descendant_for_position_wasm"] = wasmExports["ts_node_descendant_for_position_wasm"];
    var _ts_node_named_descendant_for_position_wasm = Module["_ts_node_named_descendant_for_position_wasm"] = wasmExports["ts_node_named_descendant_for_position_wasm"];
    var _ts_node_start_point_wasm = Module["_ts_node_start_point_wasm"] = wasmExports["ts_node_start_point_wasm"];
    var _ts_node_end_point_wasm = Module["_ts_node_end_point_wasm"] = wasmExports["ts_node_end_point_wasm"];
    var _ts_node_start_index_wasm = Module["_ts_node_start_index_wasm"] = wasmExports["ts_node_start_index_wasm"];
    var _ts_node_end_index_wasm = Module["_ts_node_end_index_wasm"] = wasmExports["ts_node_end_index_wasm"];
    var _ts_node_to_string_wasm = Module["_ts_node_to_string_wasm"] = wasmExports["ts_node_to_string_wasm"];
    var _ts_node_children_wasm = Module["_ts_node_children_wasm"] = wasmExports["ts_node_children_wasm"];
    var _ts_node_named_children_wasm = Module["_ts_node_named_children_wasm"] = wasmExports["ts_node_named_children_wasm"];
    var _ts_node_descendants_of_type_wasm = Module["_ts_node_descendants_of_type_wasm"] = wasmExports["ts_node_descendants_of_type_wasm"];
    var _ts_node_is_named_wasm = Module["_ts_node_is_named_wasm"] = wasmExports["ts_node_is_named_wasm"];
    var _ts_node_has_changes_wasm = Module["_ts_node_has_changes_wasm"] = wasmExports["ts_node_has_changes_wasm"];
    var _ts_node_has_error_wasm = Module["_ts_node_has_error_wasm"] = wasmExports["ts_node_has_error_wasm"];
    var _ts_node_is_error_wasm = Module["_ts_node_is_error_wasm"] = wasmExports["ts_node_is_error_wasm"];
    var _ts_node_is_missing_wasm = Module["_ts_node_is_missing_wasm"] = wasmExports["ts_node_is_missing_wasm"];
    var _ts_node_is_extra_wasm = Module["_ts_node_is_extra_wasm"] = wasmExports["ts_node_is_extra_wasm"];
    var _ts_node_parse_state_wasm = Module["_ts_node_parse_state_wasm"] = wasmExports["ts_node_parse_state_wasm"];
    var _ts_node_next_parse_state_wasm = Module["_ts_node_next_parse_state_wasm"] = wasmExports["ts_node_next_parse_state_wasm"];
    var _ts_query_matches_wasm = Module["_ts_query_matches_wasm"] = wasmExports["ts_query_matches_wasm"];
    var _ts_query_captures_wasm = Module["_ts_query_captures_wasm"] = wasmExports["ts_query_captures_wasm"];
    var _memset = Module["_memset"] = wasmExports["memset"];
    var _memcpy = Module["_memcpy"] = wasmExports["memcpy"];
    var _memmove = Module["_memmove"] = wasmExports["memmove"];
    var _iswalpha = Module["_iswalpha"] = wasmExports["iswalpha"];
    var _iswblank = Module["_iswblank"] = wasmExports["iswblank"];
    var _iswdigit = Module["_iswdigit"] = wasmExports["iswdigit"];
    var _iswlower = Module["_iswlower"] = wasmExports["iswlower"];
    var _iswupper = Module["_iswupper"] = wasmExports["iswupper"];
    var _iswxdigit = Module["_iswxdigit"] = wasmExports["iswxdigit"];
    var _memchr = Module["_memchr"] = wasmExports["memchr"];
    var _strlen = Module["_strlen"] = wasmExports["strlen"];
    var _strcmp = Module["_strcmp"] = wasmExports["strcmp"];
    var _strncat = Module["_strncat"] = wasmExports["strncat"];
    var _strncpy = Module["_strncpy"] = wasmExports["strncpy"];
    var _towlower = Module["_towlower"] = wasmExports["towlower"];
    var _towupper = Module["_towupper"] = wasmExports["towupper"];
    var _setThrew = wasmExports["setThrew"];
    var __emscripten_stack_restore = wasmExports["_emscripten_stack_restore"];
    var __emscripten_stack_alloc = wasmExports["_emscripten_stack_alloc"];
    var _emscripten_stack_get_current = wasmExports["emscripten_stack_get_current"];
    var ___wasm_apply_data_relocs = wasmExports["__wasm_apply_data_relocs"];
    Module["setValue"] = setValue;
    Module["getValue"] = getValue;
    Module["UTF8ToString"] = UTF8ToString;
    Module["stringToUTF8"] = stringToUTF8;
    Module["lengthBytesUTF8"] = lengthBytesUTF8;
    Module["AsciiToString"] = AsciiToString;
    Module["stringToUTF16"] = stringToUTF16;
    Module["loadWebAssemblyModule"] = loadWebAssemblyModule;
    function callMain(args2 = []) {
      var entryFunction = resolveGlobalSymbol("main").sym;
      if (!entryFunction)
        return;
      args2.unshift(thisProgram);
      var argc = args2.length;
      var argv = stackAlloc((argc + 1) * 4);
      var argv_ptr = argv;
      args2.forEach((arg) => {
        LE_HEAP_STORE_U32((argv_ptr >> 2) * 4, stringToUTF8OnStack(arg));
        argv_ptr += 4;
      });
      LE_HEAP_STORE_U32((argv_ptr >> 2) * 4, 0);
      try {
        var ret = entryFunction(argc, argv);
        exitJS(ret, true);
        return ret;
      } catch (e) {
        return handleException(e);
      }
    }
    __name(callMain, "callMain");
    function run(args2 = arguments_) {
      if (runDependencies > 0) {
        dependenciesFulfilled = run;
        return;
      }
      preRun();
      if (runDependencies > 0) {
        dependenciesFulfilled = run;
        return;
      }
      function doRun() {
        Module["calledRun"] = true;
        if (ABORT)
          return;
        initRuntime();
        preMain();
        readyPromiseResolve(Module);
        Module["onRuntimeInitialized"]?.();
        var noInitialRun = Module["noInitialRun"];
        if (!noInitialRun)
          callMain(args2);
        postRun();
      }
      __name(doRun, "doRun");
      if (Module["setStatus"]) {
        Module["setStatus"]("Running...");
        setTimeout(() => {
          setTimeout(() => Module["setStatus"](""), 1);
          doRun();
        }, 1);
      } else {
        doRun();
      }
    }
    __name(run, "run");
    if (Module["preInit"]) {
      if (typeof Module["preInit"] == "function")
        Module["preInit"] = [Module["preInit"]];
      while (Module["preInit"].length > 0) {
        Module["preInit"].pop()();
      }
    }
    run();
    moduleRtn = readyPromise;
    return moduleRtn;
  };
})();
var tree_sitter_default = Module2;
var Module3 = null;
async function initializeBinding(moduleOptions) {
  if (!Module3) {
    Module3 = await tree_sitter_default(moduleOptions);
  }
  return Module3;
}
__name(initializeBinding, "initializeBinding");
function checkModule() {
  return !!Module3;
}
__name(checkModule, "checkModule");
var TRANSFER_BUFFER;
var LANGUAGE_VERSION;
var MIN_COMPATIBLE_VERSION;
var Parser = class {
  static {
    __name(this, "Parser");
  }
  [0] = 0;
  [1] = 0;
  logCallback = null;
  language = null;
  static async init(moduleOptions) {
    setModule(await initializeBinding(moduleOptions));
    TRANSFER_BUFFER = C._ts_init();
    LANGUAGE_VERSION = C.getValue(TRANSFER_BUFFER, "i32");
    MIN_COMPATIBLE_VERSION = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
  }
  constructor() {
    this.initialize();
  }
  initialize() {
    if (!checkModule()) {
      throw new Error("cannot construct a Parser before calling `init()`");
    }
    C._ts_parser_new_wasm();
    this[0] = C.getValue(TRANSFER_BUFFER, "i32");
    this[1] = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
  }
  delete() {
    C._ts_parser_delete(this[0]);
    C._free(this[1]);
    this[0] = 0;
    this[1] = 0;
  }
  setLanguage(language) {
    let address;
    if (!language) {
      address = 0;
      this.language = null;
    } else if (language.constructor === Language) {
      address = language[0];
      const version = C._ts_language_version(address);
      if (version < MIN_COMPATIBLE_VERSION || LANGUAGE_VERSION < version) {
        throw new Error(`Incompatible language version ${version}. Compatibility range ${MIN_COMPATIBLE_VERSION} through ${LANGUAGE_VERSION}.`);
      }
      this.language = language;
    } else {
      throw new Error("Argument must be a Language");
    }
    C._ts_parser_set_language(this[0], address);
    return this;
  }
  parse(callback, oldTree, options) {
    if (typeof callback === "string") {
      C.currentParseCallback = (index) => callback.slice(index);
    } else if (typeof callback === "function") {
      C.currentParseCallback = callback;
    } else {
      throw new Error("Argument must be a string or a function");
    }
    if (options?.progressCallback) {
      C.currentProgressCallback = options.progressCallback;
    } else {
      C.currentProgressCallback = null;
    }
    if (this.logCallback) {
      C.currentLogCallback = this.logCallback;
      C._ts_parser_enable_logger_wasm(this[0], 1);
    } else {
      C.currentLogCallback = null;
      C._ts_parser_enable_logger_wasm(this[0], 0);
    }
    let rangeCount = 0;
    let rangeAddress = 0;
    if (options?.includedRanges) {
      rangeCount = options.includedRanges.length;
      rangeAddress = C._calloc(rangeCount, SIZE_OF_RANGE);
      let address = rangeAddress;
      for (let i2 = 0;i2 < rangeCount; i2++) {
        marshalRange(address, options.includedRanges[i2]);
        address += SIZE_OF_RANGE;
      }
    }
    const treeAddress = C._ts_parser_parse_wasm(this[0], this[1], oldTree ? oldTree[0] : 0, rangeAddress, rangeCount);
    if (!treeAddress) {
      C.currentParseCallback = null;
      C.currentLogCallback = null;
      C.currentProgressCallback = null;
      return null;
    }
    if (!this.language) {
      throw new Error("Parser must have a language to parse");
    }
    const result = new Tree(INTERNAL, treeAddress, this.language, C.currentParseCallback);
    C.currentParseCallback = null;
    C.currentLogCallback = null;
    C.currentProgressCallback = null;
    return result;
  }
  reset() {
    C._ts_parser_reset(this[0]);
  }
  getIncludedRanges() {
    C._ts_parser_included_ranges_wasm(this[0]);
    const count = C.getValue(TRANSFER_BUFFER, "i32");
    const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const result = new Array(count);
    if (count > 0) {
      let address = buffer;
      for (let i2 = 0;i2 < count; i2++) {
        result[i2] = unmarshalRange(address);
        address += SIZE_OF_RANGE;
      }
      C._free(buffer);
    }
    return result;
  }
  getTimeoutMicros() {
    return C._ts_parser_timeout_micros(this[0]);
  }
  setTimeoutMicros(timeout) {
    C._ts_parser_set_timeout_micros(this[0], 0, timeout);
  }
  setLogger(callback) {
    if (!callback) {
      this.logCallback = null;
    } else if (typeof callback !== "function") {
      throw new Error("Logger callback must be a function");
    } else {
      this.logCallback = callback;
    }
    return this;
  }
  getLogger() {
    return this.logCallback;
  }
};

// src/lib/tree-sitter/parser.worker.ts
import { mkdir as mkdir2 } from "fs/promises";
import * as path2 from "path";

// src/lib/tree-sitter/download-utils.ts
import { mkdir, readFile, writeFile } from "fs/promises";
import * as path from "path";

class DownloadUtils {
  static hashUrl(url) {
    let hash = 0;
    for (let i2 = 0;i2 < url.length; i2++) {
      const char = url.charCodeAt(i2);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
  static async downloadOrLoad(source, cacheDir, cacheSubdir, fileExtension, useHashForCache = true, filetype) {
    const isUrl = source.startsWith("http://") || source.startsWith("https://");
    if (isUrl) {
      let cacheFileName;
      if (useHashForCache) {
        const hash = this.hashUrl(source);
        cacheFileName = filetype ? `${filetype}-${hash}${fileExtension}` : `${hash}${fileExtension}`;
      } else {
        cacheFileName = path.basename(source);
      }
      const cacheFile = path.join(cacheDir, cacheSubdir, cacheFileName);
      await mkdir(path.dirname(cacheFile), { recursive: true });
      try {
        const cachedContent = await readFile(cacheFile);
        if (cachedContent.byteLength > 0) {
          console.log(`Loaded from cache: ${cacheFile} (${source})`);
          return { content: cachedContent, filePath: cacheFile };
        }
      } catch (error) {}
      try {
        console.log(`Downloading from URL: ${source}`);
        const response = await fetch(source);
        if (!response.ok) {
          return { error: `Failed to fetch from ${source}: ${response.statusText}` };
        }
        const content = Buffer.from(await response.arrayBuffer());
        try {
          await writeFile(cacheFile, Buffer.from(content));
          console.log(`Cached: ${source}`);
        } catch (cacheError) {
          console.warn(`Failed to cache: ${cacheError}`);
        }
        return { content, filePath: cacheFile };
      } catch (error) {
        return { error: `Error downloading from ${source}: ${error}` };
      }
    } else {
      try {
        console.log(`Loading from local path: ${source}`);
        const content = await readFile(source);
        return { content, filePath: source };
      } catch (error) {
        return { error: `Error loading from local path ${source}: ${error}` };
      }
    }
  }
  static async downloadToPath(source, targetPath) {
    const isUrl = source.startsWith("http://") || source.startsWith("https://");
    await mkdir(path.dirname(targetPath), { recursive: true });
    if (isUrl) {
      try {
        console.log(`Downloading from URL: ${source}`);
        const response = await fetch(source);
        if (!response.ok) {
          return { error: `Failed to fetch from ${source}: ${response.statusText}` };
        }
        const content = Buffer.from(await response.arrayBuffer());
        await writeFile(targetPath, Buffer.from(content));
        console.log(`Downloaded: ${source} -> ${targetPath}`);
        return { content, filePath: targetPath };
      } catch (error) {
        return { error: `Error downloading from ${source}: ${error}` };
      }
    } else {
      try {
        console.log(`Copying from local path: ${source}`);
        const content = await readFile(source);
        await writeFile(targetPath, Buffer.from(content));
        return { content, filePath: targetPath };
      } catch (error) {
        return { error: `Error copying from local path ${source}: ${error}` };
      }
    }
  }
  static async fetchHighlightQueries(sources, cacheDir, filetype) {
    const queryPromises = sources.map((source) => this.fetchHighlightQuery(source, cacheDir, filetype));
    const queryResults = await Promise.all(queryPromises);
    const validQueries = queryResults.filter((query) => query.trim().length > 0);
    return validQueries.join(`
`);
  }
  static async fetchHighlightQuery(source, cacheDir, filetype) {
    const result = await this.downloadOrLoad(source, cacheDir, "queries", ".scm", true, filetype);
    if (result.error) {
      console.error(`Error fetching highlight query from ${source}:`, result.error);
      return "";
    }
    if (result.content) {
      return new TextDecoder().decode(result.content);
    }
    return "";
  }
}

// src/lib/bunfs.ts
import { basename as basename2, join as join2 } from "node:path";
function isBunfsPath(path2) {
  return path2.includes("$bunfs") || /^B:[\\/]~BUN/i.test(path2);
}
function getBunfsRootPath() {
  return process.platform === "win32" ? "B:\\~BUN\\root" : "/$bunfs/root";
}
function normalizeBunfsPath(fileName) {
  return join2(getBunfsRootPath(), basename2(fileName));
}

// src/platform/assets.ts
import { statSync } from "node:fs";
import { isAbsolute, join as join3 } from "node:path";
import { fileURLToPath } from "node:url";

// src/lib/singleton.ts
var singletonCacheSymbol = Symbol.for("@opentui/core/singleton");
function singleton(key, factory) {
  const bag = globalThis[singletonCacheSymbol] ??= {};
  if (!(key in bag)) {
    bag[key] = factory();
  }
  return bag[key];
}

// src/lib/env.ts
var envRegistry = singleton("env-registry", () => ({}));
function registerEnvVar(config) {
  const existing = envRegistry[config.name];
  if (existing) {
    if (existing.description !== config.description || existing.type !== config.type || existing.default !== config.default) {
      throw new Error(`Environment variable "${config.name}" is already registered with different configuration. ` + `Existing: ${JSON.stringify(existing)}, New: ${JSON.stringify(config)}`);
    }
    return;
  }
  envRegistry[config.name] = config;
}
function normalizeBoolean(value) {
  const lowerValue = value.toLowerCase();
  return ["true", "1", "on", "yes"].includes(lowerValue);
}
function parseEnvValue(config) {
  const envValue = process.env[config.name];
  if (envValue === undefined && config.default !== undefined) {
    return config.default;
  }
  if (envValue === undefined) {
    throw new Error(`Required environment variable ${config.name} is not set. ${config.description}`);
  }
  switch (config.type) {
    case "boolean":
      return typeof envValue === "boolean" ? envValue : normalizeBoolean(envValue);
    case "number":
      const numValue = Number(envValue);
      if (isNaN(numValue)) {
        throw new Error(`Environment variable ${config.name} must be a valid number, got: ${envValue}`);
      }
      return numValue;
    case "string":
    default:
      return envValue;
  }
}

class EnvStore {
  parsedValues = new Map;
  get(key) {
    if (this.parsedValues.has(key)) {
      return this.parsedValues.get(key);
    }
    if (!(key in envRegistry)) {
      throw new Error(`Environment variable ${key} is not registered.`);
    }
    try {
      const value = parseEnvValue(envRegistry[key]);
      this.parsedValues.set(key, value);
      return value;
    } catch (error) {
      throw new Error(`Failed to parse env var ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  has(key) {
    return key in envRegistry;
  }
  clearCache() {
    this.parsedValues.clear();
  }
}
var envStore = singleton("env-store", () => new EnvStore);
var env = new Proxy({}, {
  get(target, prop) {
    if (typeof prop !== "string") {
      return;
    }
    return envStore.get(prop);
  },
  has(target, prop) {
    return envStore.has(prop);
  },
  ownKeys() {
    return Object.keys(envRegistry);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (envStore.has(prop)) {
      return {
        enumerable: true,
        configurable: true,
        get: () => envStore.get(prop)
      };
    }
    return;
  }
});

// src/platform/assets.ts
registerEnvVar({
  name: "OTUI_ASSET_ROOT",
  description: "Absolute directory containing relocatable OpenTUI runtime assets",
  type: "string",
  default: ""
});
function resolveAssetPath(key, fallback) {
  validateAssetKey(key);
  const configuredPath = resolveAssetRootPath(key);
  if (configuredPath !== undefined) {
    return configuredPath;
  }
  if (fallback === undefined) {
    throw new Error(`OpenTUI asset ${JSON.stringify(key)} has no package-relative fallback`);
  }
  const value = typeof fallback === "function" ? fallback() : fallback;
  return value instanceof URL ? fileURLToPath(value) : value;
}
function resolveAssetRootPath(key) {
  validateAssetKey(key);
  const root = process.env.OTUI_ASSET_ROOT;
  if (!root) {
    return;
  }
  if (!isAbsolute(root)) {
    throw new Error(`OTUI_ASSET_ROOT must be an absolute directory, got ${JSON.stringify(root)}`);
  }
  const assetPath = join3(root, key);
  let isFile = false;
  try {
    isFile = statSync(assetPath).isFile();
  } catch {}
  if (!isFile) {
    throw new Error(`Missing OpenTUI asset ${JSON.stringify(key)} at ${JSON.stringify(assetPath)}`);
  }
  return assetPath;
}
function validateAssetKey(key) {
  if (key.length === 0 || isAbsolute(key) || key.includes("\\") || key.split("/").includes("..")) {
    throw new Error(`Invalid OpenTUI asset key: ${JSON.stringify(key)}`);
  }
}

// src/platform/worker.ts
var WORKER_UNAVAILABLE = "OpenTUI tree-sitter workers are not available for this runtime yet.";
var globalWithWorker = globalThis;
var nodeWorkerThreads = getBuiltinModule("node:worker_threads");
var runtimeBridge = loadWorkerRuntime(nodeWorkerThreads);

class UnsupportedWorker {
  onmessage = null;
  onerror = null;
  constructor() {
    throw new Error(WORKER_UNAVAILABLE);
  }
  postMessage() {
    throw new Error(WORKER_UNAVAILABLE);
  }
  terminate() {
    throw new Error(WORKER_UNAVAILABLE);
  }
  addEventListener() {
    throw new Error(WORKER_UNAVAILABLE);
  }
  removeEventListener() {
    throw new Error(WORKER_UNAVAILABLE);
  }
}
var Worker = loadWorkerConstructor();
var isWorkerRuntime = runtimeBridge !== undefined;
function postWorkerMessage(value) {
  if (!runtimeBridge) {
    throw new Error(WORKER_UNAVAILABLE);
  }
  runtimeBridge.postMessage(value);
}
function setWorkerMessageHandler(handler) {
  if (!runtimeBridge) {
    throw new Error(WORKER_UNAVAILABLE);
  }
  return runtimeBridge.setMessageHandler(handler);
}
function getBuiltinModule(id) {
  if (typeof process === "undefined") {
    return;
  }
  const loader = process.getBuiltinModule;
  if (typeof loader !== "function") {
    return;
  }
  try {
    return loader(id);
  } catch {
    return;
  }
}
function loadWorkerConstructor() {
  if (typeof globalWithWorker.Worker === "function") {
    return globalWithWorker.Worker;
  }
  if (nodeWorkerThreads) {
    return createNodeWorkerConstructor(nodeWorkerThreads);
  }
  return UnsupportedWorker;
}
function createNodeWorkerConstructor(node) {
  return class NodeWorkerShim {
    onmessage = null;
    onerror = null;
    errorListeners = new Set;
    messageListeners = new Set;
    worker;
    terminationPromise;
    constructor(specifier, options = {}) {
      const resolvedSpecifier = resolveWorkerImportSpecifier(specifier);
      this.worker = new node.Worker(createWorkerBootstrapSource(resolvedSpecifier), {
        eval: true,
        type: "module",
        name: options.name
      });
      this.worker.on("message", this.handleMessage);
      this.worker.on("error", this.handleError);
    }
    postMessage(value) {
      this.worker.postMessage(value);
    }
    terminate() {
      if (this.terminationPromise) {
        return this.terminationPromise;
      }
      this.worker.off("message", this.handleMessage);
      this.worker.off("error", this.handleError);
      const termination = this.worker.terminate().catch((error) => {
        this.terminationPromise = undefined;
        this.worker.on("message", this.handleMessage);
        this.worker.on("error", this.handleError);
        throw error;
      });
      this.terminationPromise = termination;
      return termination;
    }
    addEventListener(type, listener) {
      if (type === "message") {
        this.messageListeners.add(listener);
        return;
      }
      this.errorListeners.add(listener);
    }
    removeEventListener(type, listener) {
      if (type === "message") {
        this.messageListeners.delete(listener);
        return;
      }
      this.errorListeners.delete(listener);
    }
    handleMessage = (data) => {
      const event = { data };
      this.onmessage?.(event);
      for (const listener of this.messageListeners) {
        listener(event);
      }
    };
    handleError = (error) => {
      const event = {
        error,
        message: error.message
      };
      this.onerror?.(event);
      for (const listener of this.errorListeners) {
        listener(event);
      }
    };
  };
}
function createWorkerBootstrapSource(specifier) {
  return `
    import { parentPort } from "node:worker_threads"

    const pendingMessages = []
    let messageHandler = null

    globalThis.self ??= globalThis
    globalThis.postMessage ??= (value) => parentPort?.postMessage(value)
    globalThis.__opentuiWorkerMessageBridge = true
    Object.defineProperty(globalThis, "onmessage", {
      configurable: true,
      get: () => messageHandler,
      set: (handler) => {
        messageHandler = typeof handler === "function" ? handler : null
        if (!messageHandler) return

        const messages = pendingMessages.splice(0)
        for (const data of messages) {
          messageHandler({ data })
        }
      },
    })
    parentPort?.on("message", (data) => {
      if (messageHandler) {
        messageHandler({ data })
      } else {
        pendingMessages.push(data)
      }
    })

    await import(${JSON.stringify(specifier)})
  `;
}
function resolveWorkerImportSpecifier(specifier) {
  if (specifier instanceof URL) {
    return specifier.href;
  }
  if (isRuntimeSpecifier(specifier)) {
    return specifier;
  }
  const nodePath2 = getBuiltinModule("node:path");
  const nodeUrl = getBuiltinModule("node:url");
  if (!nodePath2 || !nodeUrl) {
    throw new Error(WORKER_UNAVAILABLE);
  }
  const absolutePath = nodePath2.isAbsolute(specifier) ? specifier : nodePath2.resolve(specifier);
  return nodeUrl.pathToFileURL(absolutePath).href;
}
function isRuntimeSpecifier(specifier) {
  return specifier.startsWith("file:") || specifier.startsWith("data:") || specifier.startsWith("node:") || specifier.startsWith("http:") || specifier.startsWith("https:");
}
function loadWorkerRuntime(node) {
  if (node?.parentPort && node.isMainThread === false) {
    if (globalWithWorker.__opentuiWorkerMessageBridge) {
      return createGlobalWorkerRuntimeBridge();
    }
    return {
      postMessage(value) {
        node.parentPort?.postMessage(value);
      },
      setMessageHandler(handler) {
        const listener = (data) => {
          handler({ data });
        };
        node.parentPort?.on("message", listener);
        return () => {
          node.parentPort?.off("message", listener);
        };
      }
    };
  }
  if (!isGlobalWorkerRuntime()) {
    return;
  }
  return createGlobalWorkerRuntimeBridge();
}
function createGlobalWorkerRuntimeBridge() {
  let currentRegistration;
  return {
    postMessage(value) {
      globalWithWorker.postMessage?.(value);
    },
    setMessageHandler(handler) {
      const previousHandler = getGlobalWorkerMessageHandler();
      if (currentRegistration && previousHandler !== currentRegistration.listener) {
        currentRegistration = undefined;
      }
      const listener = (event) => {
        const normalizedEvent = normalizeWorkerMessageEvent(event);
        handler(normalizedEvent);
      };
      const registration = {
        active: true,
        fallbackHandler: currentRegistration ? currentRegistration.fallbackHandler : previousHandler,
        listener,
        previous: currentRegistration
      };
      currentRegistration = registration;
      setGlobalWorkerMessageHandler(listener);
      return () => {
        registration.active = false;
        if (currentRegistration !== registration || getGlobalWorkerMessageHandler() !== listener) {
          return;
        }
        let previous = registration.previous;
        while (previous && !previous.active) {
          previous = previous.previous;
        }
        currentRegistration = previous;
        setGlobalWorkerMessageHandler(previous?.listener ?? registration.fallbackHandler);
      };
    }
  };
}
function isGlobalWorkerRuntime() {
  if (typeof globalWithWorker.postMessage !== "function") {
    return false;
  }
  return typeof document === "undefined" && typeof globalWithWorker.close === "function" && "onmessage" in globalThis;
}
function normalizeWorkerMessageEvent(event) {
  if (event && typeof event === "object" && "data" in event) {
    return event;
  }
  return { data: event };
}
function getGlobalWorkerMessageHandler() {
  return globalThis.onmessage ?? null;
}
function setGlobalWorkerMessageHandler(handler) {
  globalThis.onmessage = handler;
}

// src/lib/tree-sitter/parser.worker.ts
class ParserWorker {
  bufferParsers = new Map;
  filetypeParserOptions = new Map;
  filetypeAliases = new Map;
  filetypeParsers = new Map;
  filetypeParserPromises = new Map;
  reusableParsers = new Map;
  reusableParserPromises = new Map;
  initializePromise;
  performance;
  dataPath;
  tsDataPath;
  initialized = false;
  constructor() {
    this.performance = {
      averageParseTime: 0,
      parseTimes: [],
      averageQueryTime: 0,
      queryTimes: []
    };
  }
  async fetchQueries(sources, filetype) {
    if (!this.tsDataPath) {
      return "";
    }
    return DownloadUtils.fetchHighlightQueries(sources, this.tsDataPath, filetype);
  }
  async initialize({ dataPath, treeSitterWasmPath }) {
    if (this.initializePromise) {
      return this.initializePromise;
    }
    this.initializePromise = (async () => {
      this.dataPath = dataPath;
      this.tsDataPath = path2.join(dataPath, "tree-sitter");
      await mkdir2(path2.join(this.tsDataPath, "languages"), { recursive: true });
      await mkdir2(path2.join(this.tsDataPath, "queries"), { recursive: true });
      let treeWasm = treeSitterWasmPath ?? resolveAssetPath("web-tree-sitter/tree-sitter.wasm", () => new URL(import.meta.resolve("web-tree-sitter/tree-sitter.wasm")));
      if (isBunfsPath(treeWasm)) {
        treeWasm = normalizeBunfsPath(path2.parse(treeWasm).base);
      }
      await Parser.init({
        locateFile() {
          return treeWasm;
        }
      });
      this.initialized = true;
    })();
    return this.initializePromise;
  }
  addFiletypeParser(filetypeParser) {
    const previousAliases = this.filetypeParserOptions.get(filetypeParser.filetype)?.aliases ?? [];
    for (const alias of previousAliases) {
      if (this.filetypeAliases.get(alias) === filetypeParser.filetype) {
        this.filetypeAliases.delete(alias);
      }
    }
    const aliases = [...new Set((filetypeParser.aliases ?? []).filter((alias) => alias !== filetypeParser.filetype))];
    this.filetypeAliases.delete(filetypeParser.filetype);
    this.filetypeParserOptions.set(filetypeParser.filetype, {
      ...filetypeParser,
      aliases
    });
    for (const alias of aliases) {
      this.filetypeAliases.set(alias, filetypeParser.filetype);
    }
    this.invalidateParserCaches(filetypeParser.filetype);
  }
  resolveCanonicalFiletype(filetype) {
    if (this.filetypeParserOptions.has(filetype)) {
      return filetype;
    }
    return this.filetypeAliases.get(filetype) ?? filetype;
  }
  invalidateParserCaches(filetype) {
    this.filetypeParsers.delete(filetype);
    this.filetypeParserPromises.delete(filetype);
    const reusableParser = this.reusableParsers.get(filetype);
    if (reusableParser) {
      reusableParser.parser.delete();
      this.reusableParsers.delete(filetype);
    }
    this.reusableParserPromises.delete(filetype);
  }
  async createQueries(filetypeParser, language) {
    try {
      const highlightQueryContent = await this.fetchQueries(filetypeParser.queries.highlights, filetypeParser.filetype);
      if (!highlightQueryContent) {
        console.error("Failed to fetch highlight queries for:", filetypeParser.filetype);
        return;
      }
      const highlightsQuery = new Query(language, highlightQueryContent);
      const result = {
        highlights: highlightsQuery
      };
      if (filetypeParser.queries.injections && filetypeParser.queries.injections.length > 0) {
        const injectionQueryContent = await this.fetchQueries(filetypeParser.queries.injections, filetypeParser.filetype);
        if (injectionQueryContent) {
          result.injections = new Query(language, injectionQueryContent);
        }
      }
      return result;
    } catch (error) {
      console.error("Error creating queries for", filetypeParser.filetype, filetypeParser.queries);
      console.error(error);
      return;
    }
  }
  async loadLanguage(languageSource) {
    if (!this.initialized || !this.tsDataPath) {
      return;
    }
    const result = await DownloadUtils.downloadOrLoad(languageSource, this.tsDataPath, "languages", ".wasm", false);
    if (result.error) {
      console.error(`Error loading language ${languageSource}:`, result.error);
      return;
    }
    if (!result.filePath) {
      return;
    }
    const normalizedPath = result.filePath.replaceAll("\\", "/");
    try {
      const language = await Language.load(normalizedPath);
      return language;
    } catch (error) {
      console.error(`Error loading language from ${normalizedPath}:`, error);
      return;
    }
  }
  async resolveFiletypeParser(filetype) {
    const canonicalFiletype = this.resolveCanonicalFiletype(filetype);
    if (this.filetypeParsers.has(canonicalFiletype)) {
      return this.filetypeParsers.get(canonicalFiletype);
    }
    if (this.filetypeParserPromises.has(canonicalFiletype)) {
      return this.filetypeParserPromises.get(canonicalFiletype);
    }
    const loadingPromise = this.loadFiletypeParser(canonicalFiletype);
    this.filetypeParserPromises.set(canonicalFiletype, loadingPromise);
    try {
      const result = await loadingPromise;
      if (result) {
        this.filetypeParsers.set(canonicalFiletype, result);
      }
      return result;
    } finally {
      this.filetypeParserPromises.delete(canonicalFiletype);
    }
  }
  async loadFiletypeParser(filetype) {
    const filetypeParserOptions = this.filetypeParserOptions.get(filetype);
    if (!filetypeParserOptions) {
      return;
    }
    const language = await this.loadLanguage(filetypeParserOptions.wasm);
    if (!language) {
      return;
    }
    const queries = await this.createQueries(filetypeParserOptions, language);
    if (!queries) {
      console.error("Failed to create queries for:", filetype);
      return;
    }
    const filetypeParser = {
      ...filetypeParserOptions,
      queries,
      language
    };
    return filetypeParser;
  }
  async preloadParser(filetype) {
    return this.resolveFiletypeParser(filetype);
  }
  async getReusableParser(filetype) {
    const canonicalFiletype = this.resolveCanonicalFiletype(filetype);
    if (this.reusableParsers.has(canonicalFiletype)) {
      return this.reusableParsers.get(canonicalFiletype);
    }
    if (this.reusableParserPromises.has(canonicalFiletype)) {
      return this.reusableParserPromises.get(canonicalFiletype);
    }
    const creationPromise = this.createReusableParser(canonicalFiletype);
    this.reusableParserPromises.set(canonicalFiletype, creationPromise);
    try {
      const result = await creationPromise;
      if (result) {
        this.reusableParsers.set(canonicalFiletype, result);
      }
      return result;
    } finally {
      this.reusableParserPromises.delete(canonicalFiletype);
    }
  }
  async createReusableParser(filetype) {
    const filetypeParser = await this.resolveFiletypeParser(filetype);
    if (!filetypeParser) {
      return;
    }
    const parser = new Parser;
    parser.setLanguage(filetypeParser.language);
    const reusableState = {
      parser,
      filetypeParser,
      queries: filetypeParser.queries
    };
    return reusableState;
  }
  async handleInitializeParser(bufferId, version, content, filetype, messageId) {
    const filetypeParser = await this.resolveFiletypeParser(filetype);
    if (!filetypeParser) {
      postWorkerMessage({
        type: "PARSER_INIT_RESPONSE",
        bufferId,
        messageId,
        hasParser: false,
        warning: `No parser available for filetype ${filetype}`
      });
      return;
    }
    const parser = new Parser;
    parser.setLanguage(filetypeParser.language);
    const tree = parser.parse(content);
    if (!tree) {
      postWorkerMessage({
        type: "PARSER_INIT_RESPONSE",
        bufferId,
        messageId,
        hasParser: false,
        error: "Failed to parse buffer"
      });
      return;
    }
    const parserState = {
      parser,
      tree,
      queries: filetypeParser.queries,
      filetype,
      content,
      injectionMapping: filetypeParser.injectionMapping
    };
    this.bufferParsers.set(bufferId, parserState);
    postWorkerMessage({
      type: "PARSER_INIT_RESPONSE",
      bufferId,
      messageId,
      hasParser: true
    });
    const highlights = await this.initialQuery(parserState);
    postWorkerMessage({
      type: "HIGHLIGHT_RESPONSE",
      bufferId,
      version,
      ...highlights
    });
  }
  async initialQuery(parserState) {
    const query = parserState.queries.highlights;
    const matches = query.captures(parserState.tree.rootNode);
    let injectionRanges = new Map;
    if (parserState.queries.injections) {
      const injectionResult = await this.processInjections(parserState);
      matches.push(...injectionResult.captures);
      injectionRanges = injectionResult.injectionRanges;
    }
    return this.getHighlights(parserState, matches, injectionRanges);
  }
  getNodeText(node, content) {
    return content.substring(node.startIndex, node.endIndex);
  }
  async processInjections(parserState) {
    const injectionMatches = [];
    const injectionRanges = new Map;
    if (!parserState.queries.injections) {
      return { captures: injectionMatches, injectionRanges };
    }
    const content = parserState.content;
    const injectionCaptures = parserState.queries.injections.captures(parserState.tree.rootNode);
    const languageGroups = new Map;
    const injectionMapping = parserState.injectionMapping;
    for (const capture of injectionCaptures) {
      const captureName = capture.name;
      if (captureName === "injection.content" || captureName.includes("injection")) {
        const nodeType = capture.node.type;
        let targetLanguage;
        if (injectionMapping?.nodeTypes && injectionMapping.nodeTypes[nodeType]) {
          targetLanguage = injectionMapping.nodeTypes[nodeType];
        } else if (nodeType === "code_fence_content") {
          const parent = capture.node.parent;
          if (parent) {
            const infoString = parent.children.find((child) => child.type === "info_string");
            if (infoString) {
              const languageNode = infoString.children.find((child) => child.type === "language");
              if (languageNode) {
                const languageName = this.getNodeText(languageNode, content);
                if (injectionMapping?.infoStringMap && injectionMapping.infoStringMap[languageName]) {
                  targetLanguage = injectionMapping.infoStringMap[languageName];
                } else {
                  targetLanguage = languageName;
                }
              }
            }
          }
        }
        if (targetLanguage) {
          if (!languageGroups.has(targetLanguage)) {
            languageGroups.set(targetLanguage, []);
          }
          languageGroups.get(targetLanguage).push({ node: capture.node, name: capture.name });
        }
      }
    }
    for (const [language, captures] of languageGroups.entries()) {
      const injectedParser = await this.getReusableParser(language);
      if (!injectedParser) {
        console.warn(`No parser found for injection language: ${language}`);
        continue;
      }
      if (!injectionRanges.has(language)) {
        injectionRanges.set(language, []);
      }
      const parser = injectedParser.parser;
      for (const { node: injectionNode } of captures) {
        try {
          injectionRanges.get(language).push({
            start: injectionNode.startIndex,
            end: injectionNode.endIndex
          });
          const injectionContent = this.getNodeText(injectionNode, content);
          const tree = parser.parse(injectionContent);
          if (tree) {
            const matches = injectedParser.queries.highlights.captures(tree.rootNode);
            for (const match of matches) {
              const offsetCapture = {
                name: match.name,
                patternIndex: match.patternIndex,
                _injectedQuery: injectedParser.queries.highlights,
                node: {
                  ...match.node,
                  startPosition: {
                    row: match.node.startPosition.row + injectionNode.startPosition.row,
                    column: match.node.startPosition.row === 0 ? match.node.startPosition.column + injectionNode.startPosition.column : match.node.startPosition.column
                  },
                  endPosition: {
                    row: match.node.endPosition.row + injectionNode.startPosition.row,
                    column: match.node.endPosition.row === 0 ? match.node.endPosition.column + injectionNode.startPosition.column : match.node.endPosition.column
                  },
                  startIndex: match.node.startIndex + injectionNode.startIndex,
                  endIndex: match.node.endIndex + injectionNode.startIndex
                }
              };
              injectionMatches.push(offsetCapture);
            }
            tree.delete();
          }
        } catch (error) {
          console.error(`Error processing injection for language ${language}:`, error);
        }
      }
    }
    return { captures: injectionMatches, injectionRanges };
  }
  editToRange(edit) {
    return {
      startPosition: {
        column: edit.startPosition.column,
        row: edit.startPosition.row
      },
      endPosition: {
        column: edit.newEndPosition.column,
        row: edit.newEndPosition.row
      },
      startIndex: edit.startIndex,
      endIndex: edit.newEndIndex
    };
  }
  async handleEdits(bufferId, content, edits) {
    const parserState = this.bufferParsers.get(bufferId);
    if (!parserState) {
      return { warning: "No parser state found for buffer" };
    }
    parserState.content = content;
    for (const edit of edits) {
      parserState.tree.edit(edit);
    }
    const startParse = performance.now();
    const newTree = parserState.parser.parse(content, parserState.tree);
    const endParse = performance.now();
    const parseTime = endParse - startParse;
    this.performance.parseTimes.push(parseTime);
    if (this.performance.parseTimes.length > 10) {
      this.performance.parseTimes.shift();
    }
    this.performance.averageParseTime = this.performance.parseTimes.reduce((acc, time) => acc + time, 0) / this.performance.parseTimes.length;
    if (!newTree) {
      return { error: "Failed to parse buffer" };
    }
    const changedRanges = parserState.tree.getChangedRanges(newTree);
    parserState.tree = newTree;
    const startQuery = performance.now();
    const matches = [];
    if (changedRanges.length === 0) {
      edits.forEach((edit) => {
        const range = this.editToRange(edit);
        changedRanges.push(range);
      });
    }
    for (const range of changedRanges) {
      let node = parserState.tree.rootNode.descendantForPosition(range.startPosition, range.endPosition);
      if (!node) {
        continue;
      }
      if (node.equals(parserState.tree.rootNode)) {
        const rangeCaptures = parserState.queries.highlights.captures(node, {
          startIndex: range.startIndex - 100,
          endIndex: range.endIndex + 1000
        });
        matches.push(...rangeCaptures);
        continue;
      }
      while (node && !this.nodeContainsRange(node, range)) {
        node = node.parent;
      }
      if (!node) {
        node = parserState.tree.rootNode;
      }
      const nodeCaptures = parserState.queries.highlights.captures(node);
      matches.push(...nodeCaptures);
    }
    let injectionRanges = new Map;
    if (parserState.queries.injections) {
      const injectionResult = await this.processInjections(parserState);
      matches.push(...injectionResult.captures);
      injectionRanges = injectionResult.injectionRanges;
    }
    const endQuery = performance.now();
    const queryTime = endQuery - startQuery;
    this.performance.queryTimes.push(queryTime);
    if (this.performance.queryTimes.length > 10) {
      this.performance.queryTimes.shift();
    }
    this.performance.averageQueryTime = this.performance.queryTimes.reduce((acc, time) => acc + time, 0) / this.performance.queryTimes.length;
    return this.getHighlights(parserState, matches, injectionRanges);
  }
  nodeContainsRange(node, range) {
    return node.startPosition.row <= range.startPosition.row && node.endPosition.row >= range.endPosition.row && (node.startPosition.row < range.startPosition.row || node.startPosition.column <= range.startPosition.column) && (node.endPosition.row > range.endPosition.row || node.endPosition.column >= range.endPosition.column);
  }
  getHighlights(parserState, matches, injectionRanges) {
    const lineHighlights = new Map;
    const droppedHighlights = new Map;
    for (const match of matches) {
      const node = match.node;
      const startLine = node.startPosition.row;
      const endLine = node.endPosition.row;
      const highlight = {
        startCol: node.startPosition.column,
        endCol: node.endPosition.column,
        group: match.name
      };
      if (!lineHighlights.has(startLine)) {
        lineHighlights.set(startLine, new Map);
        droppedHighlights.set(startLine, new Map);
      }
      if (lineHighlights.get(startLine)?.has(node.id)) {
        droppedHighlights.get(startLine)?.set(node.id, lineHighlights.get(startLine)?.get(node.id));
      }
      lineHighlights.get(startLine)?.set(node.id, highlight);
      if (startLine !== endLine) {
        for (let line = startLine + 1;line <= endLine; line++) {
          if (!lineHighlights.has(line)) {
            lineHighlights.set(line, new Map);
          }
          const hl = {
            startCol: 0,
            endCol: node.endPosition.column,
            group: match.name
          };
          lineHighlights.get(line)?.set(node.id, hl);
        }
      }
    }
    return {
      highlights: Array.from(lineHighlights.entries()).map(([line, lineHighlights2]) => ({
        line,
        highlights: Array.from(lineHighlights2.values()),
        droppedHighlights: droppedHighlights.get(line) ? Array.from(droppedHighlights.get(line).values()) : []
      }))
    };
  }
  getSimpleHighlights(matches, injectionRanges) {
    const highlights = [];
    const flatInjectionRanges = [];
    for (const [lang, ranges] of injectionRanges.entries()) {
      for (const range of ranges) {
        flatInjectionRanges.push({ ...range, lang });
      }
    }
    for (const match of matches) {
      const node = match.node;
      let isInjection = false;
      let injectionLang;
      let containsInjection = false;
      for (const injRange of flatInjectionRanges) {
        if (node.startIndex >= injRange.start && node.endIndex <= injRange.end) {
          isInjection = true;
          injectionLang = injRange.lang;
          break;
        } else if (node.startIndex <= injRange.start && node.endIndex >= injRange.end) {
          containsInjection = true;
          break;
        }
      }
      const matchQuery = match._injectedQuery;
      const patternProperties = matchQuery?.setProperties?.[match.patternIndex];
      const concealValue = patternProperties?.conceal ?? match.setProperties?.conceal;
      const concealLines = patternProperties?.conceal_lines ?? match.setProperties?.conceal_lines;
      const meta = {};
      if (isInjection && injectionLang) {
        meta.isInjection = true;
        meta.injectionLang = injectionLang;
      }
      if (containsInjection) {
        meta.containsInjection = true;
      }
      if (concealValue !== undefined) {
        meta.conceal = concealValue;
      }
      if (concealLines !== undefined) {
        meta.concealLines = concealLines;
      }
      if (Object.keys(meta).length > 0) {
        highlights.push([node.startIndex, node.endIndex, match.name, meta]);
      } else {
        highlights.push([node.startIndex, node.endIndex, match.name]);
      }
    }
    highlights.sort((a, b) => a[0] - b[0]);
    return highlights;
  }
  async handleResetBuffer(bufferId, version, content) {
    const parserState = this.bufferParsers.get(bufferId);
    if (!parserState) {
      return { warning: "No parser state found for buffer" };
    }
    parserState.content = content;
    const newTree = parserState.parser.parse(content);
    if (!newTree) {
      return { error: "Failed to parse buffer during reset" };
    }
    parserState.tree = newTree;
    const matches = parserState.queries.highlights.captures(parserState.tree.rootNode);
    let injectionRanges = new Map;
    if (parserState.queries.injections) {
      const injectionResult = await this.processInjections(parserState);
      matches.push(...injectionResult.captures);
      injectionRanges = injectionResult.injectionRanges;
    }
    return this.getHighlights(parserState, matches, injectionRanges);
  }
  disposeBuffer(bufferId) {
    const parserState = this.bufferParsers.get(bufferId);
    if (!parserState) {
      return;
    }
    parserState.tree.delete();
    parserState.parser.delete();
    this.bufferParsers.delete(bufferId);
  }
  async handleOneShotHighlight(content, filetype, messageId) {
    const reusableState = await this.getReusableParser(filetype);
    if (!reusableState) {
      postWorkerMessage({
        type: "ONESHOT_HIGHLIGHT_RESPONSE",
        messageId,
        hasParser: false,
        warning: `No parser available for filetype ${filetype}`
      });
      return;
    }
    const parseContent = filetype === "markdown" && content.endsWith("```") ? content + `
` : content;
    const tree = reusableState.parser.parse(parseContent);
    if (!tree) {
      postWorkerMessage({
        type: "ONESHOT_HIGHLIGHT_RESPONSE",
        messageId,
        hasParser: false,
        error: "Failed to parse content"
      });
      return;
    }
    try {
      const matches = reusableState.filetypeParser.queries.highlights.captures(tree.rootNode);
      let injectionRanges = new Map;
      if (reusableState.filetypeParser.queries.injections) {
        const parserState = {
          parser: reusableState.parser,
          tree,
          queries: reusableState.filetypeParser.queries,
          filetype,
          content,
          injectionMapping: reusableState.filetypeParser.injectionMapping
        };
        const injectionResult = await this.processInjections(parserState);
        matches.push(...injectionResult.captures);
        injectionRanges = injectionResult.injectionRanges;
      }
      const highlights = this.getSimpleHighlights(matches, injectionRanges);
      postWorkerMessage({
        type: "ONESHOT_HIGHLIGHT_RESPONSE",
        messageId,
        hasParser: true,
        highlights
      });
    } finally {
      tree.delete();
    }
  }
  async updateDataPath(dataPath) {
    this.dataPath = dataPath;
    this.tsDataPath = path2.join(dataPath, "tree-sitter");
    try {
      await mkdir2(path2.join(this.tsDataPath, "languages"), { recursive: true });
      await mkdir2(path2.join(this.tsDataPath, "queries"), { recursive: true });
    } catch (error) {
      throw new Error(`Failed to update data path: ${error}`);
    }
  }
  async clearCache() {
    if (!this.dataPath || !this.tsDataPath) {
      throw new Error("No data path configured");
    }
    const { rm } = await import("fs/promises");
    try {
      const treeSitterPath = path2.join(this.dataPath, "tree-sitter");
      await rm(treeSitterPath, { recursive: true, force: true });
      await mkdir2(path2.join(treeSitterPath, "languages"), { recursive: true });
      await mkdir2(path2.join(treeSitterPath, "queries"), { recursive: true });
      this.filetypeParsers.clear();
      this.filetypeParserPromises.clear();
      this.reusableParsers.clear();
      this.reusableParserPromises.clear();
    } catch (error) {
      throw new Error(`Failed to clear cache: ${error}`);
    }
  }
}
function logMessage(type, ...args2) {
  postWorkerMessage({
    type: "WORKER_LOG",
    logType: type,
    data: args2
  });
}
function postWorkerError(bufferId, error) {
  postWorkerMessage({
    type: "ERROR",
    bufferId,
    error: error instanceof Error ? error.stack || error.message : String(error)
  });
}
if (isWorkerRuntime) {
  const worker = new ParserWorker;
  console.log = (...args2) => logMessage("log", ...args2);
  console.error = (...args2) => logMessage("error", ...args2);
  console.warn = (...args2) => logMessage("warn", ...args2);
  setWorkerMessageHandler(async (event) => {
    const message = event.data;
    const messageType = String(event.data.type ?? "unknown");
    try {
      switch (message.type) {
        case "INIT":
          try {
            await worker.initialize({ dataPath: message.dataPath, treeSitterWasmPath: message.treeSitterWasmPath });
            postWorkerMessage({ type: "INIT_RESPONSE" });
          } catch (error) {
            postWorkerMessage({
              type: "INIT_RESPONSE",
              error: error instanceof Error ? error.stack || error.message : String(error)
            });
          }
          break;
        case "ADD_FILETYPE_PARSER":
          worker.addFiletypeParser(message.filetypeParser);
          break;
        case "PRELOAD_PARSER": {
          const maybeParser = await worker.preloadParser(message.filetype);
          postWorkerMessage({
            type: "PRELOAD_PARSER_RESPONSE",
            messageId: message.messageId,
            hasParser: !!maybeParser
          });
          break;
        }
        case "INITIALIZE_PARSER":
          await worker.handleInitializeParser(message.bufferId, message.version, message.content, message.filetype, message.messageId);
          break;
        case "HANDLE_EDITS": {
          const response = await worker.handleEdits(message.bufferId, message.content, message.edits);
          if (response.highlights && response.highlights.length > 0) {
            postWorkerMessage({
              type: "HIGHLIGHT_RESPONSE",
              bufferId: message.bufferId,
              version: message.version,
              highlights: response.highlights
            });
          } else if (response.warning) {
            postWorkerMessage({
              type: "WARNING",
              bufferId: message.bufferId,
              warning: response.warning
            });
          } else if (response.error) {
            postWorkerMessage({
              type: "ERROR",
              bufferId: message.bufferId,
              error: response.error
            });
          }
          break;
        }
        case "GET_PERFORMANCE":
          postWorkerMessage({
            type: "PERFORMANCE_RESPONSE",
            performance: worker.performance,
            messageId: message.messageId
          });
          break;
        case "RESET_BUFFER": {
          const resetResponse = await worker.handleResetBuffer(message.bufferId, message.version, message.content);
          if (resetResponse.highlights && resetResponse.highlights.length > 0) {
            postWorkerMessage({
              type: "HIGHLIGHT_RESPONSE",
              bufferId: message.bufferId,
              version: message.version,
              highlights: resetResponse.highlights
            });
          } else if (resetResponse.warning) {
            postWorkerMessage({
              type: "WARNING",
              bufferId: message.bufferId,
              warning: resetResponse.warning
            });
          } else if (resetResponse.error) {
            postWorkerMessage({
              type: "ERROR",
              bufferId: message.bufferId,
              error: resetResponse.error
            });
          }
          break;
        }
        case "DISPOSE_BUFFER":
          worker.disposeBuffer(message.bufferId);
          postWorkerMessage({
            type: "BUFFER_DISPOSED",
            bufferId: message.bufferId
          });
          break;
        case "ONESHOT_HIGHLIGHT":
          await worker.handleOneShotHighlight(message.content, message.filetype, message.messageId);
          break;
        case "UPDATE_DATA_PATH":
          try {
            await worker.updateDataPath(message.dataPath);
            postWorkerMessage({
              type: "UPDATE_DATA_PATH_RESPONSE",
              messageId: message.messageId
            });
          } catch (error) {
            postWorkerMessage({
              type: "UPDATE_DATA_PATH_RESPONSE",
              messageId: message.messageId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          break;
        case "CLEAR_CACHE":
          try {
            await worker.clearCache();
            postWorkerMessage({
              type: "CLEAR_CACHE_RESPONSE",
              messageId: message.messageId
            });
          } catch (error) {
            postWorkerMessage({
              type: "CLEAR_CACHE_RESPONSE",
              messageId: message.messageId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          break;
        default:
          postWorkerMessage({
            type: "ERROR",
            error: `Unknown message type: ${messageType}`
          });
      }
    } catch (error) {
      if ("bufferId" in message) {
        postWorkerError(message.bufferId, error);
      } else {
        postWorkerError(undefined, error);
      }
    }
  });
}

//# debugId=87DC963DDC93A9B264756E2164756E21
//# sourceMappingURL=parser.worker.js.map
