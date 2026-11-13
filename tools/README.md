# Tools

- `icon-maskable.svg`: source of `public/icon-maskable-512.png` and `apple-touch-icon.png` (the mark at
  70% on a full square, inside the maskable safe zone); the other icons come from `public/icon.svg`.
  They were rendered with ImageMagick:
  `magick -background none -density 1600 public/icon.svg -resize 512x512 public/icon-512.png`
  (and `-resize 192x192` for `icon-192.png`; `tools/icon-maskable.svg` at 512 and 180 for the others).
