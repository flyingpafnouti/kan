export interface ToastAction {
  label: string
  run: () => void
}

export interface ToastMessage {
  id: number
  msg: string
  action?: ToastAction
  duration: number
}

type Listener = (t: ToastMessage) => void
const listeners = new Set<Listener>()
let nextId = 0

export function toast(msg: string, opts: { action?: ToastAction; duration?: number } = {}) {
  const t = { id: nextId++, msg, action: opts.action, duration: opts.duration ?? 3000 }
  listeners.forEach((l) => l(t))
}

export function onToast(l: Listener) {
  listeners.add(l)
  return () => void listeners.delete(l)
}
