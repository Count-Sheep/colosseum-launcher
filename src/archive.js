'use strict';

// Yaz0-compressed RARC archives (.szs/.arc), the game's packed asset folders.

// Far beyond any of the game's archives; a larger size means a damaged file.
const MAX_SIZE = 64 << 20;

function yaz0(src) {
  if (src.toString('ascii', 0, 4) !== 'Yaz0') return src;
  const size = src.readUInt32BE(4);
  if (size > MAX_SIZE) throw new Error('A file on the game disc appears to be damaged.');
  const out = Buffer.alloc(size);
  let s = 16, d = 0;
  while (d < out.length) {
    const header = src[s++];
    for (let bit = 7; bit >= 0 && d < out.length; bit--) {
      if (header & (1 << bit)) { out[d++] = src[s++]; continue; }
      const a = src[s++], b = src[s++];
      let back = d - (((a & 0xf) << 8) | b) - 1;
      let length = a >> 4 ? (a >> 4) + 2 : src[s++] + 0x12;
      while (length--) out[d++] = out[back++];
    }
  }
  return out;
}

// path (lower case, "/"-separated, without the archive's root folder) -> Buffer
function rarc(buffer) {
  const data = yaz0(buffer);
  if (data.toString('ascii', 0, 4) !== 'RARC') throw new Error('This is not a game archive.');
  const info = 0x20, dataStart = 0x20 + data.readUInt32BE(0x0c);
  const nodes = info + data.readUInt32BE(info + 4), entries = info + data.readUInt32BE(info + 0x0c);
  const strings = info + data.readUInt32BE(info + 0x14);
  const name = at => data.toString('latin1', strings + at, data.indexOf(0, strings + at));
  const files = new Map();
  const walk = (node, prefix) => {
    const n = nodes + node * 16, count = data.readUInt16BE(n + 10), first = data.readUInt32BE(n + 12);
    for (let i = 0; i < count; i++) {
      const e = entries + (first + i) * 20, flags = data[e + 4], entryName = name(data.readUInt32BE(e + 4) & 0xffffff);
      if (entryName === '.' || entryName === '..') continue;
      if (flags & 0x02) walk(data.readUInt32BE(e + 8), `${prefix}${entryName}/`);
      else {
        const start = dataStart + data.readUInt32BE(e + 8);
        files.set(`${prefix}${entryName}`.toLowerCase(), data.subarray(start, start + data.readUInt32BE(e + 12)));
      }
    }
  };
  walk(0, '');
  return files;
}

module.exports = { yaz0, rarc };
