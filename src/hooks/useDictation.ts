import { useEffect, useRef, useState } from 'react'
import { MissingKeyError, getGroqKey, setGroqKey, transcribe } from '../lib/transcribe'
import { toast } from '../lib/toast'

export type DictationState = 'idle' | 'starting' | 'recording' | 'transcribing'

/** Needs a secure context: absent over plain http (LAN dev server), so the button stays hidden there. */
export const dictationSupported =
  typeof MediaRecorder !== 'undefined' && Boolean(globalThis.navigator?.mediaDevices?.getUserMedia)

// Chrome records webm/opus, Safari only mp4/aac.
const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) =>
  typeof MediaRecorder !== 'undefined' ? MediaRecorder.isTypeSupported(t) : false,
)

export async function askKey() {
  const key = prompt('Groq API key (console.groq.com/keys), saved to your account:')?.trim()
  if (!key) return false
  try {
    await setGroqKey(key)
    return true
  } catch {
    toast('Could not save the key (offline?)')
    return false
  }
}

/**
 * Calls onLevel every frame with the input loudness in [0, 1]: RMS in dB, -60 dB → 0 and -10 dB → 1,
 * rising at once and falling slowly so the bar does not flicker between syllables.
 */
function watchLevel(ctx: AudioContext, stream: MediaStream, onLevel: (level: number) => void) {
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  ctx.createMediaStreamSource(stream).connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  let shown = 0
  let frame = requestAnimationFrame(function tick() {
    analyser.getFloatTimeDomainData(samples)
    let sum = 0
    for (const x of samples) sum += x * x
    const db = 10 * Math.log10(sum / samples.length + 1e-10)
    shown = Math.max(Math.min(1, Math.max(0, (db + 60) / 50)), shown * 0.9)
    onLevel(shown)
    frame = requestAnimationFrame(tick)
  })
  return () => {
    cancelAnimationFrame(frame)
    void ctx.close()
  }
}

/**
 * Tap to record, tap again to stop: the transcript goes to onText.
 * While recording, the element behind `meter` is scaled horizontally with the input loudness.
 */
export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>('idle')
  const recorder = useRef<MediaRecorder | null>(null)
  const cancelled = useRef(false)
  const meter = useRef<HTMLDivElement>(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  // Releases the microphone and drops the audio if the component goes away mid-recording.
  useEffect(() => cancel, [])

  async function start(ctx: AudioContext) {
    // 'starting' covers the key prompt and the permission dialog, which both steal focus from the field.
    setState('starting')
    cancelled.current = false
    const abort = () => {
      void ctx.close()
      setState('idle')
    }
    if (!(await getGroqKey()) && !(await askKey())) return abort()
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      toast('Microphone unavailable')
      return abort()
    }
    // Closed while the permission dialog was up.
    if (cancelled.current) {
      stream.getTracks().forEach((t) => t.stop())
      return abort()
    }
    void ctx.resume()
    const stopLevel = watchLevel(ctx, stream, (level) => {
      // Overrides the `scale` property set by Tailwind's scale-x-0 (a transform would multiply with it and stay at 0).
      if (meter.current) meter.current.style.scale = `${level} 1`
    })
    const rec = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = async () => {
      stopLevel()
      stream.getTracks().forEach((t) => t.stop())
      recorder.current = null
      if (cancelled.current) return setState('idle')
      setState('transcribing')
      try {
        const text = await transcribe(new Blob(chunks, { type: rec.mimeType }))
        if (text) onTextRef.current(text)
      } catch (e) {
        if (e instanceof MissingKeyError) {
          await setGroqKey(null).catch(() => {})
          toast('Groq key rejected, it will be asked again')
        } else toast(navigator.onLine ? 'Transcription failed' : 'Transcription unavailable offline')
      } finally {
        setState('idle')
      }
    }
    recorder.current = rec
    rec.start()
    setState('recording')
  }

  function toggle() {
    if (state === 'recording') recorder.current?.stop()
    // Created within the tap: Safari keeps an AudioContext made after the awaits suspended.
    else if (state === 'idle') void start(new AudioContext())
  }

  /** Stops recording and drops the audio. */
  function cancel() {
    cancelled.current = true
    recorder.current?.stop()
  }

  return { state, toggle, cancel, meter }
}
