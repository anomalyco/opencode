/**
 * FileTime stub — browser agent doesn't track code file modifications.
 */
export namespace FileTime {
  export function get(_sessionID: string, _file: string): number | undefined {
    return undefined
  }

  export function set(_sessionID: string, _file: string, _time?: number): void {}

  export function check(_sessionID: string, _file: string): { modified: boolean; time?: number } {
    return { modified: false }
  }

  export function clear(_sessionID: string): void {}
}
