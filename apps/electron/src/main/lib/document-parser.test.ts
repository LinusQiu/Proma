import { describe, expect, test } from 'bun:test'
import { isSupportedDocumentExtension } from './document-parser'

describe('document-parser', () => {
  test('识别 WPS 和常见 Office 导出格式', () => {
    const supportedExtensions = [
      '.wps', '.wpt',
      '.et', '.ett',
      '.dps', '.dpt',
      '.docm', '.dotx', '.dotm',
      '.xlsm', '.xltx', '.xltm',
      '.pptm', '.potx', '.potm', '.ppsx', '.ppsm',
      '.pdf',
    ]

    for (const ext of supportedExtensions) {
      expect(isSupportedDocumentExtension(ext)).toBe(true)
    }
  })

  test('扩展名判断不区分大小写', () => {
    expect(isSupportedDocumentExtension('.WPS')).toBe(true)
    expect(isSupportedDocumentExtension('.PDF')).toBe(true)
  })
})
