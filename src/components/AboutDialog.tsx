import { Info, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { APP_NAME, SOURCE_URL } from '@/lib/brand'

// The encoders Mediabunny's add-ons wrap, used where the browser has none of its own.
const ENCODERS = [
  { name: 'LAME', licence: 'LGPL', url: 'https://lame.sourceforge.io/', use: 'MP3' },
  { name: 'libFLAC', licence: 'BSD-style', url: 'https://xiph.org/flac/', use: 'FLAC' },
  { name: "FFmpeg's AAC encoder", licence: 'LGPL', url: 'https://ffmpeg.org/', use: 'AAC' },
]

export function AboutDialog() {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        aria-label="About"
        className="flex size-8 items-center justify-center rounded-control text-ink-soft transition-colors duration-150 hover:bg-sunken hover:text-ink"
      >
        <Info className="size-4" strokeWidth={1.75} />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-panel bg-panel p-6 shadow-float outline-none">
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-base font-semibold">{APP_NAME}</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="-m-1 rounded-control p-1 text-ink-soft hover:bg-sunken hover:text-ink"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-2 text-sm text-ink-soft">
            Extracts audio, trims, compresses, changes containers, grabs frames and makes GIFs. Everything runs in your
            browser on your own device; files are never uploaded. Streams are copied rather than re-encoded wherever
            possible, and every action says which it does. Once installed, it works without a connection.
          </Dialog.Description>

          <h3 className="mt-6 text-[13px] font-semibold">Software</h3>
          <p className="mt-3 text-[13px] text-ink-soft">
            Video and audio are read and written by{' '}
            <a href="https://mediabunny.dev/" target="_blank" rel="noreferrer">
              Mediabunny
            </a>{' '}
            (MPL-2.0) with the browser's WebCodecs. Where the browser has no encoder of its own, Mediabunny's add-ons
            use{' '}
            {ENCODERS.map((e, i) => (
              <span key={e.name}>
                <a href={e.url} target="_blank" rel="noreferrer">
                  {e.name}
                </a>{' '}
                ({e.licence}) for {e.use}
                {i < ENCODERS.length - 2 ? ', ' : i === ENCODERS.length - 2 ? ' and ' : ''}
              </span>
            ))}
            . GIFs are encoded by{' '}
            <a href="https://github.com/mattdesl/gifenc" target="_blank" rel="noreferrer">
              gifenc
            </a>{' '}
            (MIT). {APP_NAME}'s own code is available under the MIT or Apache-2.0 licence.
          </p>
          <p className="mt-3 text-[13px]">
            <a href={SOURCE_URL} target="_blank" rel="noreferrer">
              Source code on GitHub
            </a>
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
