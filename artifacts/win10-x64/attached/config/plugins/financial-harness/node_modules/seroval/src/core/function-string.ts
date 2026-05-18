declare const T: unknown;

const RETURN = () => T;
const SERIALIZED_RETURN = /* @__PURE__ */ RETURN.toString();

const IS_MODERN = /* @__PURE__ */ /=>/.test(SERIALIZED_RETURN);

export function createFunction(parameters: string[], body: string): string {
  if (IS_MODERN) {
    const joined =
      parameters.length === 1
        ? parameters[0]
        : '(' + parameters.join(',') + ')';
    return joined + '=>' + (body.startsWith('{') ? '(' + body + ')' : body);
  }
  return 'function(' + parameters.join(',') + '){return ' + body + '}';
}

export function createEffectfulFunction(
  parameters: string[],
  body: string,
): string {
  if (IS_MODERN) {
    const joined =
      parameters.length === 1
        ? parameters[0]
        : '(' + parameters.join(',') + ')';
    return joined + '=>{' + body + '}';
  }
  return 'function(' + parameters.join(',') + '){' + body + '}';
}
