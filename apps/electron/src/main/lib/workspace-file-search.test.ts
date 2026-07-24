import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearWorkspaceFileSearchCacheForTest,
  invalidateWorkspaceFileSearchCache,
  searchWorkspaceFiles,
} from './workspace-file-search'

const testRoots: string[] = []

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'proma-file-mention-search-'))
  testRoots.push(root)
  return root
}

afterEach(() => {
  clearWorkspaceFileSearchCacheForTest()
  for (const root of testRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('workspace file search', () => {
  test('Given a nested matching file When searching Then returns its ancestor directories for tree rendering', async () => {
    const root = createRoot()
    mkdirSync(join(root, 'src', 'components'), { recursive: true })
    writeFileSync(join(root, 'src', 'components', 'MentionPicker.tsx'), '')

    const result = await searchWorkspaceFiles(root, 'picker')

    expect(result.entries.map((entry) => entry.path)).toEqual(['src/components/MentionPicker.tsx'])
    expect(result.sessionEntries.map((entry) => entry.path)).toEqual([
      'src',
      'src/components',
      'src/components/MentionPicker.tsx',
    ])
  })

  test('Given multiple matches When searching Then flat results retain relevance order without tree ancestors', async () => {
    const root = createRoot()
    mkdirSync(join(root, 'alpha'), { recursive: true })
    writeFileSync(join(root, 'z-target.md'), '')
    writeFileSync(join(root, 'target-top.md'), '')
    writeFileSync(join(root, 'alpha', 'target.md'), '')

    const result = await searchWorkspaceFiles(root, 'target')

    expect(result.entries.map((entry) => entry.path)).toEqual([
      'target-top.md',
      'alpha/target.md',
      'z-target.md',
    ])
    expect(result.sessionEntries.map((entry) => entry.path)).toContain('alpha')
  })

  test('Given an attached directory When a query only matches its absolute parent path Then it returns no unrelated files', async () => {
    const root = createRoot()
    const attachedDirectory = join(root, 'attached-project')
    mkdirSync(attachedDirectory, { recursive: true })
    writeFileSync(join(attachedDirectory, 'unrelated.sql'), '')

    const result = await searchWorkspaceFiles(root, 'proma-file-mention-search', 80, [attachedDirectory])

    expect(result.workspaceEntries).toEqual([])
  })

  test('Given a cached index When files change and the watcher invalidates it Then the next search includes the new file', async () => {
    const root = createRoot()
    writeFileSync(join(root, 'existing.md'), '')

    await searchWorkspaceFiles(root, 'existing')
    writeFileSync(join(root, 'new-file.md'), '')

    expect((await searchWorkspaceFiles(root, 'new-file')).sessionEntries).toEqual([])

    invalidateWorkspaceFileSearchCache()

    expect((await searchWorkspaceFiles(root, 'new-file')).sessionEntries.map((entry) => entry.name)).toEqual([
      'new-file.md',
    ])
  })
})
