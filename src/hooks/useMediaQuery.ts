import { useEffect, useState } from 'react'

export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const onChange = () => setMatch(mq.matches)
    mq.addEventListener('change', onChange)
    onChange()
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return match
}
