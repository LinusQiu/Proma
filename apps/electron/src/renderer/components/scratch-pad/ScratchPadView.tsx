/**
 * WorkspaceBoardView — 工作区协作台
 *
 * 协作台使用结构化 JSON 存储在 workspace-files/.context/workspace-board.json。
 * 旧 Scratch Pad 内容仅作为迁移来源，避免用户已有草稿丢失。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import {
  AlertCircle,
  AlarmClock,
  Archive,
  ArrowRight,
  Blocks,
  BookOpen,
  Brain,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  GitPullRequestDraft,
  LayoutDashboard,
  ListTodo,
  Pencil,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react'
import type {
  WorkspaceBoard,
  WorkspaceBoardAutomationLevel,
  WorkspaceBoardBaseItem,
  WorkspaceBoardCandidateKind,
  WorkspaceBoardRecommendation,
  WorkspaceBoardRecommendationKind,
  WorkspaceBoardRecommendationSafetyLevel,
  WorkspaceBoardRecommendationStatus,
  WorkspaceBoardNote,
  WorkspaceBoardSourceRef,
  WorkspaceBoardTodo,
  WorkspaceBoardTodoStatus,
} from '@proma/shared'
import { scratchPadContentAtom, scratchPadLoadedAtom } from '@/atoms/tab-atoms'
import { agentWorkspacesAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { htmlToMarkdown } from '@/lib/markdown-rich-text'
import { cn } from '@/lib/utils'

const TODO_STATUS_LABEL: Record<WorkspaceBoardTodoStatus, string> = {
  pending: '待处理',
  in_progress: '进行中',
  blocked: '阻塞',
  done: '完成',
  cancelled: '取消',
}

const TODO_STATUS_ORDER: WorkspaceBoardTodoStatus[] = ['pending', 'in_progress', 'blocked', 'done', 'cancelled']

const AUTOMATION_LEVEL_LABEL: Record<WorkspaceBoardAutomationLevel, string> = {
  manual: '手动',
  suggest: '建议',
  assistive: '协助',
}

const AUTOMATION_LEVEL_DESCRIPTION: Record<WorkspaceBoardAutomationLevel, string> = {
  manual: 'Agent 只读取协作台，不主动新增条目。',
  suggest: 'Agent 可以写建议和候选项，用户决定是否采纳。',
  assistive: 'Agent 可以维护 Todo、阻塞和建议，但不直接写 Memory 或创建自动任务。',
}

const AUTOMATION_LEVEL_ORDER: WorkspaceBoardAutomationLevel[] = ['manual', 'suggest', 'assistive']

function nowIso(): string {
  return new Date().toISOString()
}

function createBoardId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createEmptyBoard(): WorkspaceBoard {
  return {
    schemaVersion: 1,
    title: '协作台',
    summary: '维护当前工作区正在推进的目标、Todo、阻塞、决策草案和待沉淀候选。',
    automationLevel: 'suggest',
    updatedAt: nowIso(),
    goals: [],
    todos: [],
    blockers: [],
    decisions: [],
    recommendations: [],
    automationRefs: [],
    skillRefs: [],
    knowledgeCandidates: [],
    notes: [],
  }
}

function boardSignature(board: WorkspaceBoard): string {
  return JSON.stringify(board)
}

function isBoardEmpty(board: WorkspaceBoard): boolean {
  return (
    board.goals.length === 0 &&
    board.todos.length === 0 &&
    board.blockers.length === 0 &&
    board.decisions.length === 0 &&
    board.recommendations.length === 0 &&
    board.automationRefs.length === 0 &&
    board.skillRefs.length === 0 &&
    board.knowledgeCandidates.length === 0 &&
    board.notes.length === 0
  )
}

function extractLegacyTodos(markdown: string): WorkspaceBoardTodo[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+\[([ xX])]\s+(.+?)\s*$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => {
      const status: WorkspaceBoardTodoStatus = match[1]?.toLowerCase() === 'x' ? 'done' : 'pending'
      const timestamp = nowIso()
      return {
        id: createBoardId('legacy-todo'),
        title: match[2] ?? '旧草稿 Todo',
        status,
        owner: 'shared',
        source: 'legacy_scratch_pad',
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    })
}

function migrateLegacyScratch(board: WorkspaceBoard, legacyHtml: string): WorkspaceBoard {
  const markdown = htmlToMarkdown(legacyHtml).trim()
  if (!markdown) return board
  const timestamp = nowIso()
  return {
    ...board,
    summary: board.summary ?? '已从旧草稿页迁移内容，请按当前目标和 Todo 继续整理。',
    updatedAt: timestamp,
    todos: [...board.todos, ...extractLegacyTodos(markdown)],
    recommendations: [
      ...board.recommendations,
      {
        id: createBoardId('legacy-recommendation'),
        kind: 'follow_up',
        title: '检查旧草稿迁移内容',
        details: '旧草稿已迁移为工作笔记；建议确认哪些内容需要拆成 Todo、目标或决策。',
        status: 'suggested',
        confidence: 0.8,
        actionLabel: '整理迁移内容',
        safetyLevel: 'writes_board',
        source: 'scratch-pad.md',
        sourceRefs: [{ type: 'file', path: 'scratch-pad.md', title: '旧草稿' }],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    notes: [
      ...board.notes,
      {
        id: createBoardId('legacy-note'),
        kind: 'legacy_scratch_pad',
        title: '旧草稿迁移',
        details: markdown,
        source: 'scratch-pad.md',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  }
}

function normalizeBoardFromJson(raw: string, fallback: WorkspaceBoard): WorkspaceBoard | null {
  try {
    const parsed = JSON.parse(raw) as WorkspaceBoard
    return {
      ...fallback,
      ...parsed,
      schemaVersion: 1,
      automationLevel: parsed.automationLevel === 'manual' || parsed.automationLevel === 'assistive'
        ? parsed.automationLevel
        : 'suggest',
      updatedAt: nowIso(),
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
      todos: Array.isArray(parsed.todos) ? parsed.todos : [],
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      automationRefs: Array.isArray(parsed.automationRefs) ? parsed.automationRefs : [],
      skillRefs: Array.isArray(parsed.skillRefs) ? parsed.skillRefs : [],
      knowledgeCandidates: Array.isArray(parsed.knowledgeCandidates) ? parsed.knowledgeCandidates : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    }
  } catch {
    return null
  }
}

function nextTodoStatus(status: WorkspaceBoardTodoStatus): WorkspaceBoardTodoStatus {
  if (status === 'pending') return 'in_progress'
  if (status === 'in_progress') return 'done'
  if (status === 'blocked') return 'in_progress'
  if (status === 'done') return 'pending'
  return 'pending'
}

function candidateKindLabel(kind: WorkspaceBoardCandidateKind): string {
  if (kind === 'skill') return 'Skill'
  if (kind === 'doc') return '本地文档'
  return 'Memory'
}

function recommendationKindLabel(kind: WorkspaceBoardRecommendationKind): string {
  if (kind === 'create_automation') return '自动任务'
  if (kind === 'create_skill') return 'Skill'
  if (kind === 'promote_memory') return 'Memory'
  if (kind === 'open_agent_session') return 'Agent 会话'
  if (kind === 'review_blocker') return '检查阻塞'
  return '跟进'
}

function recommendationStatusLabel(status: WorkspaceBoardRecommendationStatus): string {
  if (status === 'accepted') return '已采纳'
  if (status === 'dismissed') return '已忽略'
  return '建议'
}

function safetyLevelLabel(level?: WorkspaceBoardRecommendationSafetyLevel): string {
  if (level === 'writes_board') return '更新协作台'
  if (level === 'writes_memory') return '写入 Memory'
  if (level === 'runs_agent') return '启动 Agent'
  if (level === 'creates_automation') return '创建自动任务'
  return '只读'
}

function formatRelativeTime(iso: string): string {
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return ''
  const diffMinutes = Math.max(0, Math.floor((Date.now() - time) / 60000))
  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  return `${Math.floor(diffHours / 24)} 天前`
}

type FocusQueueItemKind = 'blocker' | 'recommendation' | 'todo' | 'goal'

interface FocusQueueItem {
  kind: FocusQueueItemKind
  id: string
  title: string
  details?: string
  badge: string
  tone: 'default' | 'warning' | 'accent'
}

function buildFocusQueue(board: WorkspaceBoard): FocusQueueItem[] {
  const openBlockers = board.blockers
    .filter((blocker) => blocker.status === 'open')
    .map((blocker): FocusQueueItem => ({
      kind: 'blocker',
      id: blocker.id,
      title: blocker.title,
      details: blocker.details,
      badge: '阻塞',
      tone: 'warning',
    }))

  const suggestedRecommendations = board.recommendations
    .filter((recommendation) => recommendation.status === 'suggested')
    .map((recommendation): FocusQueueItem => ({
      kind: 'recommendation',
      id: recommendation.id,
      title: recommendation.title,
      details: recommendation.details,
      badge: recommendationKindLabel(recommendation.kind),
      tone: 'accent',
    }))

  const urgentTodos = board.todos
    .filter((todo) => todo.status === 'in_progress' || todo.status === 'blocked')
    .map((todo): FocusQueueItem => ({
      kind: 'todo',
      id: todo.id,
      title: todo.title,
      details: todo.details,
      badge: TODO_STATUS_LABEL[todo.status],
      tone: todo.status === 'blocked' ? 'warning' : 'default',
    }))

  const pendingTodos = board.todos
    .filter((todo) => todo.status === 'pending')
    .map((todo): FocusQueueItem => ({
      kind: 'todo',
      id: todo.id,
      title: todo.title,
      details: todo.details,
      badge: TODO_STATUS_LABEL[todo.status],
      tone: 'default',
    }))

  const activeGoals = board.goals
    .filter((goal) => goal.status === 'active' || goal.status === 'blocked')
    .map((goal): FocusQueueItem => ({
      kind: 'goal',
      id: goal.id,
      title: goal.title,
      details: goal.details,
      badge: goal.status === 'blocked' ? '目标阻塞' : '当前目标',
      tone: goal.status === 'blocked' ? 'warning' : 'default',
    }))

  return [...openBlockers, ...suggestedRecommendations, ...urgentTodos, ...pendingTodos, ...activeGoals].slice(0, 3)
}

function recommendationPrimaryActionLabel(recommendation: WorkspaceBoardRecommendation): string {
  if (recommendation.kind === 'create_automation') return '加入自动任务候选'
  if (recommendation.kind === 'create_skill') return '加入 Skill 候选'
  if (recommendation.kind === 'promote_memory') return '加入沉淀候选'
  return recommendation.actionLabel || '转成 Todo'
}

function recommendationSourceRefs(recommendation: WorkspaceBoardRecommendation): WorkspaceBoardSourceRef[] {
  return [
    { type: 'board', id: recommendation.id, title: recommendation.title },
    ...(recommendation.sourceRefs ?? []),
  ]
}

function candidateKindFromRecommendation(recommendation: WorkspaceBoardRecommendation): WorkspaceBoardCandidateKind {
  if (recommendation.kind === 'create_skill') return 'skill'
  if (recommendation.kind === 'promote_memory') return 'memory'
  return 'doc'
}

export interface ScratchPadViewProps {
  mode?: 'full' | 'notes'
}

export function ScratchPadView({ mode = 'full' }: ScratchPadViewProps): React.ReactElement {
  const legacyScratchHtml = useAtomValue(scratchPadContentAtom)
  const legacyScratchLoaded = useAtomValue(scratchPadLoadedAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const currentWorkspace = React.useMemo(
    () => workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null,
    [workspaces, currentWorkspaceId],
  )

  const [board, setBoard] = React.useState<WorkspaceBoard>(() => createEmptyBoard())
  const [loaded, setLoaded] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [rawOpen, setRawOpen] = React.useState(false)
  const [rawDraft, setRawDraft] = React.useState('')
  const [rawError, setRawError] = React.useState<string | null>(null)
  const lastSavedRef = React.useRef<string>('')
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout>>()

  React.useEffect(() => {
    const workspaceSlug = currentWorkspace?.slug
    if (!workspaceSlug) {
      setBoard(createEmptyBoard())
      setLoaded(true)
      setError(null)
      lastSavedRef.current = ''
      return
    }

    let cancelled = false
    setLoaded(false)
    setError(null)
    window.electronAPI.readWorkspaceBoard(workspaceSlug)
      .then((loadedBoard) => {
        if (cancelled) return
        let nextBoard = loadedBoard
        lastSavedRef.current = boardSignature(loadedBoard)
        if (legacyScratchLoaded && isBoardEmpty(loadedBoard) && legacyScratchHtml.trim().length > 0) {
          nextBoard = migrateLegacyScratch(loadedBoard, legacyScratchHtml)
        }
        setBoard(nextBoard)
        setRawDraft(JSON.stringify(nextBoard, null, 2))
        setLoaded(true)
      })
      .catch((loadError) => {
        if (cancelled) return
        console.error('[协作台] 加载失败:', loadError)
        setError('协作台加载失败')
        setLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [currentWorkspace?.slug, legacyScratchLoaded, legacyScratchHtml])

  React.useEffect(() => {
    if (!loaded || !currentWorkspace?.slug || error) return
    const signature = boardSignature(board)
    if (signature === lastSavedRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)

    const workspaceSlug = currentWorkspace.slug
    saveTimerRef.current = setTimeout(() => {
      setSaving(true)
      window.electronAPI.writeWorkspaceBoard(workspaceSlug, board)
        .then((savedBoard) => {
          setBoard(savedBoard)
          setRawDraft(JSON.stringify(savedBoard, null, 2))
          lastSavedRef.current = boardSignature(savedBoard)
        })
        .catch((saveError) => {
          console.error('[协作台] 保存失败:', saveError)
          setError('协作台保存失败')
        })
        .finally(() => setSaving(false))
    }, 600)

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [board, loaded, currentWorkspace?.slug, error])

  const activeTodos = React.useMemo(
    () => TODO_STATUS_ORDER.flatMap((status) => board.todos.filter((todo) => todo.status === status)),
    [board.todos],
  )
  const activeGoalCount = board.goals.filter((goal) => goal.status === 'active' || goal.status === 'blocked').length
  const openBlockerCount = board.blockers.filter((blocker) => blocker.status === 'open').length
  const suggestedRecommendationCount = board.recommendations.filter((recommendation) => recommendation.status === 'suggested').length
  const focusQueue = React.useMemo(() => buildFocusQueue(board), [board])

  const updateTodoStatus = React.useCallback((todoId: string, status: WorkspaceBoardTodoStatus) => {
    const timestamp = nowIso()
    setBoard((prev) => ({
      ...prev,
      updatedAt: timestamp,
      todos: prev.todos.map((todo) =>
        todo.id === todoId ? { ...todo, status, updatedAt: timestamp } : todo
      ),
    }))
  }, [])

  const updateRecommendationStatus = React.useCallback((recommendationId: string, status: WorkspaceBoardRecommendationStatus) => {
    const timestamp = nowIso()
    setBoard((prev) => ({
      ...prev,
      updatedAt: timestamp,
      recommendations: prev.recommendations.map((recommendation) =>
        recommendation.id === recommendationId ? { ...recommendation, status, updatedAt: timestamp } : recommendation
      ),
    }))
  }, [])

  const resolveBlocker = React.useCallback((blockerId: string) => {
    const timestamp = nowIso()
    setBoard((prev) => ({
      ...prev,
      updatedAt: timestamp,
      blockers: prev.blockers.map((blocker) =>
        blocker.id === blockerId ? { ...blocker, status: 'resolved', updatedAt: timestamp } : blocker
      ),
    }))
  }, [])

  const convertRecommendationToTodo = React.useCallback((recommendation: WorkspaceBoardRecommendation) => {
    const timestamp = nowIso()
    setBoard((prev) => ({
      ...prev,
      updatedAt: timestamp,
      todos: [
        {
          id: createBoardId('todo'),
          title: recommendation.actionLabel || recommendation.title,
          details: recommendation.details,
          status: 'pending',
          owner: 'shared',
          source: recommendation.source ?? 'Proma 建议',
          sourceRefs: recommendationSourceRefs(recommendation),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        ...prev.todos,
      ],
      recommendations: prev.recommendations.map((item) =>
        item.id === recommendation.id ? { ...item, status: 'accepted', updatedAt: timestamp } : item
      ),
    }))
  }, [])

  const createAutomationRefFromRecommendation = React.useCallback((recommendation: WorkspaceBoardRecommendation) => {
    const timestamp = nowIso()
    setBoard((prev) => ({
      ...prev,
      updatedAt: timestamp,
      automationRefs: [
        {
          id: createBoardId('automation-ref'),
          title: recommendation.actionLabel || recommendation.title,
          details: recommendation.details,
          status: 'suggested',
          trigger: '待设置触发条件',
          source: recommendation.source ?? 'Proma 建议',
          sourceRefs: recommendationSourceRefs(recommendation),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        ...prev.automationRefs,
      ],
      recommendations: prev.recommendations.map((item) =>
        item.id === recommendation.id ? { ...item, status: 'accepted', updatedAt: timestamp } : item
      ),
    }))
  }, [])

  const createSkillRefFromRecommendation = React.useCallback((recommendation: WorkspaceBoardRecommendation) => {
    const timestamp = nowIso()
    setBoard((prev) => ({
      ...prev,
      updatedAt: timestamp,
      skillRefs: [
        {
          id: createBoardId('skill-ref'),
          title: recommendation.actionLabel || recommendation.title,
          details: recommendation.details,
          status: 'suggested',
          source: recommendation.source ?? 'Proma 建议',
          sourceRefs: recommendationSourceRefs(recommendation),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        ...prev.skillRefs,
      ],
      recommendations: prev.recommendations.map((item) =>
        item.id === recommendation.id ? { ...item, status: 'accepted', updatedAt: timestamp } : item
      ),
    }))
  }, [])

  const createKnowledgeCandidateFromRecommendation = React.useCallback((recommendation: WorkspaceBoardRecommendation) => {
    const timestamp = nowIso()
    setBoard((prev) => ({
      ...prev,
      updatedAt: timestamp,
      knowledgeCandidates: [
        {
          id: createBoardId('knowledge-candidate'),
          kind: candidateKindFromRecommendation(recommendation),
          title: recommendation.actionLabel || recommendation.title,
          details: recommendation.details,
          status: 'candidate',
          source: recommendation.source ?? 'Proma 建议',
          sourceRefs: recommendationSourceRefs(recommendation),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        ...prev.knowledgeCandidates,
      ],
      recommendations: prev.recommendations.map((item) =>
        item.id === recommendation.id ? { ...item, status: 'accepted', updatedAt: timestamp } : item
      ),
    }))
  }, [])

  const runRecommendationAction = React.useCallback((recommendation: WorkspaceBoardRecommendation) => {
    if (recommendation.kind === 'create_automation') {
      createAutomationRefFromRecommendation(recommendation)
      return
    }
    if (recommendation.kind === 'create_skill') {
      createSkillRefFromRecommendation(recommendation)
      return
    }
    if (recommendation.kind === 'promote_memory') {
      createKnowledgeCandidateFromRecommendation(recommendation)
      return
    }
    convertRecommendationToTodo(recommendation)
  }, [
    convertRecommendationToTodo,
    createAutomationRefFromRecommendation,
    createKnowledgeCandidateFromRecommendation,
    createSkillRefFromRecommendation,
  ])

  const runRecommendationActionById = React.useCallback((recommendationId: string) => {
    const recommendation = board.recommendations.find((item) => item.id === recommendationId)
    if (!recommendation) return
    runRecommendationAction(recommendation)
  }, [board.recommendations, runRecommendationAction])

  const updateAutomationLevel = React.useCallback((automationLevel: WorkspaceBoardAutomationLevel) => {
    const timestamp = nowIso()
    setBoard((prev) => ({
      ...prev,
      automationLevel,
      updatedAt: timestamp,
    }))
  }, [])

  const addTodo = React.useCallback(() => {
    const timestamp = nowIso()
    setBoard((prev) => ({
      ...prev,
      updatedAt: timestamp,
      todos: [
        {
          id: createBoardId('todo'),
          title: '新的待办事项',
          status: 'pending',
          owner: 'shared',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        ...prev.todos,
      ],
    }))
  }, [])

  const addNote = React.useCallback(() => {
    const timestamp = nowIso()
    setBoard((prev) => ({
      ...prev,
      updatedAt: timestamp,
      notes: [
        {
          id: createBoardId('note'),
          kind: 'note',
          title: '新的工作笔记',
          details: '',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        ...prev.notes,
      ],
    }))
  }, [])

  const updateNote = React.useCallback((noteId: string, patch: Partial<Pick<WorkspaceBoardNote, 'title' | 'details'>>) => {
    setBoard((prev) => ({
      ...prev,
      updatedAt: nowIso(),
      notes: prev.notes.map((note) =>
        note.id === noteId ? { ...note, ...patch, updatedAt: nowIso() } : note
      ),
    }))
  }, [])

  const applyRawDraft = React.useCallback(() => {
    const parsed = normalizeBoardFromJson(rawDraft, board)
    if (!parsed) {
      setRawError('JSON 格式无效')
      return
    }
    setRawError(null)
    setBoard(parsed)
  }, [rawDraft, board])

  const notesOnly = mode === 'notes'

  if (!currentWorkspace) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/20 px-6">
        <div className="max-w-md rounded-lg bg-background p-6 text-center shadow-sm">
          <LayoutDashboard className="mx-auto mb-3 size-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold">协作台</h1>
          <p className="mt-2 text-sm text-muted-foreground">请选择 Agent 工作区后使用协作台。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/20">
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-4">
          {!notesOnly && (
          <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-background px-4 py-3 shadow-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <LayoutDashboard className="size-5 text-primary" />
                <h1 className="truncate text-base font-semibold tracking-normal">{board.title || '协作台'}</h1>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {board.summary || '工作区级结构化状态，供人和 Agent 跨会话协作。'}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <AutomationLevelControl
                value={board.automationLevel ?? 'suggest'}
                onChange={updateAutomationLevel}
              />
              <span className="text-xs text-muted-foreground">
                {saving ? '保存中' : loaded ? `已保存 · ${formatRelativeTime(board.updatedAt)}` : '加载中'}
              </span>
              <Button variant="outline" size="sm" onClick={() => setRawOpen((open) => !open)}>
                <Pencil className="size-3.5" />
                Schema
              </Button>
            </div>
          </header>
          )}

          {!notesOnly && (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <MetricCard icon={<Sparkles className="size-4" />} label="活跃目标" value={activeGoalCount} />
            <MetricCard icon={<ListTodo className="size-4" />} label="待办队列" value={activeTodos.length} />
            <MetricCard icon={<ShieldAlert className="size-4" />} label="开放阻塞" value={openBlockerCount} tone={openBlockerCount > 0 ? 'warning' : 'default'} />
            <MetricCard icon={<Brain className="size-4" />} label="主动建议" value={suggestedRecommendationCount} tone={suggestedRecommendationCount > 0 ? 'accent' : 'default'} />
          </div>
          )}

          {!notesOnly && (
          <FocusQueueSection
            items={focusQueue}
            onResolveBlocker={resolveBlocker}
            onCycleTodoStatus={(todoId) => {
              const todo = board.todos.find((item) => item.id === todoId)
              if (!todo) return
              updateTodoStatus(todo.id, nextTodoStatus(todo.status))
            }}
            onRunRecommendation={runRecommendationActionById}
            onAddTodo={addTodo}
          />
          )}

          {!notesOnly && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <main className="grid min-w-0 auto-rows-min gap-4">
              <BoardSection
                title="Todo 队列"
                icon={<ListTodo className="size-4" />}
                emptyText="还没有 Todo"
                empty={activeTodos.length === 0}
                action={<Button variant="secondary" size="sm" onClick={addTodo}>新增 Todo</Button>}
              >
                <div className="grid gap-2">
                  {activeTodos.map((todo) => (
                    <TodoRow
                      key={todo.id}
                      todo={todo}
                      onCycleStatus={() => updateTodoStatus(todo.id, nextTodoStatus(todo.status))}
                      onStatusChange={(status) => updateTodoStatus(todo.id, status)}
                    />
                  ))}
                </div>
              </BoardSection>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <BoardSection title="当前目标" icon={<Target className="size-4" />} emptyText="还没有当前目标" empty={board.goals.length === 0}>
                  <div className="grid gap-2">
                    {board.goals.map((goal) => (
                      <BoardItemCard key={goal.id} item={goal} badge={goal.status} />
                    ))}
                  </div>
                </BoardSection>

                <BoardSection title="阻塞与待确认" icon={<AlertCircle className="size-4" />} emptyText="暂无阻塞" empty={board.blockers.length === 0}>
                  <div className="grid gap-2">
                    {board.blockers.map((blocker) => (
                      <BoardItemCard key={blocker.id} item={blocker} badge={blocker.status === 'open' ? '待处理' : '已解决'} />
                    ))}
                  </div>
                </BoardSection>
              </div>

              <BoardSection title="决策记录" icon={<GitPullRequestDraft className="size-4" />} emptyText="暂无决策记录" empty={board.decisions.length === 0}>
                <div className="grid gap-2">
                  {board.decisions.map((decision) => (
                    <BoardItemCard key={decision.id} item={decision} badge={decision.status} />
                  ))}
                </div>
              </BoardSection>
            </main>

            <aside className="grid auto-rows-min gap-4">
              <BoardSection title="Proma 建议" icon={<Brain className="size-4" />} emptyText="暂无主动建议" empty={board.recommendations.length === 0}>
                <div className="grid gap-2">
                  {board.recommendations.map((recommendation) => (
                    <RecommendationCard
                      key={recommendation.id}
                      recommendation={recommendation}
                      onPrimaryAction={() => runRecommendationAction(recommendation)}
                      onDismiss={() => updateRecommendationStatus(recommendation.id, 'dismissed')}
                    />
                  ))}
                </div>
              </BoardSection>

              <BoardSection title="可沉淀候选" icon={<Archive className="size-4" />} emptyText="暂无候选" empty={board.knowledgeCandidates.length === 0}>
                <div className="grid gap-2">
                  {board.knowledgeCandidates.map((candidate) => (
                    <BoardItemCard
                      key={candidate.id}
                      item={candidate}
                      badge={`${candidateKindLabel(candidate.kind)} · ${candidate.status}`}
                    />
                  ))}
                </div>
              </BoardSection>

              <BoardSection title="自动任务引用" icon={<AlarmClock className="size-4" />} emptyText="暂无引用" empty={board.automationRefs.length === 0}>
                <div className="grid gap-2">
                  {board.automationRefs.map((automationRef) => (
                    <BoardItemCard
                      key={automationRef.id}
                      item={automationRef}
                      badge={automationRef.trigger ? `${automationRef.status} · ${automationRef.trigger}` : automationRef.status}
                    />
                  ))}
                </div>
              </BoardSection>

              <BoardSection title="Agent 技能引用" icon={<Blocks className="size-4" />} emptyText="暂无引用" empty={board.skillRefs.length === 0}>
                <div className="grid gap-2">
                  {board.skillRefs.map((skillRef) => (
                    <BoardItemCard
                      key={skillRef.id}
                      item={skillRef}
                      badge={skillRef.skillSlug ? `${skillRef.status} · ${skillRef.skillSlug}` : skillRef.status}
                    />
                  ))}
                </div>
              </BoardSection>

            </aside>
          </div>
          )}

          <BoardSection
            title="工作笔记"
            icon={<BookOpen className="size-4" />}
            emptyText="暂无笔记"
            empty={board.notes.length === 0}
            action={<Button variant="secondary" size="sm" onClick={addNote}>新增笔记</Button>}
            className="min-h-[360px] flex-1"
            contentClassName="min-h-[280px]"
          >
            <div className="grid min-h-[280px] gap-3">
              {board.notes.map((note) => (
                <WorkNoteCard
                  key={note.id}
                  note={note}
                  onTitleChange={(title) => updateNote(note.id, { title })}
                  onDetailsChange={(details) => updateNote(note.id, { details })}
                />
              ))}
            </div>
          </BoardSection>
        </div>
      </div>

      {rawOpen && (
        <div className="border-t border-border/50 bg-background p-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">协作台 Schema</h2>
              <p className="text-xs text-muted-foreground">Agent 可直接维护这个 JSON；保存时主进程会归一化 schema。</p>
            </div>
            <Button variant="default" size="sm" onClick={applyRawDraft}>应用 JSON</Button>
          </div>
          {rawError && <p className="mb-2 text-xs text-destructive">{rawError}</p>}
          <Textarea
            value={rawDraft}
            onChange={(event) => setRawDraft(event.target.value)}
            className="h-64 resize-none font-mono text-xs"
            spellCheck={false}
          />
        </div>
      )}

      {error && (
        <div className="border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  )
}

function AutomationLevelControl({
  value,
  onChange,
}: {
  value: WorkspaceBoardAutomationLevel
  onChange: (value: WorkspaceBoardAutomationLevel) => void
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/50 p-1" title={AUTOMATION_LEVEL_DESCRIPTION[value]}>
      <span className="px-1 text-[10px] text-muted-foreground">自动化</span>
      {AUTOMATION_LEVEL_ORDER.map((level) => (
        <button
          key={level}
          type="button"
          onClick={() => onChange(level)}
          className={cn(
            'h-7 rounded px-2 text-xs text-muted-foreground transition-colors',
            value === level && 'bg-background text-foreground shadow-sm',
          )}
          title={AUTOMATION_LEVEL_DESCRIPTION[level]}
        >
          {AUTOMATION_LEVEL_LABEL[level]}
        </button>
      ))}
    </div>
  )
}

function FocusQueueSection({
  items,
  onResolveBlocker,
  onCycleTodoStatus,
  onRunRecommendation,
  onAddTodo,
}: {
  items: FocusQueueItem[]
  onResolveBlocker: (blockerId: string) => void
  onCycleTodoStatus: (todoId: string) => void
  onRunRecommendation: (recommendationId: string) => void
  onAddTodo: () => void
}): React.ReactElement {
  return (
    <section className="rounded-lg bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-primary"><Sparkles className="size-4" /></span>
          当前焦点
        </div>
        <Button variant="secondary" size="sm" onClick={onAddTodo}>
          新增 Todo
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-md bg-muted/50 px-4 py-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="size-4 text-primary" />
            现在没有必须立刻处理的焦点
          </div>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">
            你可以直接写工作笔记；Agent 在会话结束、遇到阻塞、发现重复流程或需要沉淀经验时，会把下一步建议写到这里，由你决定是否采纳。
          </p>
        </div>
      ) : (
        <div className="grid gap-2 lg:grid-cols-3">
          {items.map((item) => (
            <article
              key={`${item.kind}-${item.id}`}
              className={cn(
                'grid min-h-[128px] grid-rows-[auto_1fr_auto] rounded-md bg-muted/35 p-3',
                item.tone === 'warning' && 'bg-amber-500/10',
                item.tone === 'accent' && 'bg-primary/10',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-md bg-background px-2 py-1 text-[10px] text-muted-foreground shadow-sm">
                  {item.badge}
                </span>
                {item.kind === 'blocker' && <AlertCircle className="size-4 text-amber-600 dark:text-amber-300" />}
                {item.kind === 'recommendation' && <Brain className="size-4 text-primary" />}
                {item.kind === 'todo' && <ListTodo className="size-4 text-muted-foreground" />}
                {item.kind === 'goal' && <Target className="size-4 text-muted-foreground" />}
              </div>

              <div className="mt-3 min-w-0">
                <h3 className="line-clamp-2 text-sm font-medium leading-5">{item.title}</h3>
                {item.details && (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {item.details}
                  </p>
                )}
              </div>

              <div className="mt-3">
                {item.kind === 'blocker' && (
                  <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" onClick={() => onResolveBlocker(item.id)}>
                    标记解决
                  </Button>
                )}
                {item.kind === 'recommendation' && (
                  <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" onClick={() => onRunRecommendation(item.id)}>
                    处理建议
                    <ArrowRight className="size-3" />
                  </Button>
                )}
                {item.kind === 'todo' && (
                  <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" onClick={() => onCycleTodoStatus(item.id)}>
                    推进状态
                  </Button>
                )}
                {item.kind === 'goal' && (
                  <span className="text-[10px] text-muted-foreground">
                    目标会由 Todo、阻塞和建议继续拆解
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function MetricCard({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode
  label: string
  value: number
  tone?: 'default' | 'warning' | 'accent'
}): React.ReactElement {
  return (
    <div className={cn(
      'rounded-lg bg-background p-4 shadow-sm',
      tone === 'warning' && 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
      tone === 'accent' && 'bg-primary/10 text-primary',
    )}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function BoardSection({
  title,
  icon,
  emptyText,
  empty,
  action,
  className,
  contentClassName,
  children,
}: {
  title: string
  icon: React.ReactNode
  emptyText: string
  empty: boolean
  action?: React.ReactNode
  className?: string
  contentClassName?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className={cn('rounded-lg bg-background p-4 shadow-sm', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </div>
        {action}
      </div>
      {empty ? (
        <div className={cn('rounded-md bg-muted/50 px-3 py-6 text-center text-xs text-muted-foreground', contentClassName)}>{emptyText}</div>
      ) : (
        <div className={contentClassName}>{children}</div>
      )}
    </section>
  )
}

function RecommendationCard({
  recommendation,
  onPrimaryAction,
  onDismiss,
}: {
  recommendation: WorkspaceBoardRecommendation
  onPrimaryAction: () => void
  onDismiss: () => void
}): React.ReactElement {
  const inactive = recommendation.status !== 'suggested'
  const confidence = typeof recommendation.confidence === 'number'
    ? `${Math.round(recommendation.confidence * 100)}%`
    : null

  return (
    <article className={cn('rounded-md bg-muted/35 p-3', inactive && 'opacity-70')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-background px-2 py-1 text-[10px] text-primary shadow-sm">
              {recommendationKindLabel(recommendation.kind)}
            </span>
            <span className="rounded-md bg-background px-2 py-1 text-[10px] text-muted-foreground shadow-sm">
              {recommendationStatusLabel(recommendation.status)}
            </span>
          </div>
          <h3 className="mt-2 text-sm font-medium leading-5">{recommendation.title}</h3>
          {recommendation.details && (
            <p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
              {recommendation.details}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground/80">
        <span>{safetyLevelLabel(recommendation.safetyLevel)}</span>
        {confidence && <span>置信度 {confidence}</span>}
        {recommendation.sourceRefs?.slice(0, 2).map((ref) => (
          <span key={`${ref.type}-${ref.id ?? ref.path ?? ref.title}`} className="truncate">
            {ref.title ?? ref.path ?? ref.id ?? ref.type}
          </span>
        ))}
      </div>

      {recommendation.status === 'suggested' && (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" onClick={onPrimaryAction}>
            {recommendationPrimaryActionLabel(recommendation)}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onDismiss}>
            忽略
          </Button>
        </div>
      )}
    </article>
  )
}

function BoardItemCard({ item, badge }: { item: WorkspaceBoardBaseItem; badge: string }): React.ReactElement {
  return (
    <article className="rounded-md bg-muted/35 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{item.title}</h3>
          {item.details && <p className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{item.details}</p>}
        </div>
        <span className="shrink-0 rounded-md bg-background px-2 py-1 text-[10px] text-muted-foreground shadow-sm">{badge}</span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground/70">
        <Clock3 className="size-3" />
        {formatRelativeTime(item.updatedAt)}
        {item.source && (
          <>
            <FileText className="size-3" />
            {item.source}
          </>
        )}
      </div>
    </article>
  )
}

function WorkNoteCard({
  note,
  onTitleChange,
  onDetailsChange,
}: {
  note: WorkspaceBoardNote
  onTitleChange: (title: string) => void
  onDetailsChange: (details: string) => void
}): React.ReactElement {
  const badge = note.kind === 'legacy_scratch_pad' ? '旧草稿' : note.kind

  return (
    <article className="grid min-h-[220px] grid-rows-[auto_minmax(160px,1fr)_auto] rounded-md bg-muted/35 p-3">
      <div className="flex items-center gap-2">
        <input
          value={note.title}
          onChange={(event) => onTitleChange(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium outline-none hover:border-border/60 focus:border-primary/60 focus:bg-background"
        />
        <span className="shrink-0 rounded-md bg-background px-2 py-1 text-[10px] text-muted-foreground shadow-sm">{badge}</span>
      </div>
      <Textarea
        value={note.details ?? ''}
        onChange={(event) => onDetailsChange(event.target.value)}
        placeholder="记录给人看的上下文、草稿、复盘或临时想法。Agent 可以读取，但这里不自动沉淀为 Memory 或 Skill。"
        className="mt-2 min-h-[160px] resize-y border-border/40 bg-background/70 text-sm leading-6"
      />
      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground/70">
        <Clock3 className="size-3" />
        {formatRelativeTime(note.updatedAt)}
        {note.source && (
          <>
            <FileText className="size-3" />
            {note.source}
          </>
        )}
      </div>
    </article>
  )
}

function TodoRow({
  todo,
  onCycleStatus,
  onStatusChange,
}: {
  todo: WorkspaceBoardTodo
  onCycleStatus: () => void
  onStatusChange: (status: WorkspaceBoardTodoStatus) => void
}): React.ReactElement {
  const done = todo.status === 'done'
  return (
    <article className="grid grid-cols-[auto_minmax(0,1fr)_128px] items-center gap-3 rounded-md bg-muted/35 p-3">
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
        onClick={onCycleStatus}
        title="切换状态"
      >
        {done ? <CheckCircle2 className="size-4 text-primary" /> : <Circle className="size-4" />}
      </button>
      <div className="min-w-0">
        <h3 className={cn('truncate text-sm font-medium', done && 'text-muted-foreground line-through')}>{todo.title}</h3>
        {todo.details && <p className="mt-1 truncate text-xs text-muted-foreground">{todo.details}</p>}
      </div>
      <select
        value={todo.status}
        onChange={(event) => onStatusChange(event.target.value as WorkspaceBoardTodoStatus)}
        className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs"
      >
        {TODO_STATUS_ORDER.map((status) => (
          <option key={status} value={status}>{TODO_STATUS_LABEL[status]}</option>
        ))}
      </select>
    </article>
  )
}
