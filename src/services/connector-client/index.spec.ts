import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxNotification } from '@traderalice/connector-protocol'
import {
  MAX_CONNECTOR_ATTACHMENT_BYTES,
  MAX_CONNECTOR_ATTACHMENTS,
} from '@traderalice/connector-protocol'
import { createMemoryInboxStore } from '../../core/inbox-store.js'
import {
  attachInboxConnectorBridge,
  projectInboxAttachments,
  projectInboxDoc,
  toNotification,
} from './index.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('Inbox Connector bridge', () => {
  it('does not make a durable Inbox append wait for external delivery', async () => {
    let rejectDelivery!: (error: Error) => void
    const delivery = new Promise<void>((_resolve, reject) => { rejectDelivery = reject })
    const push = vi.fn(() => delivery)
    const warn = vi.fn()
    const store = createMemoryInboxStore()
    attachInboxConnectorBridge(store, {
      isEnabled: async () => true,
      push,
      warn,
    })

    const entry = await store.append({ workspaceId: 'ws-1', comments: 'done' })
    expect(entry.comments).toBe('done')
    await vi.waitFor(() => expect(push).toHaveBeenCalledOnce())

    rejectDelivery(new Error('external IM offline'))
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('external IM offline'))
  })

  it('projects bounded Inbox provenance without tool logs', () => {
    const notification = toNotification({
      id: 'entry-1',
      ts: 1_700_000_000_000,
      workspaceId: 'ws-1',
      workspaceLabel: 'Research',
      comments: 'Read the report.',
      docs: [{ path: 'research/close.md' }],
      origin: { kind: 'headless', resumeId: 'resume-calm-river-12ab', agent: 'pi' },
    })
    expect(notification).toMatchObject({
      title: 'Inbox update from Research',
      body: 'Read the report.\n\nReports:\n- research/close.md',
      provenance: { resumeId: 'resume-calm-river-12ab', actorLabel: 'pi' },
    })
  })

  it('delivers Markdown docs as bounded file attachments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-attachment-'))
    tempDirs.push(root)
    await mkdir(join(root, 'research'))
    await writeFile(join(root, 'research', 'close.md'), '# Close scan\n')
    const push = vi.fn(async (_notification: InboxNotification) => undefined)
    const store = createMemoryInboxStore()
    attachInboxConnectorBridge(store, {
      isEnabled: async () => true,
      push,
      warn: vi.fn(),
      resolveWorkspace: () => ({ dir: root }),
    })

    await store.append({
      workspaceId: 'ws-1',
      docs: [{ path: 'research/close.md' }],
      comments: 'Attached without flattening the report.',
    })

    await vi.waitFor(() => expect(push).toHaveBeenCalledOnce())
    const notification = push.mock.calls[0]?.[0]
    expect(notification?.attachments).toHaveLength(1)
    expect(notification?.attachments?.[0]).toMatchObject({
      filename: 'close.md',
      mediaType: 'text/markdown; charset=utf-8',
      sizeBytes: Buffer.byteLength('# Close scan\n') + 3,
      source: {
        sizeBytes: Buffer.byteLength('# Close scan\n'),
        contentSha256: createHash('sha256').update('# Close scan\n').digest('hex'),
        detectedEncoding: 'UTF-8',
        detectionConfidence: 100,
      },
    })
    expect(Buffer.from(notification!.attachments![0]!.contentBase64, 'base64').subarray(3).toString('utf8'))
      .toBe('# Close scan\n')
  })

  it('delivers HTML reports as files without flattening their contents into the message', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-html-attachment-'))
    tempDirs.push(root)
    await mkdir(join(root, 'research'))
    const html = '<!doctype html><html><body><h1>Close dashboard</h1></body></html>\n'
    await writeFile(join(root, 'research', 'close.html'), html)
    const push = vi.fn(async (_notification: InboxNotification) => undefined)
    const store = createMemoryInboxStore()
    attachInboxConnectorBridge(store, {
      isEnabled: async () => true,
      push,
      warn: vi.fn(),
      resolveWorkspace: () => ({ dir: root }),
    })

    await store.append({
      workspaceId: 'ws-1',
      docs: [{ path: 'research/close.html' }],
      comments: 'Dashboard attached.',
    })

    await vi.waitFor(() => expect(push).toHaveBeenCalledOnce())
    const notification = push.mock.calls[0]?.[0]
    expect(notification?.body).toBe('Dashboard attached.\n\nReports:\n- research/close.html')
    expect(notification?.body).not.toContain('Close dashboard')
    expect(notification?.attachments?.[0]).toMatchObject({
      filename: 'close.html',
      mediaType: 'text/html; charset=utf-8',
      source: {
        sizeBytes: Buffer.byteLength(html),
        detectedEncoding: 'UTF-8',
        detectionConfidence: 100,
      },
    })
    expect(Buffer.from(notification!.attachments![0]!.contentBase64, 'base64').subarray(3).toString('utf8'))
      .toBe(html)
  })

  it('does not treat the legacy .htm extension as an HTML report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-legacy-htm-'))
    tempDirs.push(root)
    await writeFile(join(root, 'legacy.htm'), '<!doctype html><h1>Legacy</h1>')

    const attachments = await projectInboxAttachments({
      id: 'entry-legacy-htm',
      ts: Date.now(),
      workspaceId: 'ws-1',
      docs: [{ path: 'legacy.htm' }],
    }, () => ({ dir: root }))

    expect(attachments).toEqual([])
  })

  it('warns and preserves source bytes when encoding cannot be normalized safely', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-ambiguous-'))
    tempDirs.push(root)
    const source = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x80, 0x81, 0x82, 0x83])
    await writeFile(join(root, 'ambiguous.md'), source)
    const warn = vi.fn()

    const attachments = await projectInboxAttachments({
      id: 'entry-ambiguous',
      ts: Date.now(),
      workspaceId: 'ws-1',
      docs: [{ path: 'ambiguous.md' }],
    }, () => ({ dir: root }), warn)

    expect(attachments).toHaveLength(1)
    expect(Buffer.from(attachments[0]!.attachment.contentBase64, 'base64')).toEqual(source)
    expect(attachments[0]!.attachment.mediaType).toBe('text/markdown')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('encoding unchanged'))
  })

  it('refuses to attach a Markdown symlink that escapes the Workspace', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-workspace-'))
    const outside = await mkdtemp(join(tmpdir(), 'openalice-connector-outside-'))
    tempDirs.push(root, outside)
    await writeFile(join(outside, 'secret.md'), '# outside\n')
    try {
      await symlink(join(outside, 'secret.md'), join(root, 'leak.md'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') skip('symlinks unavailable on this runner')
      throw error
    }
    const warn = vi.fn()

    const attachments = await projectInboxAttachments({
      id: 'entry-escape',
      ts: Date.now(),
      workspaceId: 'ws-1',
      docs: [{ path: 'leak.md' }],
    }, () => ({ dir: root }), warn)

    expect(attachments).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('symlink target escapes Workspace'))
  })
})

describe('projectInboxDoc', () => {
  const baseEntry = {
    id: 'entry-one',
    ts: Date.now(),
    workspaceId: 'ws-1',
    comments: 'See the report.',
  }

  it('materializes one selected Markdown file through the shared Workspace checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-one-doc-'))
    tempDirs.push(root)
    await mkdir(join(root, 'research'))
    await writeFile(join(root, 'research', 'close.md'), '# Close scan\n')

    const result = await projectInboxDoc({
      ...baseEntry,
      docs: [{ path: 'research/close.md' }, { path: 'research/other.md' }],
    }, 0, () => ({ dir: root }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sourcePath).toBe('research/close.md')
    expect(result.attachment.filename).toBe('close.md')
    expect(result.attachment.mediaType).toBe('text/markdown; charset=utf-8')
  })

  it('refuses a path that escapes the Workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-escape-doc-'))
    tempDirs.push(root)
    const result = await projectInboxDoc({
      ...baseEntry,
      docs: [{ path: '../secret.md' }],
    }, 0, () => ({ dir: root }))
    expect(result).toMatchObject({ ok: false, reason: 'path_escape' })
  })

  it('refuses a symlink that escapes the Workspace', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-doc-workspace-'))
    const outside = await mkdtemp(join(tmpdir(), 'openalice-connector-doc-outside-'))
    tempDirs.push(root, outside)
    await writeFile(join(outside, 'secret.md'), '# outside\n')
    try {
      await symlink(join(outside, 'secret.md'), join(root, 'leak.md'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') skip('symlinks unavailable on this runner')
      throw error
    }
    const result = await projectInboxDoc({
      ...baseEntry,
      docs: [{ path: 'leak.md' }],
    }, 0, () => ({ dir: root }))
    expect(result).toMatchObject({ ok: false, reason: 'path_escape' })
  })

  it('refuses a file above the one-megabyte cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-doc-large-'))
    tempDirs.push(root)
    await writeFile(join(root, 'huge.md'), Buffer.alloc(MAX_CONNECTOR_ATTACHMENT_BYTES + 1, 0x61))
    const result = await projectInboxDoc({
      ...baseEntry,
      docs: [{ path: 'huge.md' }],
    }, 0, () => ({ dir: root }))
    expect(result).toMatchObject({ ok: false, reason: 'file_too_large' })
  })

  it('fails clearly when the selected index is gone', async () => {
    const result = await projectInboxDoc({
      ...baseEntry,
      docs: [{ path: 'research/close.md' }],
    }, 4, () => ({ dir: '/tmp' }))
    expect(result).toMatchObject({ ok: false, reason: 'doc_not_found' })
  })

  it('fails clearly when the live file is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-doc-missing-'))
    tempDirs.push(root)
    const result = await projectInboxDoc({
      ...baseEntry,
      docs: [{ path: 'research/missing.md' }],
    }, 0, () => ({ dir: root }))
    expect(result).toMatchObject({ ok: false, reason: 'file_missing' })
  })

  it('sends original bytes when encoding cannot be identified safely', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-doc-ambiguous-'))
    tempDirs.push(root)
    const source = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x80, 0x81, 0x82, 0x83])
    await writeFile(join(root, 'ambiguous.md'), source)
    const warn = vi.fn()
    const result = await projectInboxDoc({
      ...baseEntry,
      docs: [{ path: 'ambiguous.md' }],
    }, 0, () => ({ dir: root }), warn)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Buffer.from(result.attachment.contentBase64, 'base64')).toEqual(source)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('encoding unchanged'))
  })
})

describe('binary attachment projection', () => {
  it('delivers recognized image and document files with explicit media types and raw bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-binary-'))
    tempDirs.push(root)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02])
    const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    await writeFile(join(root, 'chart.png'), png)
    await writeFile(join(root, 'scan.pdf'), pdf)
    await writeFile(join(root, 'photo.jpg'), jpg)

    const attachments = await projectInboxAttachments({
      id: 'entry-binary',
      ts: Date.now(),
      workspaceId: 'ws-1',
      docs: [{ path: 'chart.png' }, { path: 'scan.pdf' }, { path: 'photo.jpg' }],
    }, () => ({ dir: root }))

    expect(attachments.map((projection) => [projection.sourcePath, projection.attachment.mediaType]))
      .toEqual([
        ['chart.png', 'image/png'],
        ['scan.pdf', 'application/pdf'],
        ['photo.jpg', 'image/jpeg'],
      ])
    expect(Buffer.from(attachments[0]!.attachment.contentBase64, 'base64')).toEqual(png)
    expect(Buffer.from(attachments[1]!.attachment.contentBase64, 'base64')).toEqual(pdf)
    expect(Buffer.from(attachments[2]!.attachment.contentBase64, 'base64')).toEqual(jpg)
  })

  it('delivers plain text files through the encoding-normalized path with a charset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-txt-'))
    tempDirs.push(root)
    await writeFile(join(root, 'notes.txt'), 'hello world\n')

    const attachments = await projectInboxAttachments({
      id: 'entry-txt',
      ts: Date.now(),
      workspaceId: 'ws-1',
      docs: [{ path: 'notes.txt' }],
    }, () => ({ dir: root }))

    expect(attachments).toHaveLength(1)
    expect(attachments[0]!.attachment.mediaType).toBe('text/plain; charset=utf-8')
    expect(Buffer.from(attachments[0]!.attachment.contentBase64, 'base64').subarray(3).toString('utf8'))
      .toBe('hello world\n')
  })

  it('excludes unsupported file extensions from the attachment set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-unsupported-'))
    tempDirs.push(root)
    await writeFile(join(root, 'archive.zip'), Buffer.from([0x50, 0x4b, 0x03, 0x04]))

    const attachments = await projectInboxAttachments({
      id: 'entry-unsupported',
      ts: Date.now(),
      workspaceId: 'ws-1',
      docs: [{ path: 'archive.zip' }],
    }, () => ({ dir: root }))

    expect(attachments).toEqual([])
  })

  it('caps the attachment set at MAX_CONNECTOR_ATTACHMENTS and warns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-cap-'))
    tempDirs.push(root)
    const docs = Array.from({ length: MAX_CONNECTOR_ATTACHMENTS + 1 }, (_, index) => ({
      path: `report-${index}.md`,
    }))
    await Promise.all(docs.map((doc) => writeFile(join(root, doc.path), `# report ${doc.path}\n`)))
    const warn = vi.fn()

    const attachments = await projectInboxAttachments({
      id: 'entry-cap',
      ts: Date.now(),
      workspaceId: 'ws-1',
      docs,
    }, () => ({ dir: root }), warn)

    expect(attachments).toHaveLength(MAX_CONNECTOR_ATTACHMENTS)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('attachment limit'))
  })

  it('skips a binary file above the one-megabyte cap with a warning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-connector-binary-large-'))
    tempDirs.push(root)
    await writeFile(join(root, 'huge.png'), Buffer.alloc(MAX_CONNECTOR_ATTACHMENT_BYTES + 1, 0x00))
    const warn = vi.fn()

    const attachments = await projectInboxAttachments({
      id: 'entry-binary-large',
      ts: Date.now(),
      workspaceId: 'ws-1',
      docs: [{ path: 'huge.png' }],
    }, () => ({ dir: root }), warn)

    expect(attachments).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('file exceeds'))
  })
})
