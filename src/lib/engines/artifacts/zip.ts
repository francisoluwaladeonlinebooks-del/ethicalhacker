import zlib from 'node:zlib';

/**
 * Minimal, defensive ZIP reader used for authorised APK/IPA/source artefacts.
 * Guards against zip bombs by enforcing per-entry and total size limits.
 */

export type ZipEntry = { name: string; size: number; compressedSize: number; method: number; offset: number };

export type ZipArchive = {
  entries: ZipEntry[];
  read(entry: ZipEntry, maxBytes?: number): Buffer;
  has(name: string): boolean;
  find(pattern: RegExp): ZipEntry[];
};

const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export function openZip(buffer: Buffer): ZipArchive {
  const eocdOffset = findEocd(buffer);
  if (eocdOffset < 0) throw new Error('Not a valid ZIP archive (end of central directory not found)');
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  let totalUncompressed = 0;

  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    totalUncompressed += size;
    if (totalUncompressed > MAX_TOTAL_BYTES) throw new Error('Archive exceeds the maximum permitted uncompressed size');
    entries.push({ name, size, compressedSize, method, offset: localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  const read = (entry: ZipEntry, maxBytes = 20 * 1024 * 1024): Buffer => {
    if (entry.size > maxBytes) throw new Error(`Entry ${entry.name} exceeds the permitted size`);
    const local = entry.offset;
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error(`Corrupt local header for ${entry.name}`);
    const nameLength = buffer.readUInt16LE(local + 26);
    const extraLength = buffer.readUInt16LE(local + 28);
    const dataStart = local + 30 + nameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.method === 0) return Buffer.from(compressed);
    if (entry.method === 8) {
      const inflated = zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(entry.size, 1024) });
      return inflated;
    }
    throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
  };

  return {
    entries,
    read,
    has: (name: string) => entries.some((entry) => entry.name === name),
    find: (pattern: RegExp) => entries.filter((entry) => pattern.test(entry.name)),
  };
}

function findEocd(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - 66_000);
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/** Extract printable ASCII strings from binary content (DEX, Mach-O, resources). */
export function extractStrings(buffer: Buffer, minLength = 5, maxStrings = 40_000): string[] {
  const output: string[] = [];
  let current = '';
  for (let i = 0; i < buffer.length && output.length < maxStrings; i += 1) {
    const byte = buffer[i];
    if (byte >= 0x20 && byte <= 0x7e) {
      current += String.fromCharCode(byte);
    } else {
      if (current.length >= minLength) output.push(current);
      current = '';
    }
  }
  if (current.length >= minLength && output.length < maxStrings) output.push(current);
  return output;
}
