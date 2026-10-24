// Minimal .zip reader: finds the GBA game inside a zip and unpacks it with pako.
// Plain ES5 so it runs on iOS 9 Safari.
var GameZip = (function () {
  function bytesToString(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i++) {
      s += String.fromCharCode(u8[i]);
    }
    return s;
  }

  function isZip(buffer) {
    var u8 = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    return u8.length === 4 && u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04;
  }

  // Returns { name: 'game.gba', data: ArrayBuffer }. Throws Error with a readable message.
  function extractGame(buffer) {
    var u8 = new Uint8Array(buffer);
    var dv = new DataView(buffer);
    var eocd = -1;
    var stop = Math.max(0, u8.length - 65557);
    for (var i = u8.length - 22; i >= stop; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) {
      throw new Error('This zip file looks damaged. Try downloading it again.');
    }
    var count = dv.getUint16(eocd + 10, true);
    var off = dv.getUint32(eocd + 16, true);
    var best = null;
    var anyFile = null;

    for (var n = 0; n < count; n++) {
      if (off + 46 > u8.length || dv.getUint32(off, true) !== 0x02014b50) { break; }
      var entry = {
        method: dv.getUint16(off + 10, true),
        csize: dv.getUint32(off + 20, true),
        usize: dv.getUint32(off + 24, true),
        local: dv.getUint32(off + 42, true)
      };
      var nameLen = dv.getUint16(off + 28, true);
      var extraLen = dv.getUint16(off + 30, true);
      var commentLen = dv.getUint16(off + 32, true);
      entry.name = bytesToString(u8.subarray(off + 46, off + 46 + nameLen));
      off += 46 + nameLen + extraLen + commentLen;

      if (/\/$/.test(entry.name) || /(^|\/)__MACOSX\//.test(entry.name)) { continue; }
      if (/\.(gba|agb)$/i.test(entry.name)) {
        if (!best || entry.usize > best.usize) { best = entry; }
      } else if (!anyFile || entry.usize > anyFile.usize) {
        anyFile = entry;
      }
    }

    if (!best) {
      if (anyFile && /\.bin$/i.test(anyFile.name)) {
        best = anyFile;
      } else {
        throw new Error('There is no .gba game inside this zip file.');
      }
    }
    if (best.method !== 0 && best.method !== 8) {
      throw new Error('This zip uses a compression type the player cannot open. Re-zip it normally, or unzip it on a computer first.');
    }

    var l = best.local;
    var start = l + 30 + dv.getUint16(l + 26, true) + dv.getUint16(l + 28, true);
    var packed = u8.subarray(start, start + best.csize);
    var out;
    if (best.method === 0) {
      out = new Uint8Array(packed.length);
      out.set(packed);
    } else {
      out = pako.inflateRaw(packed);
    }
    var data = out.buffer;
    if (out.byteOffset !== 0 || out.byteLength !== data.byteLength) {
      data = data.slice(out.byteOffset, out.byteOffset + out.byteLength);
    }
    var shortName = best.name.split('/');
    return { name: shortName[shortName.length - 1], data: data };
  }

  return { isZip: isZip, extractGame: extractGame };
})();
