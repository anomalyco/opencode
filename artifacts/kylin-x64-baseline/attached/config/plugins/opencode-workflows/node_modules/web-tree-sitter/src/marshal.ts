import { Edit, INTERNAL, Point, Range, SIZE_OF_INT, SIZE_OF_NODE, SIZE_OF_POINT, C } from "./constants";
import { Node } from "./node";
import { Tree } from "./tree";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Query, QueryCapture, type QueryMatch } from "./query";
import { TreeCursor } from "./tree_cursor";
import { TRANSFER_BUFFER } from "./parser";
import { LanguageMetadata } from "./language";

/**
 * @internal
 *
 * Unmarshals a {@link QueryMatch} to the transfer buffer.
 */
export function unmarshalCaptures(
  query: Query,
  tree: Tree,
  address: number,
  patternIndex: number,
  result: QueryCapture[]
) {
  for (let i = 0, n = result.length; i < n; i++) {
    const captureIndex = C.getValue(address, 'i32');
    address += SIZE_OF_INT;
    const node = unmarshalNode(tree, address)!;
    address += SIZE_OF_NODE;
    result[i] = {patternIndex, name: query.captureNames[captureIndex], node};
  }
  return address;
}

/**
 * @internal
 *
 * Marshals a {@link Node} to the transfer buffer.
 */
export function marshalNode(node: Node, index = 0) {
  let address = TRANSFER_BUFFER + index * SIZE_OF_NODE;
  C.setValue(address, node.id, 'i32');
  address += SIZE_OF_INT;
  C.setValue(address, node.startIndex, 'i32');
  address += SIZE_OF_INT;
  C.setValue(address, node.startPosition.row, 'i32');
  address += SIZE_OF_INT;
  C.setValue(address, node.startPosition.column, 'i32');
  address += SIZE_OF_INT;
  C.setValue(address, node[0], 'i32');
}

/**
 * @internal
 *
 * Unmarshals a {@link Node} from the transfer buffer.
 */
export function unmarshalNode(tree: Tree, address = TRANSFER_BUFFER): Node | null {
  const id = C.getValue(address, 'i32');
  address += SIZE_OF_INT;
  if (id === 0) return null;

  const index = C.getValue(address, 'i32');
  address += SIZE_OF_INT;
  const row = C.getValue(address, 'i32');
  address += SIZE_OF_INT;
  const column = C.getValue(address, 'i32');
  address += SIZE_OF_INT;
  const other = C.getValue(address, 'i32');

  const result = new Node(INTERNAL, {
    id,
    tree,
    startIndex: index,
    startPosition: {row, column},
    other,
  });

  return result;
}

/**
 * @internal
 *
 * Marshals a {@link TreeCursor} to the transfer buffer.
 */
export function marshalTreeCursor(cursor: TreeCursor, address = TRANSFER_BUFFER) {
  C.setValue(address + 0 * SIZE_OF_INT, cursor[0], 'i32');
  C.setValue(address + 1 * SIZE_OF_INT, cursor[1], 'i32');
  C.setValue(address + 2 * SIZE_OF_INT, cursor[2], 'i32');
  C.setValue(address + 3 * SIZE_OF_INT, cursor[3], 'i32');
}

/**
 * @internal
 *
 * Unmarshals a {@link TreeCursor} from the transfer buffer.
 */
export function unmarshalTreeCursor(cursor: TreeCursor) {
  cursor[0] = C.getValue(TRANSFER_BUFFER + 0 * SIZE_OF_INT, 'i32');
  cursor[1] = C.getValue(TRANSFER_BUFFER + 1 * SIZE_OF_INT, 'i32');
  cursor[2] = C.getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, 'i32');
  cursor[3] = C.getValue(TRANSFER_BUFFER + 3 * SIZE_OF_INT, 'i32');
}

/**
 * @internal
 *
 * Marshals a {@link Point} to the transfer buffer.
 */
export function marshalPoint(address: number, point: Point): void {
  C.setValue(address, point.row, 'i32');
  C.setValue(address + SIZE_OF_INT, point.column, 'i32');
}

/**
 * @internal
 *
 * Unmarshals a {@link Point} from the transfer buffer.
 */
export function unmarshalPoint(address: number): Point {
  const result = {
    row: C.getValue(address, 'i32') >>> 0,
    column: C.getValue(address + SIZE_OF_INT, 'i32') >>> 0,
  };
  return result;
}

/**
 * @internal
 *
 * Marshals a {@link Range} to the transfer buffer.
 */
export function marshalRange(address: number, range: Range): void {
  marshalPoint(address, range.startPosition); address += SIZE_OF_POINT;
  marshalPoint(address, range.endPosition); address += SIZE_OF_POINT;
  C.setValue(address, range.startIndex, 'i32'); address += SIZE_OF_INT;
  C.setValue(address, range.endIndex, 'i32'); address += SIZE_OF_INT;
}

/**
 * @internal
 *
 * Unmarshals a {@link Range} from the transfer buffer.
 */
export function unmarshalRange(address: number): Range {
  const result = {} as Range;
  result.startPosition = unmarshalPoint(address); address += SIZE_OF_POINT;
  result.endPosition = unmarshalPoint(address); address += SIZE_OF_POINT;
  result.startIndex = C.getValue(address, 'i32') >>> 0; address += SIZE_OF_INT;
  result.endIndex = C.getValue(address, 'i32') >>> 0;
  return result;
}

/**
 * @internal
 *
 * Marshals an {@link Edit} to the transfer buffer.
 */
export function marshalEdit(edit: Edit, address = TRANSFER_BUFFER) {
  marshalPoint(address, edit.startPosition); address += SIZE_OF_POINT;
  marshalPoint(address, edit.oldEndPosition); address += SIZE_OF_POINT;
  marshalPoint(address, edit.newEndPosition); address += SIZE_OF_POINT;
  C.setValue(address, edit.startIndex, 'i32'); address += SIZE_OF_INT;
  C.setValue(address, edit.oldEndIndex, 'i32'); address += SIZE_OF_INT;
  C.setValue(address, edit.newEndIndex, 'i32'); address += SIZE_OF_INT;
}

/**
 * @internal
 *
 * Unmarshals a {@link LanguageMetadata} from the transfer buffer.
 */
export function unmarshalLanguageMetadata(address: number): LanguageMetadata {  
  const major_version = C.getValue(address, 'i32');
  const minor_version = C.getValue(address += SIZE_OF_INT, 'i32');
  const patch_version = C.getValue(address += SIZE_OF_INT, 'i32');
  return { major_version, minor_version, patch_version };
}
