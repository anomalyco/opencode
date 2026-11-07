export const questionCache = new Map<
  string,
  { tab: number; answers: string[][]; custom: string[]; customOn: boolean[] }
>()
