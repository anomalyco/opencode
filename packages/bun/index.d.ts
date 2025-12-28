export function $ (cmdParts: TemplateStringsArray, ...args: any[]): any
export function readableStreamToText(stream: any): Promise<string>
export function spawn(...args: any[]): any
export function file(p: string): { text(): Promise<string>, json(): Promise<any>, exists(): Promise<boolean> }
