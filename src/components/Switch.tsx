/** Small two-way switch, discreet enough to sit beside a note. */
export function Switch<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-lg bg-neutral-100 p-0.5 text-xs dark:bg-neutral-800">
      {options.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`rounded-md px-2 py-0.5 font-medium transition ${
            value === id
              ? 'bg-white text-neutral-700 shadow-sm dark:bg-neutral-700 dark:text-neutral-200'
              : 'text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
