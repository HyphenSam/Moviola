/** Moviola decodes and encodes with WebCodecs; without VideoDecoder there's nothing it can do. */
export function hasWebCodecs(scope: object = globalThis): boolean {
  return 'VideoDecoder' in scope
}
