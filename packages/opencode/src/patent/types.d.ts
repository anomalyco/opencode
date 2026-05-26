declare module "mammoth" {
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>
}

declare module "pdf-parse" {
  const pdfParse: (buffer: Buffer) => Promise<{ text: string }>
  export default pdfParse
}