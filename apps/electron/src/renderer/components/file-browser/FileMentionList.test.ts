import { describe, expect, test } from 'bun:test'
import { buildFileMentionTree, findPreferredMatchIndex } from './FileMentionList'

describe('FileMentionList tree builder', () => {
  test('Given Windows paths When constructing the tree Then links nested files to their directory', () => {
    const tree = buildFileMentionTree([
      { name: 'src', path: 'D:\\project\\src', type: 'dir', source: 'workspace' },
      { name: 'index.ts', path: 'D:\\project\\src\\index.ts', type: 'file', source: 'workspace' },
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]?.name).toBe('src')
    expect(tree[0]?.children.map((node) => node.name)).toEqual(['index.ts'])
  })

  test('Given alphabetically ordered nodes When choosing the default Then preserves search relevance order', () => {
    const nodes = buildFileMentionTree([
      { name: 'alpha.md', path: 'alpha.md', type: 'file', source: 'session' },
      { name: 'target.md', path: 'target.md', type: 'file', source: 'session' },
    ])

    expect(findPreferredMatchIndex(nodes, ['target.md', 'alpha.md'])).toBe(1)
  })
})
