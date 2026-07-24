import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import type { FileIndexEntry, FileSearchResult } from '@proma/shared'

const INDEX_CACHE_TTL_MS = 5_000
const MAX_SCAN_DEPTH = 10
const MAX_QUERY_RESULTS = 80
const MAX_BROWSE_RESULTS = 120
const MAX_CACHE_ENTRIES = 32

const IGNORE_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', '.next', '__pycache__', '.venv', 'build', '.cache',
])
const IGNORE_FILES = new Set([
  '.DS_Store', '.Spotlight-V100', '.Trashes', 'Thumbs.db', 'desktop.ini',
])

interface IndexedFileEntry extends FileIndexEntry {
  parentPath: string | null
  searchPath: string
}

interface WorkspaceFileIndex {
  sessionEntries: IndexedFileEntry[]
  workspaceEntries: IndexedFileEntry[]
}

interface CacheEntry {
  expiresAt: number
  index?: WorkspaceFileIndex
  pending?: Promise<WorkspaceFileIndex>
}

const indexCache = new Map<string, CacheEntry>()
let cacheGeneration = 0

function normalizeSearchText(value: string): string {
  return value.replace(/\\/g, '/').toLocaleLowerCase()
}

function normalizedPaths(paths?: string[]): string[] {
  return [...new Set((paths ?? []).map((pathValue) => resolve(pathValue)))].sort()
}

function createCacheKey(rootPath: string, additionalPaths?: string[], sessionPaths?: string[]): string {
  return JSON.stringify({
    rootPath: resolve(rootPath),
    additionalPaths: normalizedPaths(additionalPaths),
    sessionPaths: normalizedPaths(sessionPaths),
  })
}

function getParentPath(entryPath: string): string | null {
  const parentPath = dirname(entryPath)
  return parentPath === '.' ? null : parentPath
}

async function scanDirectory(
  directoryPath: string,
  depth: number,
  baseRoot: string,
  target: IndexedFileEntry[],
  useAbsolutePath: boolean,
  source: FileIndexEntry['source'],
): Promise<void> {
  if (depth > MAX_SCAN_DEPTH) return

  try {
    const items = await readdir(directoryPath, { encoding: 'utf8', withFileTypes: true })
    for (const item of items) {
      if (IGNORE_FILES.has(item.name)) continue
      if (item.isDirectory() && IGNORE_DIRECTORIES.has(item.name)) continue

      const fullPath = resolve(directoryPath, item.name)
      const entryPath = useAbsolutePath ? fullPath : relative(baseRoot, fullPath)
      const relativeSearchPath = relative(baseRoot, fullPath)
      target.push({
        name: item.name,
        path: entryPath,
        type: item.isDirectory() ? 'dir' : 'file',
        source,
        parentPath: getParentPath(entryPath),
        // 绝对路径不参与搜索，避免输入盘符或用户目录片段时命中全部附加文件。
        searchPath: useAbsolutePath
          ? `${basename(baseRoot)}/${relativeSearchPath}`
          : relativeSearchPath,
      })

      if (item.isDirectory()) {
        await scanDirectory(fullPath, depth + 1, baseRoot, target, useAbsolutePath, source)
      }
    }
  } catch {
    return
  }
}

async function addAttachedPath(
  pathValue: string,
  target: IndexedFileEntry[],
  source: FileIndexEntry['source'],
): Promise<void> {
  const attachedPath = resolve(pathValue)
  const name = basename(attachedPath)
  if (IGNORE_FILES.has(name) || IGNORE_DIRECTORIES.has(name)) return

  let stats: Awaited<ReturnType<typeof stat>>
  try {
    stats = await stat(attachedPath)
  } catch {
    return
  }

  if (stats.isFile()) {
    target.push({
      name,
      path: attachedPath,
      type: 'file',
      source,
      parentPath: null,
      searchPath: name,
    })
    return
  }
  if (!stats.isDirectory()) return

  target.push({
    name: name === 'workspace-files' ? '工作文件' : name,
    path: attachedPath,
    type: 'dir',
    source,
    parentPath: null,
    searchPath: name,
  })
  await scanDirectory(attachedPath, 0, attachedPath, target, true, source)
}

async function buildIndex(
  rootPath: string,
  additionalPaths?: string[],
  sessionPaths?: string[],
): Promise<WorkspaceFileIndex> {
  const sessionEntries: IndexedFileEntry[] = []
  const workspaceEntries: IndexedFileEntry[] = []
  const safeRoot = resolve(rootPath)

  await scanDirectory(safeRoot, 0, safeRoot, sessionEntries, false, 'session')
  for (const pathValue of normalizedPaths(sessionPaths)) {
    await addAttachedPath(pathValue, sessionEntries, 'session')
  }
  for (const pathValue of normalizedPaths(additionalPaths)) {
    await addAttachedPath(pathValue, workspaceEntries, 'workspace')
  }

  return { sessionEntries, workspaceEntries }
}

function pruneIndexCache(now: number): void {
  for (const [cacheKey, entry] of indexCache) {
    if (!entry.pending && entry.expiresAt <= now) indexCache.delete(cacheKey)
  }
  while (indexCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = indexCache.keys().next().value
    if (!oldestKey) return
    indexCache.delete(oldestKey)
  }
}

async function getIndex(
  rootPath: string,
  additionalPaths?: string[],
  sessionPaths?: string[],
): Promise<WorkspaceFileIndex> {
  const cacheKey = createCacheKey(rootPath, additionalPaths, sessionPaths)
  const now = Date.now()
  pruneIndexCache(now)

  const cached = indexCache.get(cacheKey)
  if (cached?.index && cached.expiresAt > now) return cached.index
  if (cached?.pending) return cached.pending

  const generation = cacheGeneration
  const entry: CacheEntry = { expiresAt: now + INDEX_CACHE_TTL_MS }
  const pending = buildIndex(rootPath, additionalPaths, sessionPaths)
  entry.pending = pending
  indexCache.set(cacheKey, entry)

  try {
    const index = await pending
    // 失效前启动的扫描只能服务于当前请求，不能回填已经失效的缓存。
    if (generation === cacheGeneration && indexCache.get(cacheKey) === entry) {
      indexCache.set(cacheKey, { expiresAt: Date.now() + INDEX_CACHE_TTL_MS, index })
    }
    return index
  } catch (error) {
    if (indexCache.get(cacheKey) === entry) indexCache.delete(cacheKey)
    throw error
  }
}

function fuzzyMatches(value: string, query: string): boolean {
  let queryIndex = 0
  for (let index = 0; index < value.length && queryIndex < query.length; index++) {
    if (value[index] === query[queryIndex]) queryIndex++
  }
  return queryIndex === query.length
}

function matchScore(entry: IndexedFileEntry, query: string): number | null {
  const name = normalizeSearchText(entry.name)
  const searchPath = normalizeSearchText(entry.searchPath)
  if (name.startsWith(query)) return 0
  if (searchPath.startsWith(query)) return 1
  if (name.includes(query)) return 2
  if (searchPath.includes(query)) return 3
  return fuzzyMatches(name, query) ? 4 : null
}

function pathDepth(pathValue: string): number {
  return normalizeSearchText(pathValue).split('/').filter(Boolean).length
}

function sortBrowseEntries(entries: IndexedFileEntry[]): IndexedFileEntry[] {
  return [...entries].sort((a, b) => {
    const depthDifference = pathDepth(a.path) - pathDepth(b.path)
    if (depthDifference !== 0) return depthDifference
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function toPublicEntry(entry: IndexedFileEntry): FileIndexEntry {
  const { parentPath: _parentPath, searchPath: _searchPath, ...publicEntry } = entry
  return publicEntry
}

function includeAncestorEntries(
  entries: IndexedFileEntry[],
  selectedEntries: IndexedFileEntry[],
): FileIndexEntry[] {
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]))
  const includedPaths = new Set<string>()

  for (const entry of selectedEntries) {
    let current: IndexedFileEntry | undefined = entry
    while (current) {
      if (includedPaths.has(current.path)) break
      includedPaths.add(current.path)
      current = current.parentPath ? entriesByPath.get(current.parentPath) : undefined
    }
  }

  return entries
    .filter((entry) => includedPaths.has(entry.path))
    .map(toPublicEntry)
}

interface SearchSelection {
  matchedEntries: FileIndexEntry[]
  treeEntries: FileIndexEntry[]
  total: number
}

function selectEntries(
  entries: IndexedFileEntry[],
  query: string,
  requestedLimit: number,
): SearchSelection {
  const resultLimit = Math.min(
    Math.max(1, requestedLimit),
    query ? MAX_QUERY_RESULTS : MAX_BROWSE_RESULTS,
  )

  if (!query) {
    const selectedEntries = sortBrowseEntries(entries).slice(0, resultLimit)
    return {
      matchedEntries: selectedEntries.map(toPublicEntry),
      treeEntries: includeAncestorEntries(entries, selectedEntries),
      total: entries.length,
    }
  }

  const matchedEntries = entries
    .map((entry) => ({ entry, score: matchScore(entry, query) }))
    .filter((candidate): candidate is { entry: IndexedFileEntry; score: number } => candidate.score !== null)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score
      if (a.entry.type !== b.entry.type) return a.entry.type === 'dir' ? -1 : 1
      const depthDifference = pathDepth(a.entry.path) - pathDepth(b.entry.path)
      if (depthDifference !== 0) return depthDifference
      return a.entry.searchPath.localeCompare(b.entry.searchPath)
    })

  const selectedEntries = matchedEntries.slice(0, resultLimit).map(({ entry }) => entry)
  return {
    matchedEntries: selectedEntries.map(toPublicEntry),
    treeEntries: includeAncestorEntries(entries, selectedEntries),
    total: matchedEntries.length,
  }
}

export async function searchWorkspaceFiles(
  rootPath: string,
  query: string,
  limit = MAX_QUERY_RESULTS,
  additionalPaths?: string[],
  sessionPaths?: string[],
): Promise<FileSearchResult> {
  const index = await getIndex(rootPath, additionalPaths, sessionPaths)
  const normalizedQuery = normalizeSearchText(query.trim())
  const session = selectEntries(index.sessionEntries, normalizedQuery, limit)
  const workspace = selectEntries(index.workspaceEntries, normalizedQuery, limit)

  return {
    // 平铺搜索消费者（侧栏）只接收按相关性排序的真实匹配项。
    entries: [...session.matchedEntries, ...workspace.matchedEntries],
    total: session.total + workspace.total,
    // @ 文件引用需要祖先目录来构建可展开的层级树。
    sessionEntries: session.treeEntries,
    workspaceEntries: workspace.treeEntries,
  }
}

/** 文件 watcher 在防抖后的变更通知中调用。 */
export function invalidateWorkspaceFileSearchCache(): void {
  cacheGeneration++
  indexCache.clear()
}

/** 仅供测试重置缓存。 */
export function clearWorkspaceFileSearchCacheForTest(): void {
  cacheGeneration++
  indexCache.clear()
}
