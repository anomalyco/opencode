import { codeToHtml, bundledLanguages } from "shiki"
import { createResource, Suspense } from "solid-js"
import style from "./content-code.module.css"

interface Props {
  code: string
  lang?: string
  flush?: boolean
}
const htmlCache = new Map<string, string>();

export function ContentCode(props: Props) {
  const [html] = createResource(
    () => [props.code, props.lang],
    async ([code, lang]) => {
      const cacheKey = `${lang}:${code}`;
      if (htmlCache.has(cacheKey)) {
        return htmlCache.get(cacheKey)!;
      }
      const result = (await codeToHtml(code || "", {
        lang: lang && lang in bundledLanguages ? lang : "text",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
      }));
      if (htmlCache.size > 1000) {
        const firstKey = htmlCache.keys().next().value;
        htmlCache.delete(firstKey);
      }
      htmlCache.set(cacheKey, result);
      return result;
    },
  )
  return (
    <Suspense>
      <div innerHTML={html()} class={style.root} data-flush={props.flush === true ? true : undefined} />
    </Suspense>
  )
}
