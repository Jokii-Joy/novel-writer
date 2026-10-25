/*
 * qr.js — a dependency-free QR Code encoder (byte mode, ECC level M).
 *
 * Why hand-rolled: the pairing screen has to draw a QR code, and this plugin
 * ships with zero runtime dependencies by design. A QR encoder is a few hundred
 * lines of well-specified arithmetic, which is a better trade than pulling in a
 * package for one image.
 *
 * Scope, deliberately narrow:
 *   - byte mode only (UTF-8 / ASCII pairing payloads),
 *   - error correction level M (15% recovery — enough for a phone camera),
 *   - versions 1..5, whose blocks are all the same size, which removes the
 *     interleaving edge cases that make versions 6+ awkward. The pairing string
 *     is ~60 bytes, and version 5-M holds 86, so there is ample headroom.
 *
 * Anything longer is truncated by the caller, never silently corrupted: the
 * encoder throws rather than emit a code that scans to the wrong text.
 */

const VERSIONS = [
  // [version, dataCodewords, ecCodewordsPerBlock, blocks, alignment]
  [1, 16, 10, 1, []],
  [2, 28, 16, 1, [6, 18]],
  [3, 44, 26, 1, [6, 22]],
  [4, 64, 18, 2, [6, 26]],
  [5, 86, 24, 2, [6, 30]],
];

const ECC_LEVEL_M = 0; // format-info bits for level M

// --- Galois field ----------------------------------------------------------

const EXP = new Array(512);
const LOG = new Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // primitive polynomial for QR
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Generator polynomial for `degree` error-correction codewords. */
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Remainder of `data` divided by the generator — the EC codewords. */
function rsRemainder(data, degree) {
  const gen = rsGenerator(degree);
  const buffer = new Array(degree).fill(0);
  for (let i = 0; i < data.length; i += 1) {
    const factor = data[i] ^ buffer[0];
    buffer.shift();
    buffer.push(0);
    for (let j = 0; j < degree; j += 1) {
      buffer[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return buffer;
}

// --- bit buffer ------------------------------------------------------------

function BitBuffer() {
  this.bits = [];
}
BitBuffer.prototype.put = function put(value, length) {
  for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
};
BitBuffer.prototype.length = function length() {
  return this.bits.length;
};

function utf8Bytes(text) {
  const out = [];
  const encoded = unescape(encodeURIComponent(String(text)));
  for (let i = 0; i < encoded.length; i += 1) out.push(encoded.charCodeAt(i) & 0xff);
  return out;
}

// --- matrix ----------------------------------------------------------------

function makeMatrix(size) {
  const rows = [];
  for (let y = 0; y < size; y += 1) rows.push(new Array(size).fill(null));
  return rows;
}

function placeFinder(m, x, y) {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= m.length || py >= m.length) continue;
      const inner = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const ring = inner && (dx === 0 || dx === 6 || dy === 0 || dy === 6);
      const core = inner && dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      m[py][px] = ring || core ? 1 : 0;
    }
  }
}

function placeAlignment(m, cx, cy) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      m[cy + dy][cx + dx] = ring === 1 ? 0 : 1;
    }
  }
}

function placeTiming(m) {
  for (let i = 8; i < m.length - 8; i += 1) {
    const bit = i % 2 === 0 ? 1 : 0;
    m[6][i] = bit;
    m[i][6] = bit;
  }
}

function placeFormat(m, mask) {
  const size = m.length;
  const data = (ECC_LEVEL_M << 3) | mask;
  let value = data << 10;
  // BCH(15,5) with generator 0x537.
  for (let i = 4; i >= 0; i -= 1) {
    if ((value >>> (i + 10)) & 1) value ^= 0x537 << i;
  }
  const bits = ((data << 10) | value) ^ 0x5412;
  const bitAt = (index) => (bits >>> index) & 1;

  // Copy 1: around the top-left finder.
  for (let i = 0; i <= 5; i += 1) m[8][i] = bitAt(i);
  m[8][7] = bitAt(6);
  m[8][8] = bitAt(7);
  m[7][8] = bitAt(8);
  for (let i = 9; i < 15; i += 1) m[14 - i][8] = bitAt(i);

  // Copy 2: split between the other two finders.
  for (let i = 0; i < 8; i += 1) m[8][size - 1 - i] = bitAt(i);
  for (let i = 8; i < 15; i += 1) m[size - 15 + i][8] = bitAt(i);
  m[size - 8][8] = 1; // the always-dark module
}

function reserve(m, x, y) {
  if (y < 0 || y >= m.length || x < 0 || x >= m.length) return;
  m[y][x] = 0;
}

function buildFunctionPatterns(m, versionInfo) {
  const size = m.length;
  const { alignment } = versionInfo;
  placeFinder(m, 0, 0);
  placeFinder(m, size - 7, 0);
  placeFinder(m, 0, size - 7);
  placeTiming(m);
  for (let a = 0; a < alignment.length; a += 1) {
    for (let b = 0; b < alignment.length; b += 1) {
      const cx = alignment[a];
      const cy = alignment[b];
      const nearFinder =
        (cx === 6 && cy === 6) ||
        (cx === 6 && cy === size - 7) ||
        (cx === size - 7 && cy === 6);
      if (!nearFinder) placeAlignment(m, cx, cy);
    }
  }
  // Reserve the format areas so data placement skips them.
  for (let i = 0; i < 9; i += 1) {
    reserve(m, i, 8);
    reserve(m, 8, i);
    if (i < 8) {
      reserve(m, size - 1 - i, 8);
      reserve(m, 8, size - 1 - i);
    }
  }
}

function maskFn(id, x, y) {
  switch (id) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** Walk the data modules in the QR zig-zag order. */
function placeData(m, bits, mask) {
  const size = m.length;
  let index = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let vert = 0; vert < size; vert += 1) {
      const y = upward ? size - 1 - vert : vert;
      for (let pair = 0; pair < 2; pair += 1) {
        const x = right - pair;
        if (m[y][x] !== null) continue;
        let bit = index < bits.length ? bits[index] : 0;
        index += 1;
        if (maskFn(mask, x, y)) bit ^= 1;
        m[y][x] = bit;
      }
    }
    upward = !upward;
  }
}

function penalty(m) {
  const size = m.length;
  let score = 0;
  // Rule 1: runs of five or more same-coloured modules.
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < size; i += 1) {
      let run = 1;
      let last = pass === 0 ? m[i][0] : m[0][i];
      for (let j = 1; j < size; j += 1) {
        const value = pass === 0 ? m[i][j] : m[j][i];
        if (value === last) run += 1;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
          last = value;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }
  // Rule 2: 2x2 blocks of one colour.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const v = m[y][x];
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
    }
  }
  // Rule 3: finder-like 1:1:3:1:1 sequences with a light margin.
  const pattern = [1, 0, 1, 1, 1, 0, 1];
  const scan = (get) => {
    for (let i = 0; i <= size - 7; i += 1) {
      let hit = true;
      for (let k = 0; k < 7; k += 1) {
        if (get(i + k) !== pattern[k]) {
          hit = false;
          break;
        }
      }
      if (hit) score += 40;
    }
  };
  for (let y = 0; y < size; y += 1) scan((x) => m[y][x]);
  for (let x = 0; x < size; x += 1) scan((y) => m[y][x]);
  // Rule 4: balance of dark and light.
  let dark = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) if (m[y][x]) dark += 1;
  }
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

/**
 * Encode `text` as a QR matrix.
 * Returns `{version, size, modules}` where `modules[y][x]` is 0 or 1.
 */
export function qrMatrix(text) {
  const bytes = utf8Bytes(text);
  let chosen = null;
  for (let i = 0; i < VERSIONS.length; i += 1) {
    const info = VERSIONS[i];
    // 4 bits of mode + 8 bits of length (versions 1..9) + payload.
    const needed = Math.ceil((4 + 8 + bytes.length * 8) / 8);
    if (needed <= info[1]) {
      chosen = info;
      break;
    }
  }
  if (!chosen) {
    throw new Error(`QR payload too long (${bytes.length} bytes) — shorten the pairing code`);
  }

  const [version, dataCodewords, ecPerBlock, blocks] = chosen;
  const buffer = new BitBuffer();
  buffer.put(0b0100, 4); // byte mode
  buffer.put(bytes.length, 8);
  for (let i = 0; i < bytes.length; i += 1) buffer.put(bytes[i], 8);
  // Terminator, then pad to a whole codeword.
  const capacityBits = dataCodewords * 8;
  const terminator = Math.min(4, capacityBits - buffer.length());
  buffer.put(0, terminator);
  while (buffer.length() % 8 !== 0) buffer.bits.push(0);
  const dataBytes = [];
  for (let i = 0; i < buffer.length(); i += 8) {
    let value = 0;
    for (let k = 0; k < 8; k += 1) value = (value << 1) | buffer.bits[i + k];
    dataBytes.push(value);
  }
  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  while (dataBytes.length < dataCodewords) {
    dataBytes.push(padBytes[padIndex % 2]);
    padIndex += 1;
  }

  // Split, add EC, then interleave back into a single codeword stream.
  const perBlock = dataCodewords / blocks;
  const dataBlocks = [];
  const ecBlocks = [];
  for (let b = 0; b < blocks; b += 1) {
    const chunk = dataBytes.slice(b * perBlock, (b + 1) * perBlock);
    dataBlocks.push(chunk);
    ecBlocks.push(rsRemainder(chunk, ecPerBlock));
  }
  const codewords = [];
  for (let i = 0; i < perBlock; i += 1) {
    for (let b = 0; b < blocks; b += 1) codewords.push(dataBlocks[b][i]);
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (let b = 0; b < blocks; b += 1) codewords.push(ecBlocks[b][i]);
  }
  const bits = [];
  for (let i = 0; i < codewords.length; i += 1) {
    for (let k = 7; k >= 0; k -= 1) bits.push((codewords[i] >>> k) & 1);
  }

  const size = version * 4 + 17;
  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const m = makeMatrix(size);
    buildFunctionPatterns(m, { alignment: chosen[4] });
    placeData(m, bits, mask);
    placeFormat(m, mask);
    const score = penalty(m);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return { version, size, modules: best };
}

/**
 * Render `text` as a standalone SVG string.
 *
 * `quiet` is the light margin in modules — the spec asks for 4; phones cope with
 * less, but a white border also stops the code from bleeding into a dark panel.
 */
export function qrSvg(text, options = {}) {
  const { version, size, modules } = qrMatrix(text);
  const quiet = Number.isFinite(Number(options.quiet)) ? Math.max(0, Math.trunc(Number(options.quiet))) : 4;
  const total = size + quiet * 2;
  const dark = options.dark ? String(options.dark) : '#000000';
  const light = options.light ? String(options.light) : '#ffffff';
  const parts = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules[y][x]) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="100%" height="100%"`,
    ` shape-rendering="crispEdges" role="img" data-qr-version="${version}">`,
    `<rect width="${total}" height="${total}" fill="${light}"/>`,
    `<path d="${parts.join('')}" fill="${dark}"/>`,
    '</svg>',
  ].join('');
}

/** Largest payload the encoder accepts, in bytes (version 5 at level M). */
export const QR_MAX_BYTES = VERSIONS[VERSIONS.length - 1][1] - 3;

export const LEVEL = 'M';
