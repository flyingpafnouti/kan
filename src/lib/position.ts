const STEP = 1024

/** Position strictly between two neighbours; either may be missing (list edge). */
export function between(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 0
  if (before === undefined) return after! - STEP
  if (after === undefined) return before + STEP
  return (before + after) / 2
}

export const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position
