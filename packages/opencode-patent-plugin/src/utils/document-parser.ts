/**
 * 文档解析工具
 *
 * 支持 DOCX/DOC/WPS、PDF、图片（OCR）、TXT/MD 格式。
 * 所有重依赖（mammoth、pdf-parse、tesseract.js）均动态 import，
 * 单个依赖缺失只影响对应格式。
 */

import * as fs from "fs"
import * as path from "path"

// --- 类型定义 ---

export interface ParseResult {
  text: string
  metadata: {
    filename: string
    size: number
    format: string
    pages?: number
    author?: string
    parseTime: number
    needsOcr?: boolean
  }
}

export interface OcrResult {
  text: string
  confidence: number
  language: string
}

// --- 动态加载缓存 ---

let mammoth: any
let TurndownService: any
let pdfParse: any
let Tesseract: any

async function loadMammoth() {
  if (!mammoth) {
    const mod = await import("mammoth")
    mammoth = mod.default || mod
  }
  return mammoth
}

async function loadTurndown() {
  if (!TurndownService) {
    const mod = await import("turndown")
    TurndownService = mod.default || mod
  }
  return TurndownService
}

async function loadPdfParse() {
  if (!pdfParse) {
    const mod = await import("pdf-parse")
    pdfParse = (mod as any).default || mod
  }
  return pdfParse
}

async function loadTesseract() {
  if (!Tesseract) {
    // tesseract.js 为可选依赖，动态加载
    const mod = await import(/* @vite-ignore */ "tesseract.js") as any
    Tesseract = mod.default || mod
  }
  return Tesseract
}

// --- DOCX 解析 ---

export async function parseDocx(filePath: string): Promise<ParseResult> {
  const start = Date.now()
  const stats = fs.statSync(filePath)

  const mammothLib = await loadMammoth()
  const TurndownLib = await loadTurndown()

  const buffer = fs.readFileSync(filePath)
  const htmlResult = await mammothLib.convertToHtml({ buffer })

  const td = new TurndownLib({ headingStyle: "atx", codeBlockStyle: "fenced" })
  const markdown = td.turndown(htmlResult.value)

  return {
    text: markdown,
    metadata: {
      filename: path.basename(filePath),
      size: stats.size,
      format: "docx",
      parseTime: Date.now() - start,
    },
  }
}

// --- PDF 解析 ---

export async function parsePdf(filePath: string): Promise<ParseResult> {
  const start = Date.now()
  const stats = fs.statSync(filePath)

  const parseLib = await loadPdfParse()
  const buffer = fs.readFileSync(filePath)
  const data = await parseLib(buffer)

  // 检测是否为扫描件（文本极少）
  const textLength = (data.text || "").trim().length
  const needsOcr = data.numpages > 0 && textLength < data.numpages * 50

  return {
    text: data.text || "",
    metadata: {
      filename: path.basename(filePath),
      size: stats.size,
      format: "pdf",
      pages: data.numpages,
      author: data.info?.Author,
      parseTime: Date.now() - start,
      needsOcr,
    },
  }
}

// --- OCR ---

export async function ocrImage(
  imagePath: string,
  languages?: string[],
): Promise<OcrResult> {
  try {
    const tesseractLib = await loadTesseract()
    const lang = (languages || ["eng", "chi_sim"]).join("+")

    const result = await tesseractLib.recognize(imagePath, lang, {
      logger: () => {},
    })

    return {
      text: result.data.text || "",
      confidence: result.data.confidence || 0,
      language: lang,
    }
  } catch (error: any) {
    return {
      text: `[OCR 不可用] ${error?.message || "tesseract.js 未安装。请运行: bun add tesseract.js"}`,
      confidence: 0,
      language: "none",
    }
  }
}

// --- 自动路由 ---

const DOCX_EXTS = new Set([".docx", ".doc", ".wps"])
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif", ".webp"])
const TEXT_EXTS = new Set([".txt", ".md", ".markdown"])

export async function detectAndParse(
  filePath: string,
  options?: { ocr?: boolean; ocrLanguages?: string[] },
): Promise<ParseResult> {
  const ext = path.extname(filePath).toLowerCase()

  if (DOCX_EXTS.has(ext)) {
    return await parseDocx(filePath)
  }

  if (ext === ".pdf") {
    const result = await parsePdf(filePath)
    // 扫描件 + OCR 启用时，尝试 OCR
    if (result.metadata.needsOcr && options?.ocr) {
      const ocrResult = await ocrPdfFallback(filePath, options.ocrLanguages)
      if (ocrResult.text.length > result.text.length) {
        result.text = ocrResult.text
        result.metadata.needsOcr = false
      }
    }
    return result
  }

  if (IMAGE_EXTS.has(ext)) {
    const ocrResult = await ocrImage(filePath, options?.ocrLanguages)
    const stats = fs.statSync(filePath)
    return {
      text: ocrResult.text,
      metadata: {
        filename: path.basename(filePath),
        size: stats.size,
        format: "image",
        parseTime: 0,
      },
    }
  }

  if (TEXT_EXTS.has(ext)) {
    const start = Date.now()
    const stats = fs.statSync(filePath)
    const text = fs.readFileSync(filePath, "utf-8")
    return {
      text,
      metadata: {
        filename: path.basename(filePath),
        size: stats.size,
        format: ext.replace(".", ""),
        parseTime: Date.now() - start,
      },
    }
  }

  throw new Error(
    `不支持的文件格式: ${ext}。支持: DOCX/DOC/WPS、PDF、PNG/JPG/BMP/TIFF、TXT/MD`,
  )
}

/**
 * PDF OCR 降级方案：将 PDF 作为整体交给 tesseract.js
 * （tesseract.js 可以直接处理 PDF 文件）
 */
async function ocrPdfFallback(
  filePath: string,
  languages?: string[],
): Promise<OcrResult> {
  try {
    const tesseractLib = await loadTesseract()
    const lang = (languages || ["eng", "chi_sim"]).join("+")
    const result = await tesseractLib.recognize(filePath, lang, {
      logger: () => {},
    })
    return {
      text: result.data.text || "",
      confidence: result.data.confidence || 0,
      language: lang,
    }
  } catch {
    return { text: "", confidence: 0, language: "none" }
  }
}
