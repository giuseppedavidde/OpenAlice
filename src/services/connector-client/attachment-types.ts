import { extname } from 'node:path'
import type { ConnectorTextMediaType } from './text-attachment.js'

/**
 * How an Inbox doc is externalized. `text` kinds run through encoding
 * normalization (`normalizeConnectorTextAttachment`) and gain a
 * `; charset=utf-8` media type; `binary` kinds cross the process boundary as
 * their original bytes under an explicit media type, with no encoding guess.
 */
export type ConnectorAttachmentKind = 'text' | 'binary'

export type ConnectorAttachmentMediaType =
  | { kind: 'text'; mediaType: ConnectorTextMediaType }
  | { kind: 'binary'; mediaType: string }

/**
 * Text kinds are human-authored reports where a locale-sensitive mobile viewer
 * may otherwise guess a legacy charset. Only these run through chardet/BOM
 * normalization. `.htm` is deliberately excluded: legacy `.htm` files are
 * ambiguous and were already rejected by the original Markdown/HTML filter.
 */
const TEXT_MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, ConnectorTextMediaType>> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.html': 'text/html',
  '.txt': 'text/plain',
}

/**
 * Binary kinds are sent as raw bytes under their recognized media type. JSON
 * and CSV stay on this path (not the text normalization path) so a UTF-8 BOM
 * is never prepended to machine-read data that some parsers reject.
 *
 * `.svg` is XML text on disk, but it is externalized here as `image/svg+xml`
 * binary: its encoding is already declared by the XML declaration and it must
 * not be chardet-rewritten or BOM-stripped. Treating it as text would also
 * force it into the `ConnectorTextMediaType` union, which exists only for
 * report encodings.
 */
const BINARY_MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.json': 'application/json',
}

/**
 * Resolve the externalization plan for one Workspace path, or `undefined` when
 * the extension is unsupported. Unsupported files stay in the Inbox's textual
 * report list and are never attached.
 */
export function attachmentMediaTypeForPath(path: string): ConnectorAttachmentMediaType | undefined {
  const extension = extname(path).toLowerCase()
  const text = TEXT_MEDIA_TYPE_BY_EXTENSION[extension]
  if (text) return { kind: 'text', mediaType: text }
  const binary = BINARY_MEDIA_TYPE_BY_EXTENSION[extension]
  if (binary) return { kind: 'binary', mediaType: binary }
  return undefined
}
