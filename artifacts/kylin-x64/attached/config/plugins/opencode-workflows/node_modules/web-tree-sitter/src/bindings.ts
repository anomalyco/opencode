import createModule, { type MainModule } from '../lib/tree-sitter';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { type Parser } from './parser';

export let Module: MainModule | null = null;

/**
 * @internal
 *
 * Initialize the Tree-sitter WASM module. This should only be called by the {@link Parser} class via {@link Parser.init}.
 */
export async function initializeBinding(moduleOptions?: EmscriptenModule): Promise<MainModule> {
  if (!Module) {
    Module = await createModule(moduleOptions);
  }
  return Module;
}

/**
 * @internal
 *
 * Checks if the Tree-sitter WASM module has been initialized.
 */
export function checkModule(): boolean {
  return !!Module;
}
