/** The mark: a playhead over a strip of frames. Same drawing and colours as public/icon.svg, so it
 * matches the installed icon in both themes. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" fill="#1c1c1f" />
      <g fill="#f4a437">
        <g opacity="0.45">
          <rect x="4.5" y="14" width="7" height="9" rx="1.5" />
          <rect x="12.5" y="14" width="7" height="9" rx="1.5" />
          <rect x="20.5" y="14" width="7" height="9" rx="1.5" />
        </g>
        <rect x="15" y="9" width="2" height="17.5" rx="1" />
        <path d="M12.5 6.25a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 .75.75v2.4a.75.75 0 0 1-.27.58L16 11.9l-3.23-2.67a.75.75 0 0 1-.27-.58z" />
      </g>
    </svg>
  )
}
