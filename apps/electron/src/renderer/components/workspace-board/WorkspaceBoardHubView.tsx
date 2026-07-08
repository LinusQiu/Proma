/**
 * WorkspaceBoardHubView — 协作台中控入口
 *
 * 协作台是工作区运行状态入口，内部承载总览、自动任务、Agent 技能和工作笔记。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { AlarmClock, Blocks, BookOpen, LayoutDashboard } from 'lucide-react'
import { workspaceBoardTabAtom, type WorkspaceBoardTab } from '@/atoms/active-view'
import { automationFormAtom } from '@/atoms/automation-atoms'
import { AgentSkillsView } from '@/components/agent-skills/AgentSkillsView'
import { AutomationFormView } from '@/components/automation/AutomationFormView'
import { AutomationsListView } from '@/components/automation/AutomationsListView'
import { ScratchPadView } from '@/components/scratch-pad/ScratchPadView'
import { cn } from '@/lib/utils'

const WORKSPACE_BOARD_TABS: Array<{
  value: WorkspaceBoardTab
  label: string
  icon: React.ReactNode
}> = [
  { value: 'overview', label: '总览', icon: <LayoutDashboard className="size-4" /> },
  { value: 'automations', label: '自动任务', icon: <AlarmClock className="size-4" /> },
  { value: 'skills', label: 'Agent 技能', icon: <Blocks className="size-4" /> },
  { value: 'notes', label: '工作笔记', icon: <BookOpen className="size-4" /> },
]

export function WorkspaceBoardHubView(): React.ReactElement {
  const [tab, setTab] = useAtom(workspaceBoardTabAtom)
  const automationFormOpen = useAtomValue(automationFormAtom).open

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/20">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border/50 bg-background px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="size-5 text-primary" />
            <h1 className="truncate text-base font-semibold">协作台</h1>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            工作区状态、自动化、Agent 能力和人类笔记的中控入口
          </p>
        </div>

        <div className="flex items-center rounded-lg bg-muted p-1">
          {WORKSPACE_BOARD_TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setTab(item.value)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md px-3 text-xs transition-colors',
                tab === item.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'overview' ? (
          <ScratchPadView />
        ) : tab === 'automations' ? (
          automationFormOpen ? <AutomationFormView /> : <AutomationsListView />
        ) : tab === 'skills' ? (
          <AgentSkillsView />
        ) : (
          <ScratchPadView mode="notes" />
        )}
      </div>
    </div>
  )
}
