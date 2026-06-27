/**
 * 文档解析服务
 *
 * 负责从各类办公文档中提取纯文本内容。
 * 支持的格式：
 * - PDF：使用 pdf-parse 提取文本，必要时用 pdfjs-dist 兜底
 * - DOC/WPS：使用 word-extractor 提取文本（旧版 Word/WPS Writer）
 * - DOCX/XLSX/PPTX/ODP/ODS/ODT：使用 mammoth/officeparser 提取文本
 * - TXT/MD/CSV/JSON/XML/HTML/JS/TS/PY 等：直接 UTF-8 读取
 */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { resolveAttachmentPath } from './config-paths'

// ===== 文件类型分类 =====

/** officeparser 支持的格式 */
const OFFICE_EXTENSIONS = new Set([
  '.docx', '.xlsx', '.pptx',
  '.odt', '.odp', '.ods',
  '.docm', '.dotx', '.dotm',
  '.xlsm', '.xltx', '.xltm',
  '.pptm', '.potx', '.potm', '.ppsx', '.ppsm',
])

/** 旧版 Word/WPS Writer 格式 */
const LEGACY_WORD_EXTENSIONS = new Set([
  '.doc', '.dot', '.wps', '.wpt',
])

/** WPS 原生表格/演示格式：尽量交给 Office 解析器尝试 */
const WPS_OFFICE_EXTENSIONS = new Set([
  '.et', '.ett', '.dps', '.dpt',
])

/** RTF 文档 */
const RICH_TEXT_EXTENSIONS = new Set([
  '.rtf',
])

/** 纯文本格式（直接 UTF-8 读取） */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.xml', '.html',
  '.js', '.ts', '.py', '.yaml', '.yml', '.toml',
  '.log', '.ini', '.cfg', '.conf', '.sh', '.bat',
  '.css', '.scss', '.less', '.sql', '.graphql',
  '.env', '.gitignore', '.dockerfile',
])

/** 所有支持文档解析的扩展名（不含图片） */
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  ...OFFICE_EXTENSIONS,
  ...LEGACY_WORD_EXTENSIONS,
  ...WPS_OFFICE_EXTENSIONS,
  ...RICH_TEXT_EXTENSIONS,
  ...TEXT_EXTENSIONS,
])

/**
 * 判断文件扩展名是否支持文本提取
 *
 * @param ext 文件扩展名（含点号，如 '.pdf'）
 */
export function isSupportedDocumentExtension(ext: string): boolean {
  return SUPPORTED_DOCUMENT_EXTENSIONS.has(ext.toLowerCase())
}

/**
 * 根据 MIME 类型判断是否为可解析文档（非图片附件）
 *
 * 排除图片类型，其余尝试按扩展名判断。
 */
export function isDocumentAttachment(mediaType: string): boolean {
  return !mediaType.startsWith('image/')
}

/**
 * 从文件中提取纯文本内容
 *
 * 根据文件扩展名选择合适的解析器：
 * - .pdf → pdf-parse，必要时 pdfjs-dist
 * - .doc/.dot/.wps/.wpt → word-extractor
 * - .docx/.xlsx/.pptx/.odt/.odp/.ods 等 → mammoth/officeparser
 * - .txt/.md/... → 直接 UTF-8 读取
 *
 * @param filePath 文件的完整路径
 * @returns 提取的纯文本内容
 * @throws 不支持的格式或解析失败时抛出错误
 */
export async function extractTextFromFile(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase()

  // PDF 文件
  if (ext === '.pdf') {
    return extractPdf(filePath)
  }

  // 旧版 Word/WPS Writer 文件
  if (LEGACY_WORD_EXTENSIONS.has(ext)) {
    return extractLegacyWord(filePath)
  }

  // Office 和 OpenDocument 格式
  if (OFFICE_EXTENSIONS.has(ext)) {
    return extractOffice(filePath)
  }

  // WPS 原生表格/演示格式
  if (WPS_OFFICE_EXTENSIONS.has(ext)) {
    return extractWpsOffice(filePath)
  }

  // 富文本格式
  if (RICH_TEXT_EXTENSIONS.has(ext)) {
    return extractOffice(filePath)
  }

  // 纯文本格式
  if (TEXT_EXTENSIONS.has(ext)) {
    return readFileSync(filePath, 'utf-8')
  }

  // 未知格式：尝试当作文本读取
  console.warn(`[文档解析] 未知格式 ${ext}，尝试作为文本读取: ${filePath}`)
  return readFileSync(filePath, 'utf-8')
}

/**
 * 提取 PDF 文本
 */
async function extractPdf(filePath: string): Promise<string> {
  const buffer = readFileSync(filePath)

  try {
    const pdfParse = (await import('pdf-parse')).default
    const result = await pdfParse(buffer)
    const text = result.text.trim()
    if (text.length > 0) {
      console.log(`[文档解析] PDF 提取完成: ${result.numpages} 页, ${result.text.length} 字符`)
      return result.text
    }
    console.warn(`[文档解析] PDF 文本为空，尝试 pdfjs-dist 兜底: ${filePath}`)
  } catch (error) {
    console.warn(`[文档解析] pdf-parse 提取失败，尝试 pdfjs-dist 兜底: ${filePath}`, error)
  }

  const text = await extractPdfWithPdfJs(buffer)
  console.log(`[文档解析] PDF 兜底提取完成: ${text.length} 字符`)
  return text
}

/**
 * 提取旧版 Word/WPS Writer 文本
 */
async function extractLegacyWord(filePath: string): Promise<string> {
  const WordExtractor = (await import('word-extractor')).default
  const extractor = new WordExtractor()
  const extracted = await extractor.extract(filePath)
  const text = extracted.getBody()
  console.log(`[文档解析] 旧版 Word/WPS 提取完成: ${text.length} 字符`)
  return text
}

/**
 * 提取 Office/OpenDocument 文本（DOCX, XLSX, PPTX, ODT, ODP, ODS）
 */
async function extractOffice(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.docx' || ext === '.docm' || ext === '.dotx' || ext === '.dotm') {
    try {
      const text = await extractDocxWithMammoth(filePath)
      if (text.trim()) {
        console.log(`[文档解析] DOCX 提取完成: ${text.length} 字符`)
        return text
      }
    } catch (error) {
      console.warn(`[文档解析] mammoth 提取失败，尝试 officeparser 兜底: ${filePath}`, error)
    }
  }

  const officeParser = await import('officeparser')
  const text = await officeParser.parseOfficeAsync(filePath)
  console.log(`[文档解析] Office 提取完成: ${text.length} 字符`)
  return text
}

/**
 * 提取 WPS 原生表格/演示文本
 */
async function extractWpsOffice(filePath: string): Promise<string> {
  try {
    return await extractOffice(filePath)
  } catch (error) {
    const ext = extname(filePath).toLowerCase()
    console.warn(`[文档解析] WPS 原生格式提取失败: ${filePath}`, error)
    throw new Error(`暂不支持解析 ${ext} 原生格式，请在 WPS 中另存为 DOCX/XLSX/PPTX 或 PDF 后重试`)
  }
}

interface MammothModule {
  extractRawText(input: { path: string }): Promise<{ value: string }>
}

async function extractDocxWithMammoth(filePath: string): Promise<string> {
  const mammoth = await import('mammoth') as unknown as MammothModule
  const result = await mammoth.extractRawText({ path: filePath })
  return result.value
}

interface PdfJsModule {
  getDocument(src: {
    data: Uint8Array
    disableFontFace?: boolean
    isEvalSupported?: boolean
    useWorkerFetch?: boolean
  }): PdfLoadingTask
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>
}

interface PdfDocument {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPage>
  destroy(): Promise<void> | void
}

interface PdfPage {
  getTextContent(): Promise<{ items: unknown[] }>
}

interface PdfTextItem {
  str: string
  hasEOL?: boolean
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof item === 'object'
    && item !== null
    && 'str' in item
    && typeof (item as { str: unknown }).str === 'string'
  )
}

async function extractPdfWithPdfJs(buffer: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as PdfJsModule
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  })
  const pdf = await loadingTask.promise

  try {
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageParts: string[] = []
      for (const item of content.items) {
        if (!isPdfTextItem(item)) continue
        pageParts.push(item.str)
        if (item.hasEOL) pageParts.push('\n')
      }
      pages.push(pageParts.join(' ').replace(/[ \t]+\n/g, '\n').trim())
    }
    return pages.filter(Boolean).join('\n\n')
  } finally {
    await pdf.destroy()
  }
}

/**
 * 从附件相对路径提取文本（IPC 层使用）
 *
 * 将附件的 localPath（如 {conversationId}/{uuid}.ext）
 * 解析为完整路径后提取文本。
 *
 * @param localPath 附件相对路径
 * @returns 提取的纯文本内容
 */
export async function extractTextFromAttachment(localPath: string): Promise<string> {
  const fullPath = resolveAttachmentPath(localPath)
  return extractTextFromFile(fullPath)
}
