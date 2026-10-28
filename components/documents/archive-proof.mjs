const MAX_BYTES = 64 * 1024 * 1024;
const MAX_METADATA = 4 * 1024 * 1024;
const MAX_ENTRIES = 2048;
const ERROR_PREFIX = 'Archive proof: ';

function refuse(message) {
  throw new Error(ERROR_PREFIX + message);
}

function range(start, length, end, label) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) ||
      start < 0 || length < 0 || start > end || length > end - start) {
    refuse(label + ' is out of range');
  }
  return start + length;
}

function checkFlags(flags) {
  if (flags !== 0 && flags !== 0x0800) {
    refuse('unsupported ZIP flags (including encryption or data descriptors)');
  }
}

function checkExtra(bytes, start, length) {
  const end = range(start, length, bytes.length, 'extra field');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let position = start;
  while (position < end) {
    range(position, 4, end, 'extra field header');
    const tag = view.getUint16(position, true);
    const size = view.getUint16(position + 2, true);
    if (tag === 0x0001) refuse('ZIP64 extra field is unsupported');
    position = range(position + 4, size, end, 'extra field block');
  }
}

function decodeName(bytes, flags) {
  if (bytes.length === 0) refuse('empty entry name');
  let name;
  if (flags === 0) {
    name = '';
    for (const byte of bytes) {
      if (byte > 0x7f) refuse('non-ASCII name without UTF-8 flag');
      name += String.fromCharCode(byte);
    }
  } else {
    try {
      name = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      refuse('invalid UTF-8 entry name');
    }
  }
  if (name.includes('\u0000')) refuse('NUL in entry name');
  return name;
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

async function inflateBrowser(compressed, limit) {
  let reader;
  try {
    if (typeof DecompressionStream !== 'function' || typeof Blob !== 'function') {
      refuse('raw DEFLATE is unavailable');
    }
    // WHATWG raw DEFLATE decoding rejects incomplete streams and trailing input.
    const stream = new Blob([compressed]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    reader = stream.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      if (!(chunk instanceof Uint8Array)) refuse('invalid decompression chunk');
      if (chunk.byteLength > limit - length) refuse('actual expanded output exceeds budget');
      length += chunk.byteLength;
      chunks.push(chunk);
    }
    // No concatenation happens until every chunk has passed the output bound.
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  } catch (error) {
    if (reader) {
      try { await reader.cancel(error); } catch { /* Preserve the proof failure. */ }
    }
    throw error;
  } finally {
    if (reader) reader.releaseLock();
  }
}

async function inflate(compressed, limit) {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const { inflateRawSync } = await import('node:zlib');
    // Node 22+: info returns { buffer, engine }; bytesWritten counts consumed input.
    // maxOutputLength must be positive, so a zero budget permits at most one
    // temporary byte, which is rejected below before retaining an entry.
    const result = inflateRawSync(compressed, {
      info: true,
      maxOutputLength: Math.max(1, limit),
    });
    if (result.engine.bytesWritten !== compressed.byteLength) {
      refuse('compressed trailing data or incomplete input consumption');
    }
    if (result.buffer.byteLength > limit) refuse('actual expanded output exceeds budget');
    return new Uint8Array(result.buffer);
  }
  return inflateBrowser(compressed, limit);
}

/** Bounded, read-only ZIP proof. Unsupported or malformed archives reject. */
export async function archiveEntries(input, { profile = 'generic' } = {}) {
  try {
    if (profile !== 'generic' && profile !== 'engine') refuse('unsupported archive profile');
    const engine = profile === 'engine';
    if (!(input instanceof Uint8Array)) refuse('input must be Uint8Array');
    if (input.byteLength > MAX_BYTES) refuse('archive input exceeds 64 MiB');
    // Capture caller-owned bytes before the first await; return no partial map.
    const bytes = new Uint8Array(input);
    if (bytes.length < 22) refuse('truncated EOCD');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const earliest = Math.max(0, bytes.length - 22 - 0xffff);
    for (let offset = bytes.length - 22; offset >= earliest; offset--) {
      if (view.getUint32(offset, true) !== 0x06054b50) continue;
      const commentLength = view.getUint16(offset + 20, true);
      if (offset + 22 + commentLength !== bytes.length) continue;
      if (eocd !== -1) refuse('ambiguous EOCD signatures');
      eocd = offset;
    }
    if (eocd === -1) refuse('EOCD or comment bounds are invalid');
    if (engine && view.getUint16(eocd + 20, true) !== 0) refuse('engine EOCD comment is unsupported');
    const disk = view.getUint16(eocd + 4, true);
    const directoryDisk = view.getUint16(eocd + 6, true);
    const diskCount = view.getUint16(eocd + 8, true);
    const count = view.getUint16(eocd + 10, true);
    const directorySize = view.getUint32(eocd + 12, true);
    const directoryOffset = view.getUint32(eocd + 16, true);
    if (count === 0xffff || diskCount === 0xffff ||
        directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      refuse('ZIP64 is unsupported');
    }
    if (disk !== 0 || directoryDisk !== 0 || diskCount !== count) {
      refuse('multidisk or inconsistent entry counts');
    }
    if (count > MAX_ENTRIES) refuse('entry count exceeds 2048');
    let metadata = directorySize + bytes.length - eocd;
    if (metadata > MAX_METADATA) refuse('metadata exceeds 4 MiB');
    const directoryEnd = range(directoryOffset, directorySize, eocd, 'central directory');
    if (directoryEnd !== eocd) refuse('central directory does not end at EOCD');

    const names = Object.create(null);
    const records = [];
    let position = directoryOffset;
    let declaredTotal = 0;
    for (let index = 0; index < count; index++) {
      range(position, 46, directoryEnd, 'central header');
      if (view.getUint32(position, true) !== 0x02014b50) refuse('bad central signature');
      const version = view.getUint16(position + 6, true);
      const flags = view.getUint16(position + 8, true);
      const method = view.getUint16(position + 10, true);
      const crc = view.getUint32(position + 16, true);
      const compressedSize = view.getUint32(position + 20, true);
      const size = view.getUint32(position + 24, true);
      const nameLength = view.getUint16(position + 28, true);
      const extraLength = view.getUint16(position + 30, true);
      const commentLength = view.getUint16(position + 32, true);
      const startDisk = view.getUint16(position + 34, true);
      const localOffset = view.getUint32(position + 42, true);
      if (compressedSize === 0xffffffff || size === 0xffffffff ||
          localOffset === 0xffffffff || startDisk === 0xffff) refuse('ZIP64 entry is unsupported');
      if (version > 20) refuse('unsupported ZIP version');
      if (startDisk !== 0) refuse('multidisk entry');
      checkFlags(flags);
      if (engine && flags !== 0) refuse('engine ZIP flags must be zero');
      if (engine && (extraLength !== 0 || commentLength !== 0)) {
        refuse('engine central extras or entry comments are unsupported');
      }
      if (method !== 0 && method !== 8) refuse('unsupported compression method');
      const centralNext = range(position + 46,
        nameLength + extraLength + commentLength, directoryEnd, 'central variable fields');
      const rawName = bytes.subarray(position + 46, position + 46 + nameLength);
      checkExtra(bytes, position + 46 + nameLength, extraLength);
      const name = decodeName(rawName, flags);
      if (engine && (name.includes('\\') || name.includes(':') ||
          name.split('/').some(segment => segment === '' || segment === '.' || segment === '..'))) {
        refuse('engine entry name must be a canonical relative package path');
      }
      if (Object.prototype.hasOwnProperty.call(names, name)) refuse('duplicate entry name');
      names[name] = true;
      if (size > MAX_BYTES - declaredTotal) refuse('declared expanded total exceeds 64 MiB');
      declaredTotal += size;
      if (method === 0 && compressedSize !== size) refuse('stored size disagreement');

      range(localOffset, 30, directoryOffset, 'local header');
      if (view.getUint32(localOffset, true) !== 0x04034b50) refuse('bad local signature');
      if (view.getUint16(localOffset + 4, true) > 20) refuse('unsupported local ZIP version');
      const localFlags = view.getUint16(localOffset + 6, true);
      const localMethod = view.getUint16(localOffset + 8, true);
      const localCRC = view.getUint32(localOffset + 14, true);
      const localCompressed = view.getUint32(localOffset + 18, true);
      const localSize = view.getUint32(localOffset + 22, true);
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      if (engine && localExtraLength !== 0) refuse('engine local extras are unsupported');
      if (localCompressed === 0xffffffff || localSize === 0xffffffff) refuse('local ZIP64 is unsupported');
      checkFlags(localFlags);
      if (localFlags !== flags || localMethod !== method || localCRC !== crc ||
          localCompressed !== compressedSize || localSize !== size) {
        refuse('local and central metadata disagree');
      }
      const payloadStart = range(localOffset + 30,
        localNameLength + localExtraLength, directoryOffset, 'local variable fields');
      const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength);
      if (!equalBytes(rawName, localName)) refuse('local and central names disagree');
      checkExtra(bytes, localOffset + 30 + localNameLength, localExtraLength);
      metadata += 30 + localNameLength + localExtraLength;
      if (metadata > MAX_METADATA) refuse('metadata exceeds 4 MiB');
      const end = range(payloadStart, compressedSize, directoryOffset, 'entry payload');
      records.push({ name, method, crc, size, localOffset, payloadStart, end });
      position = centralNext;
    }
    if (position !== directoryEnd) refuse('central directory count or size disagreement');
    const ordered = [...records].sort((left, right) => left.localOffset - right.localOffset);
    let previousEnd = 0;
    for (const record of ordered) {
      if (record.localOffset < previousEnd) refuse('overlapping entry records');
      if (engine && record.localOffset !== previousEnd) refuse('engine local regions must be contiguous from offset zero');
      previousEnd = record.end;
    }
    if (engine && previousEnd !== directoryOffset) refuse('engine local regions must end at central directory');

    const entries = Object.create(null);
    let actualTotal = 0;
    for (const record of records) {
      const remaining = MAX_BYTES - actualTotal;
      const limit = Math.min(record.size, remaining);
      const compressed = bytes.subarray(record.payloadStart, record.end);
      let output;
      if (record.method === 0) {
        if (compressed.byteLength > limit) refuse('actual expanded output exceeds budget');
        output = new Uint8Array(compressed);
      } else {
        output = await inflate(compressed, limit);
      }
      if (output.byteLength > remaining) refuse('actual expanded total exceeds 64 MiB');
      if (output.byteLength !== record.size) refuse('actual expanded size disagreement');
      if (crc32(output) !== record.crc) refuse('CRC-32 mismatch');
      actualTotal += output.byteLength;
      entries[record.name] = output;
    }
    return entries;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(ERROR_PREFIX)) throw error;
    refuse('invalid archive or decompression failure');
  }
}
