// tesseract.js 为可选依赖，仅提供类型声明
declare module "tesseract.js" {
  const Tesseract: {
    recognize: (
      image: string,
      languages: string,
      options: { logger?: (msg: any) => void },
    ) => Promise<{
      data: {
        text: string
        confidence: number
      }
    }>
  }
  export default Tesseract
}
