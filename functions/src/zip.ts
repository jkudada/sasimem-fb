/**
 * A zip file, for "Export everything" (PLAN-SUBSCRIBERS §11, S6). Small on purpose: no
 * dependency, Node's own deflate and CRC-32. Each entry is deflated unless that would not
 * make it smaller (PDFs are mostly compressed already), and names are UTF-8. No Zip64, so
 * at most 65,535 entries and 4 GB: far beyond one landlord's records.
 */
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
}

const UTF8 = 0x0800;
const MAX = 0xffff_ffff;

/** MS-DOS time and date, in the time zone the landlord will open it in. */
function dosTime(when: Date): { time: number; date: number } {
  return {
    time: (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | Math.floor(when.getUTCSeconds() / 2),
    date: ((when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate(),
  };
}

/** `when` is written as each file's time; pass the local wall-clock time as if it were UTC. */
export function zip(entries: readonly ZipEntry[], when: Date): Buffer {
  if (entries.length > 0xffff) throw new RangeError("too many files for a zip without Zip64");
  const { time, date } = dosTime(when);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const deflated = deflateRawSync(e.data);
    const stored = deflated.length >= e.data.length;
    const body = stored ? e.data : deflated;
    const crc = crc32(e.data);
    if (e.data.length > MAX || offset > MAX) throw new RangeError("too large for a zip without Zip64");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(UTF8, 8);
    dir.writeUInt16LE(stored ? 0 : 8, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(e.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += local.length + name.length + body.length;
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}
