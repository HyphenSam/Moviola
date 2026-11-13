import { AudioLines, Camera, Film, Info, Package, Scissors, Shrink, VolumeX, type LucideIcon } from 'lucide-react'
import { ToggleGroup } from 'radix-ui'
import { TOOLS, type ToolId } from '@/lib/tools'

const ICONS: Record<ToolId, LucideIcon> = {
  'extract-audio': AudioLines,
  info: Info,
  trim: Scissors,
  container: Package,
  'remove-audio': VolumeX,
  compress: Shrink,
  frame: Camera,
  gif: Film,
}

/** One button per tool: a column on desktop, a scrolling row of chips on narrow screens. Arrow keys
 * move between them. Every tool is disabled until a file is open. */
export function ToolRail({
  value,
  disabled,
  onChange,
}: {
  value: ToolId | null
  disabled: boolean
  onChange: (tool: ToolId) => void
}) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label="Tools"
      value={value ?? ''}
      // Radix sends '' when the selected tool is clicked again; keep it selected.
      onValueChange={(v) => v && onChange(v as ToolId)}
      disabled={disabled}
      // The chip row hides its scrollbar; the chip cut off at the edge shows there's more.
      className="flex gap-1.5 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] lg:[scrollbar-width:thin]lg:flex-col lg:gap-1 lg:overflow-x-visible lg:overflow-y-auto lg:px-1.5 lg:py-2"
    >
      {TOOLS.map((tool) => {
        const Icon = ICONS[tool.id]
        return (
          <ToggleGroup.Item
            key={tool.id}
            value={tool.id}
            className={[
              'relative flex shrink-0 items-center gap-1.5 rounded-control text-ink-soft transition-colors duration-150',
              // Narrow: a chip with the icon before the name.
              'h-8 px-3 text-[13px] font-medium shadow-[0_0_0_1px_var(--color-line)]',
              // Desktop: the icon above a caption, a bar on the inner edge when selected.
              'lg:h-auto lg:flex-col lg:gap-1 lg:px-1 lg:py-2.5 lg:text-xs lg:font-normal lg:leading-tight lg:shadow-none',
              'enabled:hover:bg-sunken enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45',
              'data-[state=on]:bg-sunken data-[state=on]:text-ink data-[state=on]:shadow-[0_0_0_1.5px_var(--color-focus)] lg:data-[state=on]:shadow-none',
              'lg:after:absolute lg:after:inset-y-2 lg:after:-right-1.5 lg:after:w-[3px] lg:after:rounded-l-full lg:data-[state=on]:after:bg-focus',
            ].join(' ')}
          >
            <Icon aria-hidden="true" className="size-4 lg:size-5" strokeWidth={1.75} />
            <span className="lg:text-center">{tool.label}</span>
          </ToggleGroup.Item>
        )
      })}
    </ToggleGroup.Root>
  )
}
