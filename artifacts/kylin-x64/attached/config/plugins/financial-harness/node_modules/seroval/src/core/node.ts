import type { SerovalNodeType } from './constants';
import type { SerovalNode } from './types';

type ExtractedNodeType<T extends SerovalNodeType> = Extract<
  SerovalNode,
  { t: T }
>;

export function createSerovalNode<
  T extends SerovalNodeType,
  N extends ExtractedNodeType<T>,
>(
  t: T,
  i: N['i'],
  s: N['s'],
  c: N['c'],
  m: N['m'],
  p: N['p'],
  e: N['e'],
  a: N['a'],
  f: N['f'],
  b: N['b'],
  o: N['o'],
  l: N['l'],
): N {
  return {
    t,
    i,
    s,
    c,
    m,
    p,
    e,
    a,
    f,
    b,
    o,
    l,
  } as N;
}
