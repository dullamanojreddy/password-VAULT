// Generates minimal, valid solid-colour PNG icons for the extension manifest.
// No external image tooling required — just Node's built-in zlib deflate and
// hand-written PNG chunks (IHDR / IDAT / IEND).
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

// Solid AEGIS-blue square with a simple darker shield notch, RGBA.
function makePng(size, [r, g, b, a] = [56, 189, 248, 255]) {
  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4)
    raw[rowStart] = 0 // filter type: none
    for (let x = 0; x < size; x++) {
      const i = rowStart + 1 + x * 4
      // Simple rounded-corner + shield-notch effect for visual distinction.
      const cx = size / 2, cy = size / 2
      const inCorner = (x < 2 || x > size - 3) && (y < 2 || y > size - 3)
      const dark = x > size * 0.35 && x < size * 0.65 && y > size * 0.55
      raw[i] = inCorner ? 7 : dark ? 10 : r
      raw[i + 1] = inCorner ? 11 : dark ? 15 : g
      raw[i + 2] = inCorner ? 20 : dark ? 27 : b
      raw[i + 3] = inCorner ? 0 : a
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  const idat = deflateSync(raw)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

for (const size of [16, 32, 48, 128]) {
  const png = makePng(size)
  writeFileSync(join(outDir, `icon${size}.png`), png)
  console.log(`wrote icon${size}.png (${png.length} bytes)`)
}

// Tray icons — Windows typically wants 16/32 for the notification area.
for (const size of [16, 32]) {
  const png = makePng(size)
  writeFileSync(join(outDir, `tray${size}.png`), png)
  console.log(`wrote tray${size}.png (${png.length} bytes)`)
}
