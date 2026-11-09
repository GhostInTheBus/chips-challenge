// formats.js
// Readers for the original Chip's Challenge for Windows files:
//   CHIPS.DAT  level set (MS format, magic 0x0002AAAC, also reads Lynx 0x0102AAAC)
//   CHIPS.EXE  16 bit Windows NE executable, tile graphics live in its BITMAP resources
//   .zip       the archive.org download, so you can drop the zip as is
// Nothing here touches the DOM, so the same file runs in a browser and in
// JavaScriptCore inside the Mac app.
(function (root) {
  'use strict';

  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const s32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
  const cstr = (b, o, max) => {
    let s = '';
    for (let i = o; i < o + max && b[i]; i++) s += String.fromCharCode(b[i]);
    return s;
  };

  // ---------------------------------------------------------------- CHIPS.DAT
  // Layout (little endian):
  //   u32 magic, u16 level count, then per level:
  //   u16 size, u16 number, u16 time, u16 chips, u16 map detail,
  //   u16 len + top layer RLE, u16 len + bottom layer RLE,
  //   u16 len + optional fields (u8 type, u8 len, data):
  //     3 title, 4 trap links, 5 clone links, 6 password (xor 0x99),
  //     7 hint, 8 plain password, 10 monster list
  //   RLE: 0xFF count tile repeats tile, anything else is a literal tile.
  function parseLevelset(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const magic = u32(b, 0);
    if (magic !== 0x0002AAAC && magic !== 0x0102AAAC && magic !== 0x0003AAAC) {
      throw new Error('Not a Chip\'s Challenge level file (bad magic 0x' + magic.toString(16) + ')');
    }
    const count = u16(b, 4);
    const levels = [];
    let p = 6;
    for (let i = 0; i < count && p + 2 <= b.length; i++) {
      const size = u16(b, p);
      const start = p + 2;
      const lvl = {
        index: i,
        number: u16(b, start),
        time: u16(b, start + 2),
        chips: u16(b, start + 4),
        title: '', password: '', hint: '',
        traps: [], clones: [], monsters: [],
      };
      let q = start + 8;
      const rle = (len) => {
        const out = new Uint8Array(1024);
        let n = 0;
        const end = q + len;
        while (q < end && n < 1024) {
          const t = b[q++];
          if (t === 0xFF) {
            let c = b[q++];
            const v = b[q++];
            while (c-- > 0 && n < 1024) out[n++] = v;
          } else {
            out[n++] = t;
          }
        }
        q = end;
        return out;
      };
      let len = u16(b, q); q += 2;
      lvl.top = rle(len);
      len = u16(b, q); q += 2;
      lvl.bottom = rle(len);
      const optLen = u16(b, q); q += 2;
      const optEnd = Math.min(q + optLen, start + size);
      while (q + 2 <= optEnd) {
        const type = b[q], len = b[q + 1];
        const d = q + 2;
        if (type === 3) lvl.title = cstr(b, d, len);
        else if (type === 4) {
          for (let k = 0; k + 10 <= len; k += 10) {
            lvl.traps.push({ bx: u16(b, d + k), by: u16(b, d + k + 2), tx: u16(b, d + k + 4), ty: u16(b, d + k + 6), flag: u16(b, d + k + 8) });
          }
        } else if (type === 5) {
          for (let k = 0; k + 8 <= len; k += 8) {
            lvl.clones.push({ bx: u16(b, d + k), by: u16(b, d + k + 2), tx: u16(b, d + k + 4), ty: u16(b, d + k + 6) });
          }
        } else if (type === 6) {
          let s = '';
          for (let k = 0; k < len && b[d + k]; k++) s += String.fromCharCode(b[d + k] ^ 0x99);
          lvl.password = s;
        } else if (type === 8) {
          if (!lvl.password) lvl.password = cstr(b, d, len);
        } else if (type === 7) lvl.hint = cstr(b, d, len);
        else if (type === 10) {
          for (let k = 0; k + 2 <= len; k += 2) lvl.monsters.push({ x: b[d + k], y: b[d + k + 1] });
        }
        q = d + len;
      }
      levels.push(lvl);
      p = start + size;
    }
    return { magic, ruleset: magic === 0x0102AAAC ? 'lynx' : 'ms', levels };
  }

  // ------------------------------------------------------------- NE resources
  // A Windows 3.x executable is an MZ stub followed by an NE header. The
  // resource table hangs off the NE header at +0x24: an alignment shift, then
  // type blocks of 12 byte name entries. Bitmaps are type 2 (RT_BITMAP) and
  // are stored as a DIB with no BITMAPFILEHEADER.
  const NE_TYPES = { 1: 'CURSOR', 2: 'BITMAP', 3: 'ICON', 4: 'MENU', 5: 'DIALOG', 6: 'STRING', 9: 'ACCEL', 10: 'RCDATA', 14: 'GROUP_ICON' };

  function neResources(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b[0] !== 0x4D || b[1] !== 0x5A) throw new Error('Not an MZ executable');
    const ne = u32(b, 0x3C);
    if (b[ne] !== 0x4E || b[ne + 1] !== 0x45) throw new Error('Not a 16 bit Windows (NE) executable');
    const rt = ne + u16(b, ne + 0x24);
    const shift = u16(b, rt);
    const nameAt = (off) => { const n = b[rt + off]; let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[rt + off + 1 + i]); return s; };
    const out = [];
    let p = rt + 2;
    for (;;) {
      const tid = u16(b, p);
      if (tid === 0) break;
      const cnt = u16(b, p + 2);
      const type = (tid & 0x8000) ? (NE_TYPES[tid & 0x7FFF] || String(tid & 0x7FFF)) : nameAt(tid);
      p += 8;
      for (let i = 0; i < cnt; i++) {
        const off = u16(b, p) << shift, len = u16(b, p + 2) << shift, rid = u16(b, p + 6);
        const name = (rid & 0x8000) ? String(rid & 0x7FFF) : nameAt(rid);
        out.push({ type, name, data: b.subarray(off, off + len) });
        p += 12;
      }
    }
    return out;
  }

  // Decode a headerless DIB (BITMAPINFOHEADER or BITMAPCOREHEADER) into RGBA.
  // Handles 1/4/8 bpp, BI_RGB, BI_RLE8 and BI_RLE4 (the tile sheet is RLE4).
  function decodeDIB(d) {
    const hs = u32(d, 0);
    let w, h, bpp, comp = 0, nclr = 0, palStride = 4;
    if (hs === 12) { w = u16(d, 4); h = u16(d, 6); bpp = u16(d, 10); palStride = 3; }
    else { w = s32(d, 4); h = s32(d, 8); bpp = u16(d, 14); comp = u32(d, 16); nclr = u32(d, 32); }
    const topDown = h < 0; h = Math.abs(h);
    if (!nclr && bpp <= 8) nclr = 1 << bpp;
    const pal = [];
    for (let i = 0; i < nclr; i++) {
      const o = hs + i * palStride;
      pal.push([d[o + 2], d[o + 1], d[o]]);
    }
    let p = hs + nclr * palStride;
    const idx = new Uint8Array(w * h);
    const set = (x, y, v) => { if (x < w && y < h) idx[(topDown ? y : h - 1 - y) * w + x] = v; };
    if (comp === 0) {
      const stride = ((w * bpp + 31) >> 5) << 2;
      for (let y = 0; y < h; y++) {
        const row = p + y * stride;
        for (let x = 0; x < w; x++) {
          let v;
          if (bpp === 8) v = d[row + x];
          else if (bpp === 4) v = (d[row + (x >> 1)] >> ((x & 1) ? 0 : 4)) & 15;
          else v = (d[row + (x >> 3)] >> (7 - (x & 7))) & 1;
          set(x, y, v);
        }
      }
    } else if (comp === 1 || comp === 2) {
      const rle4 = comp === 2;
      let x = 0, y = 0;
      while (p < d.length) {
        const n = d[p++], v = d[p++];
        if (n > 0) {
          for (let i = 0; i < n; i++) set(x++, y, rle4 ? ((i & 1) ? v & 15 : v >> 4) : v);
        } else if (v === 0) { x = 0; y++; }
        else if (v === 1) break;
        else if (v === 2) { x += d[p++]; y += d[p++]; }
        else {
          const start = p;
          for (let i = 0; i < v; i++) {
            const byte = rle4 ? d[p + (i >> 1)] : d[p + i];
            set(x++, y, rle4 ? ((i & 1) ? byte & 15 : byte >> 4) : byte);
          }
          let used = rle4 ? (v + 1) >> 1 : v;
          if (used & 1) used++;
          p = start + used;
        }
      }
    } else {
      throw new Error('Unsupported bitmap compression ' + comp);
    }
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const c = pal[idx[i]] || [0, 0, 0];
      rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 255;
    }
    return { width: w, height: h, rgba };
  }

  // Pull everything useful out of CHIPS.EXE.
  // Returns { tiles, panel, digits, ending } where tiles is a 320x512 RGBA
  // atlas: columns 0-6 are opaque tiles 0x00-0x6F (tile n at column n>>4,
  // row n&15), columns 7-9 are tiles 0x40-0x6F with real transparency built
  // from the masks in the original sheet's columns 10-12.
  function extractExeGraphics(bytes) {
    const res = neResources(bytes);
    const bmp = (name) => { const r = res.find((x) => x.type === 'BITMAP' && x.name === name); return r ? decodeDIB(r.data) : null; };
    const sheet = bmp('OBJ32_4') || bmp('OBJ32_4E');
    if (!sheet || sheet.width < 416 || sheet.height < 512) throw new Error('Tile sheet not found in CHIPS.EXE');
    const W = 320, H = 512;
    const atlas = new Uint8Array(W * H * 4);
    const src = sheet.rgba, sw = sheet.width;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < 224; x++) {
        const si = (y * sw + x) * 4, di = (y * W + x) * 4;
        atlas[di] = src[si]; atlas[di + 1] = src[si + 1]; atlas[di + 2] = src[si + 2]; atlas[di + 3] = 255;
      }
      for (let x = 224; x < 320; x++) {
        const si = (y * sw + x) * 4, mi = (y * sw + x + 96) * 4, di = (y * W + x) * 4;
        const on = src[mi] > 127;
        atlas[di] = src[si]; atlas[di + 1] = src[si + 1]; atlas[di + 2] = src[si + 2]; atlas[di + 3] = on ? 255 : 0;
      }
    }
    return {
      tiles: { width: W, height: H, rgba: atlas },
      panel: bmp('INFOWND'),
      digits: bmp('200'),
      ending: bmp('CHIPEND'),
      background: bmp('BACKGROUND'),
    };
  }

  // ---------------------------------------------------------------------- zip
  // Minimal zip reader for the archive.org download. Stored entries are read
  // directly; deflated entries go through a caller supplied inflateRaw
  // (DecompressionStream in the browser, the system in the Mac app).
  function zipEntries(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (u32(b, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a zip file');
    const n = u16(b, eocd + 10);
    let p = u32(b, eocd + 16);
    const out = [];
    for (let i = 0; i < n; i++) {
      if (u32(b, p) !== 0x02014b50) break;
      const method = u16(b, p + 10), csize = u32(b, p + 20), usize = u32(b, p + 24);
      const nl = u16(b, p + 28), el = u16(b, p + 30), cl = u16(b, p + 32), lho = u32(b, p + 42);
      let name = ''; for (let k = 0; k < nl; k++) name += String.fromCharCode(b[p + 46 + k]);
      const lnl = u16(b, lho + 26), lel = u16(b, lho + 28);
      const dataStart = lho + 30 + lnl + lel;
      out.push({ name, method, csize, usize, data: b.subarray(dataStart, dataStart + csize) });
      p += 46 + nl + el + cl;
    }
    return out;
  }

  root.CCFormats = { parseLevelset, neResources, decodeDIB, extractExeGraphics, zipEntries };
})(typeof globalThis !== 'undefined' ? globalThis : this);
