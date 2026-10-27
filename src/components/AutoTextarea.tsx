import { useEffect, useImperativeHandle, useRef, type ComponentProps } from 'react'

type Props = Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> & { value: string; onChange: (v: string) => void }

/** Textarea that grows with its content. */
export function AutoTextarea({ value, onChange, className, ref, ...rest }: Props) {
  const own = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => own.current!)
  useEffect(() => {
    const el = own.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={own}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`block w-full resize-none bg-transparent outline-none placeholder:text-neutral-400 ${className}`}
      {...rest}
    />
  )
}
