/**
 * A protocol for writing text to some kind of output.
 */
export interface Output {
    /**
     * Write data to the output.
     *
     * Writes are ordered and associative. That is, `write(a); write(b)` is
     * equivalent to `write(a + b)`.
     */
    write(data: string): Promise<void>;
}
