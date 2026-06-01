export class UnreachableCodeError extends Error {
    constructor(value: never) {
        super("Unreachable code reached: " + JSON.stringify(value));
    }
}
