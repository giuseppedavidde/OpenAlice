import { describe, expect, it } from 'vitest'
import { attachmentMediaTypeForPath } from './attachment-types.js'

describe('attachmentMediaTypeForPath', () => {
  it.each([
    ['report.md', { kind: 'text', mediaType: 'text/markdown' }],
    ['report.markdown', { kind: 'text', mediaType: 'text/markdown' }],
    ['report.html', { kind: 'text', mediaType: 'text/html' }],
    ['notes.txt', { kind: 'text', mediaType: 'text/plain' }],
  ] as const)('maps %s to the text normalization path', (path, expected) => {
    expect(attachmentMediaTypeForPath(path)).toEqual(expected)
  })

  it.each([
    ['photo.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['photo.webp', 'image/webp'],
    ['photo.gif', 'image/gif'],
    ['diagram.svg', 'image/svg+xml'],
    ['scan.pdf', 'application/pdf'],
    ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['report.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['data.csv', 'text/csv'],
    ['data.json', 'application/json'],
  ] as const)('maps %s to the %s binary path', (path, mediaType) => {
    expect(attachmentMediaTypeForPath(path)).toEqual({ kind: 'binary', mediaType })
  })

  it('is case-insensitive about the extension', () => {
    expect(attachmentMediaTypeForPath('PHOTO.PNG')).toEqual({ kind: 'binary', mediaType: 'image/png' })
    expect(attachmentMediaTypeForPath('REPORT.MD')).toEqual({ kind: 'text', mediaType: 'text/markdown' })
  })

  it('leaves the legacy .htm extension unsupported', () => {
    expect(attachmentMediaTypeForPath('legacy.htm')).toBeUndefined()
  })

  it.each(['archive.zip', 'notes.rtf', 'Makefile', 'noextension'])(
    'leaves unsupported path %s excluded',
    (path) => {
      expect(attachmentMediaTypeForPath(path)).toBeUndefined()
    },
  )
})
