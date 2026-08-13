export interface PartialMessageCoalescer<T> {
  schedule: (value: T) => void
  flush: () => void
  dispose: () => void
}

/**
 * 只保留一个时间窗口内最新的流式快照；flush 用于保证最终消息前不遗漏最后一帧。
 */
export function createPartialMessageCoalescer<T>(
  emit: (value: T) => void,
  intervalMs: number | (() => number),
): PartialMessageCoalescer<T> {
  let pending: T | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastEmittedAt = 0
  let disposed = false

  const emitPending = (): void => {
    timer = undefined
    if (disposed || pending === undefined) return
    const next = pending
    pending = undefined
    lastEmittedAt = Date.now()
    emit(next)
  }

  return {
    schedule(value) {
      if (disposed) return
      pending = value
      if (timer) return
      const elapsed = Date.now() - lastEmittedAt
      // 协作子会话可在用户打开时恢复前台频率；每次排程读取最新优先级。
      const resolvedInterval = typeof intervalMs === 'function' ? intervalMs() : intervalMs
      timer = setTimeout(emitPending, Math.max(0, resolvedInterval - elapsed))
    },
    flush() {
      if (timer) clearTimeout(timer)
      timer = undefined
      emitPending()
    },
    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
      timer = undefined
      pending = undefined
    },
  }
}
