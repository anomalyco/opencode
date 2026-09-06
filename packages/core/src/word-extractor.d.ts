declare module "word-extractor" {
  export default class WordExtractor {
    extract(buffer: Buffer): Promise<{
      getBody(): string
      getFootnotes(): string
      getHeaders(): string
    }>
  }
}
