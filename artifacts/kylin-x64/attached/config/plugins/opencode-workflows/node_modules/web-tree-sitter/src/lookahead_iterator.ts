import { C, Internal, assertInternal } from './constants';
import { Language } from './language';

export class LookaheadIterator implements Iterable<string> {
  /** @internal */
  private [0] = 0; // Internal handle for WASM

  /** @internal */
  private language: Language;

  /** @internal */
  constructor(internal: Internal, address: number, language: Language) {
    assertInternal(internal);
    this[0] = address;
    this.language = language;
  }

  /** Get the current symbol of the lookahead iterator. */
  get currentTypeId(): number {
    return C._ts_lookahead_iterator_current_symbol(this[0]);
  }

  /** Get the current symbol name of the lookahead iterator. */
  get currentType(): string {
    return this.language.types[this.currentTypeId] || 'ERROR';
  }

  /** Delete the lookahead iterator, freeing its resources. */
  delete(): void {
    C._ts_lookahead_iterator_delete(this[0]);
    this[0] = 0;
  }


  /**
   * Reset the lookahead iterator.
   *
   * This returns `true` if the language was set successfully and `false`
   * otherwise.
   */
  reset(language: Language, stateId: number): boolean {
    if (C._ts_lookahead_iterator_reset(this[0], language[0], stateId)) {
      this.language = language;
      return true;
    }
    return false;
  }

  /**
   * Reset the lookahead iterator to another state.
   *
   * This returns `true` if the iterator was reset to the given state and
   * `false` otherwise.
   */
  resetState(stateId: number): boolean {
    return Boolean(C._ts_lookahead_iterator_reset_state(this[0], stateId));
  }

  /**
   * Returns an iterator that iterates over the symbols of the lookahead iterator.
   *
   * The iterator will yield the current symbol name as a string for each step
   * until there are no more symbols to iterate over.
   */
  [Symbol.iterator](): Iterator<string> {
    return {
      next: (): IteratorResult<string> => {
        if (C._ts_lookahead_iterator_next(this[0])) {
          return { done: false, value: this.currentType };
        }
        return { done: true, value: '' };
      }
    };
  }
}
