import type { QuotedSelection } from '@/atoms/preview-atoms'

export function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function sanitizeQuotedText(value: string): string {
  return value
    .replace(/<\/quoted_file>/gi, '</quoted_file_>')
    .replace(/<\/quoted_context>/gi, '</quoted_context_>')
}

export function buildQuotedSelectionBlock(quotedSelection: QuotedSelection): string {
  const safeText = sanitizeQuotedText(quotedSelection.text)

  if (quotedSelection.sourceType && quotedSelection.sourceType !== 'file') {
    const safeSource = escapeXmlAttribute(quotedSelection.sourceType)
    const safeLabel = escapeXmlAttribute(quotedSelection.sourceLabel ?? quotedSelection.filePath)
    const safeMessageId = escapeXmlAttribute(quotedSelection.messageId ?? '')
    const safeRole = escapeXmlAttribute(quotedSelection.messageRole ?? '')
    return `<quoted_context source="${safeSource}" label="${safeLabel}" message_id="${safeMessageId}" role="${safeRole}">\n${safeText}\n</quoted_context>\n\n`
  }

  const safePath = escapeXmlAttribute(quotedSelection.filePath)
  return `<quoted_file path="${safePath}">\n${safeText}\n</quoted_file>\n\n`
}
