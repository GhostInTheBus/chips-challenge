// midi.js
// Tiny Standard MIDI File player on Web Audio, for CHIP01.MID / CHIP02.MID.
// Browsers have no General MIDI synth, so this one fakes it: oscillators for
// pitched channels, filtered noise for the drum channel. It's meant to sound
// like a 1992 sound card, which is fair.
(function (root) {
  'use strict';

  function parseMidi(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let p = 0;
    const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[p + i]); p += n; return s; };
    const u32 = () => { const v = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0; p += 4; return v; };
    const u16 = () => { const v = b[p] << 8 | b[p + 1]; p += 2; return v; };
    const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; };
    if (str(4) !== 'MThd') throw new Error('Not a MIDI file');
    const hl = u32(); const fmt = u16(); const ntr = u16(); const div = u16(); p += hl - 6;
    const events = [];
    for (let t = 0; t < ntr; t++) {
      if (str(4) !== 'MTrk') break;
      const len = u32(); const end = p + len;
      let tick = 0, status = 0;
      while (p < end) {
        tick += vlq();
        let s = b[p];
        if (s & 0x80) { p++; status = s; } else s = status;
        const hi = s & 0xf0, ch = s & 0x0f;
        if (s === 0xff) {
          const type = b[p++]; const l = vlq();
          if (type === 0x51) events.push({ tick, type: 'tempo', us: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] });
          p += l;
        } else if (s === 0xf0 || s === 0xf7) { p += vlq(); }
        else if (hi === 0x90 || hi === 0x80) {
          const n = b[p++], v = b[p++];
          events.push({ tick, type: (hi === 0x90 && v > 0) ? 'on' : 'off', ch, n, v });
        } else if (hi === 0xc0) { events.push({ tick, type: 'prog', ch, prog: b[p++] }); }
        else if (hi === 0xd0) { p += 1; }
        else if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
          const a = b[p++], c = b[p++];
          if (hi === 0xb0 && a === 7) events.push({ tick, type: 'vol', ch, v: c });
        } else { p++; }
      }
      p = end;
    }
    events.sort((x, y) => x.tick - y.tick);
    // ticks -> seconds with the tempo map, pair notes
    let us = 500000, lastTick = 0, sec = 0;
    const open = {}, notes = [], prog = new Array(16).fill(0), vol = new Array(16).fill(100);
    for (const e of events) {
      sec += ((e.tick - lastTick) * us) / (div * 1e6); lastTick = e.tick;
      if (e.type === 'tempo') us = e.us;
      else if (e.type === 'prog') prog[e.ch] = e.prog;
      else if (e.type === 'vol') vol[e.ch] = e.v;
      else if (e.type === 'on') { open[e.ch * 128 + e.n] = { t: sec, n: e.n, v: e.v, ch: e.ch, prog: prog[e.ch], vol: vol[e.ch] }; }
      else if (e.type === 'off') {
        const k = e.ch * 128 + e.n, o = open[k];
        if (o) { o.d = Math.max(0.03, sec - o.t); notes.push(o); delete open[k]; }
      }
    }
    // Windows 3.1 "dual mode" MIDI: channels 1-10 carry the part for extended
    // synths and 13-16 repeat it for base level synths (drums on 16). Play one.
    let keep = notes;
    if (notes.some((x) => x.ch <= 9) && notes.some((x) => x.ch >= 12)) keep = notes.filter((x) => x.ch <= 9);
    else if (notes.every((x) => x.ch >= 12)) keep = notes.map((x) => Object.assign(x, { ch: x.ch === 15 ? 9 : x.ch }));
    return { notes: keep.sort((a, c) => a.t - c.t), length: sec };
  }

  class MidiPlayer {
    constructor(ctx, out) {
      this.ctx = ctx; this.out = out; this.song = null; this.timer = null; this.voices = new Set();
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    play(song) {
      this.stop();
      this.song = song; this.idx = 0; this.start = this.ctx.currentTime + 0.1;
      this.timer = setInterval(() => this.pump(), 50);
      this.pump();
    }
    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      for (const v of this.voices) { try { v.stop(); } catch (e) { /* already stopped */ } }
      this.voices.clear();
    }
    pump() {
      const s = this.song; if (!s) return;
      const horizon = this.ctx.currentTime + 0.25;
      for (;;) {
        if (this.idx >= s.notes.length) { this.start += s.length + 0.5; this.idx = 0; }
        const n = s.notes[this.idx];
        const at = this.start + n.t;
        if (at > horizon) break;
        if (at >= this.ctx.currentTime - 0.05) this.voice(n, at);
        this.idx++;
      }
    }
    voice(n, at) {
      const ctx = this.ctx;
      const g = ctx.createGain();
      const amp = 0.09 * (n.v / 127) * (n.vol / 127);
      let src;
      if (n.ch === 9) {
        src = ctx.createBufferSource(); src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        const kick = n.n <= 36, snare = n.n === 38 || n.n === 40;
        f.type = kick ? 'lowpass' : (snare ? 'bandpass' : 'highpass');
        f.frequency.value = kick ? 160 : (snare ? 1800 : 7000);
        src.connect(f); f.connect(g);
        const dur = kick ? 0.18 : (snare ? 0.14 : 0.05);
        g.gain.setValueAtTime(amp * (kick ? 4 : 2), at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        src.start(at); src.stop(at + dur + 0.02);
      } else {
        src = ctx.createOscillator();
        const p = n.prog;
        src.type = p < 8 ? 'triangle' : p < 32 ? 'sine' : p < 40 ? 'triangle' : p < 80 ? 'sawtooth' : 'square';
        src.frequency.value = 440 * Math.pow(2, (n.n - 69) / 12);
        src.connect(g);
        const end = at + n.d;
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(amp, at + 0.01);
        g.gain.setTargetAtTime(amp * 0.6, at + 0.02, 0.1);
        g.gain.setTargetAtTime(0, end, 0.04);
        src.start(at); src.stop(end + 0.25);
      }
      g.connect(this.out);
      this.voices.add(src);
      src.onended = () => this.voices.delete(src);
    }
  }

  // Rewrite a dual mode file so only one copy of the music plays. Used by the
  // Mac app, whose General MIDI synth would otherwise play both copies.
  function singleMode(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let p = 0;
    const u32 = () => { const v = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0; p += 4; return v; };
    const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; };
    p = 8 + 2; const ntr = (b[p + 0] << 8) | b[p + 1]; p = 8 + u32Peek(b, 4);
    function u32Peek(a, o) { return (a[o] << 24 | a[o + 1] << 16 | a[o + 2] << 8 | a[o + 3]) >>> 0; }
    const tracks = [];
    const used = new Set();
    for (let t = 0; t < ntr && p < b.length; t++) {
      p += 4; const len = u32(); const end = p + len; const evs = [];
      let status = 0;
      while (p < end) {
        const delta = vlq(); const start = p;
        let s = b[p], running = false;
        if (s & 0x80) { p++; status = s; } else { s = status; running = true; }
        let data;
        if (s === 0xff) { const type = b[p++]; const l = vlq(); data = [0xff, type].concat(vlqBytes(l), Array.from(b.subarray(p, p + l))); p += l; evs.push({ delta, data, ch: -1 }); continue; }
        if (s === 0xf0 || s === 0xf7) { const l = vlq(); data = [s].concat(vlqBytes(l), Array.from(b.subarray(p, p + l))); p += l; evs.push({ delta, data, ch: -1 }); continue; }
        const hi = s & 0xf0, n = (hi === 0xc0 || hi === 0xd0) ? 1 : 2;
        data = [s].concat(Array.from(b.subarray(p, p + n))); p += n;
        if (hi === 0x90) used.add(s & 15);
        evs.push({ delta, data, ch: s & 15 });
        void start; void running;
      }
      p = end; tracks.push(evs);
    }
    const hasLow = [...used].some((c) => c <= 9), hasHigh = [...used].some((c) => c >= 12);
    const drop = (c) => hasLow && hasHigh && c >= 12;
    const out = [];
    const push32 = (v) => out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
    for (let i = 0; i < 14; i++) out.push(b[i]);
    for (const evs of tracks) {
      const body = []; let carry = 0;
      for (const e of evs) {
        if (e.ch >= 0 && drop(e.ch)) { carry += e.delta; continue; }
        body.push(...vlqBytes(e.delta + carry), ...e.data); carry = 0;
      }
      out.push(0x4d, 0x54, 0x72, 0x6b); push32(body.length); out.push(...body);
    }
    return new Uint8Array(out);
  }
  function vlqBytes(v) {
    const o = [v & 0x7f]; v >>>= 7;
    while (v) { o.unshift((v & 0x7f) | 0x80); v >>>= 7; }
    return o;
  }

  root.CCMidi = { parseMidi, MidiPlayer, singleMode };
})(typeof globalThis !== 'undefined' ? globalThis : this);
