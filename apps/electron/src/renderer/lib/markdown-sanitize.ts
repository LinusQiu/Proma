/**
 * Markdown HTML 净化模块
 *
 * 基于 DOMPurify 对 Markdown 渲染产出的 HTML 进行 XSS 净化。
 * 参考业界最佳实践（Obsidian DOMPurify 方案 + VS Code CSP 纵深防御），
 * 采用严格白名单配置：禁止 iframe/object/embed 等危险标签，
 * 禁止任意 data-* 属性（仅允许显式列出的），防止 DOM clobbering。
 *
 * 使用场景：
 * - markdown-rich-text.ts 的 enhanceMarkdownHtml / htmlToMarkdown
 * - markdown-preview-extensions.tsx 的 NodeView 渲染
 *
 * @see HITCON 2023 "Pwning Electron-based Markdown Note-taking Apps"
 */

import DOMPurify from 'dompurify'
import type { Config } from 'dompurify'

/**
 * Markdown 渲染 HTML 净化配置
 *
 * 安全策略：
 * 1. FORBID_TAGS：显式禁止 iframe/object/embed/form 等高危标签
 *    （Obsidian 曾因允许 iframe 导致本地文件泄露）
 * 2. ALLOW_DATA_ATTR: false：禁止任意 data-* 属性，防止 DOM clobbering
 * 3. ADD_ATTR 白名单：只允许明确需要的属性
 */
const MARKDOWN_SANITIZE_CONFIG: Config = {
  // 禁止高危标签（DOMPurify 默认禁止 script/style，此处补充其他危险标签）
  FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button', 'select', 'option'],
  // 禁止事件处理器属性（DOMPurify 默认处理 on* 属性，此处显式确认）
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'oninput', 'onchange'],
  // 关键：不允许任意 data-* 属性（防止 DOM clobbering 和属性注入）
  ALLOW_DATA_ATTR: false,
  // 允许 Markdown 富内容所需的额外标签
  ADD_TAGS: ['video', 'source', 'summary', 'details'],
  // 白名单属性：标准 HTML 属性 + Proma 自定义 data 属性
  ADD_ATTR: [
    // 媒体和交互
    'controls', 'poster', 'open', 'loading', 'autoplay', 'muted', 'loop',
    // 表格
    'align', 'colspan', 'rowspan',
    // 链接
    'target', 'rel',
    // Proma 自定义属性（markdown 渲染管线依赖）
    'data-type', 'data-html', 'data-markdown', 'data-latex',
    'data-checked', 'data-id', 'data-mention-suggestion-char',
  ],
}

/**
 * 净化 Markdown 渲染产出的 HTML
 *
 * 在 innerHTML 赋值前调用，剥离所有危险标签和属性。
 * 保留 math block、task list、details、video 等合法富内容。
 */
export function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, MARKDOWN_SANITIZE_CONFIG) as string
}
