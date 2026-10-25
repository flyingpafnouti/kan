type Listener = (msg: string) => void
const listeners = new Set<Listener>()

export function toast(msg: string) {
  listeners.forEach((l) => l(msg))
}

export function onToast(l: Listener) {
  listeners.add(l)
  return () => void listeners.delete(l)
}
