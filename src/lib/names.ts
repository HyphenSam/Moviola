// Output file names (SPEC.md section 8).

/** The source name without its last extension. A leading dot isn't an extension (`.hidden`). */
export function stem(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

// Windows refuses these in file names; times use `-` for `:` instead.
const sanitise = (part: string) => part.replaceAll(':', '-').replace(/[<>"/\\|?*]/g, '')

/** `<stem><suffix>.<extension>`. The suffix and extension are made here, so they're cleaned; the
 * stem is the user's own name and is kept as it is. */
export function outputName(source: string, suffix: string, extension: string): string {
  return `${stem(source)}${sanitise(suffix)}.${sanitise(extension)}`
}

/** `name`, or `name (2).ext`, `name (3).ext`… when the exports already hold it, ignoring case. */
export function uniqueName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()))
  if (!used.has(name.toLowerCase())) return name
  const base = stem(name)
  const extension = name.slice(base.length)
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${extension}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}
