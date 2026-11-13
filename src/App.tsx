import { Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AboutDialog } from './components/AboutDialog'
import { Logo } from './components/Logo'
import { Stage } from './components/Stage'
import { ToolRail } from './components/ToolRail'
import { Button } from './components/ui/Button'
import { useInstallPrompt } from './hooks/useInstallPrompt'
import { APP_NAME } from './lib/brand'
import { cn } from './lib/cn'
import { ACCEPT } from './lib/file-types'
import { TOOLS, type ToolId } from './lib/tools'

/** `webCodecs`: whether this browser has VideoDecoder. Without it, nothing can be opened. */
export function App({ webCodecs }: { webCodecs: boolean }) {
  const [file, setFile] = useState<File | null>(null)
  const [tool, setTool] = useState<ToolId | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const install = useInstallPrompt()

  function open(next: File) {
    setFile(next)
    // Phase 2 picks Extract audio for audio-only files, once the file is probed.
    setTool('info')
  }

  // Files dropped anywhere on the window. Always cancel, or the browser opens what's dropped in
  // place of the app.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes('Files')
    const over = (e: DragEvent) => {
      e.preventDefault()
      if (webCodecs && hasFiles(e)) setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const dropped = e.dataTransfer?.files?.[0]
      if (webCodecs && dropped) open(dropped)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [webCodecs])

  const toolName = TOOLS.find((t) => t.id === tool)?.label

  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:h-dvh lg:grid-cols-[72px_320px_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex h-14 items-center justify-between gap-2 border-b border-line bg-panel px-4 lg:col-span-3 lg:px-5">
        <div className="flex items-center gap-2.5">
          <Logo className="size-7" />
          <span className="text-[15px] font-semibold">{APP_NAME}</span>
        </div>
        <div className="flex items-center gap-1">
          {install && (
            <Button size="sm" variant="ghost" onClick={install}>
              <Download />
              Install
            </Button>
          )}
          <AboutDialog />
        </div>
      </header>

      {/* The page's order is desktop's (tools, settings, stage); narrow screens move the stage up. */}
      <nav
        aria-label="Tool rail"
        className="order-3 border-b border-line bg-panel lg:order-none lg:border-r lg:border-b-0"
      >
        <ToolRail value={tool} disabled={!file} onChange={setTool} />
      </nav>

      <aside className="order-4 flex min-h-0 flex-col bg-panel lg:order-none lg:border-r lg:border-line">
        <div className="flex flex-1 flex-col gap-7 overflow-y-auto px-5 py-6">
          {file ? (
            <section>
              <h2 className="text-sm font-semibold">{toolName}</h2>
              <p className="mt-1 truncate text-xs text-ink-soft">{file.name}</p>
            </section>
          ) : (
            <section>
              <h2 className="text-sm font-semibold">No file open</h2>
              <p className="mt-1 text-xs text-ink-soft">
                {webCodecs
                  ? 'Open a video or audio file to use the tools. Files stay on your device.'
                  : 'This browser can’t run Moviola’s tools.'}
              </p>
            </section>
          )}
        </div>
      </aside>

      <main className="order-2 flex min-h-[55dvh] min-w-0 flex-col lg:order-none lg:min-h-0">
        {webCodecs && (
          <>
            <label className="sr-only" htmlFor="choose-file">
              Choose file
            </label>
            <input
              ref={input}
              id="choose-file"
              type="file"
              accept={ACCEPT}
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                const chosen = e.target.files?.[0]
                if (chosen) open(chosen)
                e.target.value = ''
              }}
            />
          </>
        )}
        <Stage file={file} webCodecs={webCodecs} onBrowse={() => input.current?.click()} />
      </main>

      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none fixed inset-3 z-30 flex items-center justify-center rounded-panel border-2 border-dashed border-accent bg-accent-soft/80 text-base font-semibold text-accent-text backdrop-blur-sm transition-opacity duration-150',
          dragging ? 'opacity-100' : 'opacity-0',
        )}
      >
        Drop to open
      </div>
    </div>
  )
}
