import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { describeInfo, infoAsText, type MediaInfo } from '@/lib/info'
import { Button } from './ui/Button'

/** Media info (SPEC.md 6.2): everything known about the file, read-only, and a way to copy it. */
export function MediaInfoView({ info }: { info: MediaInfo }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <div className="flex flex-col gap-7">
      <Button
        className="self-start"
        onClick={() =>
          navigator.clipboard.writeText(infoAsText(info)).then(
            () => setCopied(true),
            () => {},
          )
        }
      >
        {copied ? <Check /> : <Copy />}
        {copied ? 'Copied' : 'Copy as text'}
      </Button>
      {describeInfo(info).map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h3 className="text-[13px] font-medium text-ink-soft">{group.title}</h3>
          <dl className="mt-2 grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
            {group.rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-ink-soft">{row.label}</dt>
                <dd className="min-w-0 break-words">
                  {row.value}
                  {row.caption && <span className="block text-xs break-all text-ink-soft">{row.caption}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
