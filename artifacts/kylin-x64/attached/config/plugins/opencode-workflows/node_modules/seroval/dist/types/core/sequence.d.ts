export interface Sequence {
    __SEROVAL_SEQUENCE__: true;
    v: unknown[];
    t: number;
    d: number;
}
export declare function isSequence(value: object): value is Sequence;
export declare function createSequence(values: unknown[], throwAt: number, doneAt: number): Sequence;
export declare function createSequenceFromIterable<T>(source: Iterable<T>): Sequence;
export declare function sequenceToIterator<T>(sequence: Sequence): () => IterableIterator<T>;
//# sourceMappingURL=sequence.d.ts.map