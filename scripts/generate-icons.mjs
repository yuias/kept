// Regenerates the placeholder app icons in public/ (a white note sheet on the
// accent blue). Run by hand: `node scripts/generate-icons.mjs`. The PNGs are
// committed; replace them with real artwork whenever you like. Output is
// deterministic, so a rerun leaves the files byte-identical.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const SUPERSAMPLE = 4
const BLUE = [0x0b, 0x6b, 0xcb]
const WHITE = [0xff, 0xff, 0xff]

// Shapes in fractions of the side. The whole design sits inside the central
// 80% safe circle, so the full-bleed 512 image is also valid as maskable.
const SHEET = { x0: 0.3125, x1: 0.6875, y0: 0.25, y1: 0.75, radius: 0.047 }
const BARS = [
  { x0: 0.375, x1: 0.625, cy: 0.375 },
  { x0: 0.375, x1: 0.625, cy: 0.4625 },
  { x0: 0.375, x1: 0.5625, cy: 0.55 },
]
const BAR_HEIGHT = 0.035

function inRoundedRect(x, y, r) {
  if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) return false
  const cx = Math.min(Math.max(x, r.x0 + r.radius), r.x1 - r.radius)
  const cy = Math.min(Math.max(y, r.y0 + r.radius), r.y1 - r.radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r.radius ** 2
}

function colorAt(x, y) {
  for (const bar of BARS) {
    if (x >= bar.x0 && x <= bar.x1 && Math.abs(y - bar.cy) <= BAR_HEIGHT / 2) return BLUE
  }
  return inRoundedRect(x, y, SHEET) ? WHITE : BLUE
}

function render(size) {
  const stride = size * 3 + 1
  const raw = Buffer.alloc(stride * size) // filter byte 0 (None) per row
  const samples = SUPERSAMPLE * SUPERSAMPLE
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0]
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const c = colorAt((px + (sx + 0.5) / SUPERSAMPLE) / size, (py + (sy + 0.5) / SUPERSAMPLE) / size)
          sum[0] += c[0]
          sum[1] += c[1]
          sum[2] += c[2]
        }
      }
      const at = py * stride + 1 + px * 3
      for (let i = 0; i < 3; i++) raw[at + i] = Math.round(sum[i] / samples)
    }
  }
  return raw
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

function encodePng(size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(render(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT_DIR, { recursive: true })
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(join(OUT_DIR, name), encodePng(size))
  console.log(`wrote public/${name}`)
}
