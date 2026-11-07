'use strict';

// Colosseum's FSYS archives: nearly every file on the disc is one, holding entries
// that are usually LZSS compressed.

const COMPRESSED = 0x80000000;

// Okumura LZSS, as the game has it: a 4096-byte window starting at 0xFEE, flag bits
// lowest first, 1 for a literal, 0 for a 12-bit offset and 4-bit length (plus 3).
function lzss(source) {
  if (source.toString('latin1', 0, 4) !== 'LZSS') return source;
  const size = source.readUInt32BE(4), out = Buffer.alloc(size), ring = new Uint8Array(4096);
  let from = 16, to = 0, write = 0xfee, flags = 0;
  while (from < source.length && to < size) {
    flags >>= 1;
    if (!(flags & 0x100)) {
      flags = source[from++] | 0xff00;
      if (from >= source.length) break;
    }
    if (flags & 1) {
      const byte = source[from++];
      out[to++] = byte;
      ring[write] = byte;
      write = (write + 1) & 0xfff;
      continue;
    }
    if (from + 1 >= source.length) break;
    const low = source[from], high = source[from + 1];
    from += 2;
    const offset = low | ((high & 0xf0) << 4), length = (high & 0x0f) + 3;
    for (let k = 0; k < length && to < size; k++) {
      const byte = ring[(offset + k) & 0xfff];
      out[to++] = byte;
      ring[write] = byte;
      write = (write + 1) & 0xfff;
    }
  }
  return out.subarray(0, to);
}

// One entry's place in an archive, from its record at `record`.
function entryAt(archive, record) {
  const name = archive.readUInt32BE(record + 36);
  return {
    id: archive.readUInt32BE(record), offset: archive.readUInt32BE(record + 4), size: archive.readUInt32BE(record + 8),
    flags: archive.readUInt32BE(record + 12), storedSize: archive.readUInt32BE(record + 20), type: archive.readUInt32BE(record + 32),
    name: name < archive.length ? archive.toString('latin1', name, archive.indexOf(0, name)) : ''
  };
}

function isArchive(archive) {
  return archive.length >= 0x40 && archive.toString('latin1', 0, 4) === 'FSYS';
}

// Every entry of an archive, in order: { id, name, type, data() }. data() unpacks it.
function entries(archive) {
  if (!isArchive(archive)) throw new Error('This file of the game disc isn\'t an archive.');
  const count = archive.readUInt32BE(0x0c), list = archive.readUInt32BE(archive.readUInt32BE(0x18));
  return Array.from({ length: count }, (_, index) => {
    const entry = entryAt(archive, archive.readUInt32BE(list + index * 4));
    const compressed = (entry.flags & COMPRESSED) !== 0;
    return { id: entry.id, name: entry.name, type: entry.type, data() {
      const stored = archive.subarray(entry.offset, entry.offset + (compressed ? entry.storedSize : entry.size));
      return compressed ? lzss(stored) : stored;
    } };
  });
}

// The id of an archive's first entry, from no more than its first bytes.
function firstEntryId(head) {
  if (!isArchive(head)) return null;
  const table = head.readUInt32BE(0x18);
  if (table + 4 > head.length) return null;
  const list = head.readUInt32BE(table);
  if (list + 4 > head.length) return null;
  const record = head.readUInt32BE(list);
  return record + 4 > head.length ? null : head.readUInt32BE(record);
}

module.exports = { lzss, entries, firstEntryId };
