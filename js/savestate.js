// Complete save states for GBA.js.
// GBA.js ships unfinished snapshot code (it skips video memory, has a register-restore bug and
// packs numbers as unsigned 32-bit). This captures the machine directly instead.
// The result is a plain object with ArrayBuffers, which IndexedDB can store on iOS 9.
var SaveState = (function () {
  var VERSION = 1;
  var VIDEO_REG_END = 0x56;     // DISPCNT..BLDY
  var written = new Uint8Array(VIDEO_REG_END >> 1);
  var trackedIo = null;

  // Remember which display registers the game has written, so a restore replays only those
  // and leaves the renderer's power-on defaults alone for the rest.
  function attach(gba) {
    var io = gba.io;
    if (trackedIo === io) { return; }
    trackedIo = io;
    var store8 = io.store8, store16 = io.store16, store32 = io.store32;
    io.store8 = function (offset, value) {
      if (offset < VIDEO_REG_END) { written[offset >> 1] = 1; }
      return store8.call(io, offset, value);
    };
    io.store16 = function (offset, value) {
      if (offset < VIDEO_REG_END) { written[offset >> 1] = 1; }
      return store16.call(io, offset, value);
    };
    io.store32 = function (offset, value) {
      if (offset < VIDEO_REG_END) {
        written[offset >> 1] = 1;
        if ((offset >> 1) + 1 < written.length) { written[(offset >> 1) + 1] = 1; }
      }
      return store32.call(io, offset, value);
    };
  }

  function resetTracking() {
    for (var i = 0; i < written.length; i++) { written[i] = 0; }
  }

  function copyBuffer(buf) { return buf.slice(0); }
  function plain(obj) { return JSON.parse(JSON.stringify(obj)); }
  function copyFields(target, source) {
    for (var k in source) {
      if (source.hasOwnProperty(k)) { target[k] = source[k]; }
    }
  }

  function capture(gba) {
    var mmu = gba.mmu;
    var renderer = gba.video.renderPath;
    var irq = gba.irq;

    var video = gba.video.freeze();
    delete video.renderPath;

    var palette = new Uint16Array(512);
    for (var i = 0; i < 512; i++) {
      palette[i] = renderer.palette.loadU16(i << 1);
    }

    return {
      version: VERSION,
      cpu: plain(gba.cpu.freeze()),
      ram: copyBuffer(mmu.memory[mmu.REGION_WORKING_RAM].buffer),
      iram: copyBuffer(mmu.memory[mmu.REGION_WORKING_IRAM].buffer),
      io: copyBuffer(gba.io.registers.buffer),
      irq: plain({
        enable: irq.enable,
        enabledIRQs: irq.enabledIRQs,
        interruptFlags: irq.interruptFlags,
        dma: irq.dma,
        timers: irq.timers,
        nextEvent: irq.nextEvent,
        springIRQ: irq.springIRQ
      }),
      video: plain(video),
      vram: copyBuffer(renderer.vram.buffer.buffer),
      oam: copyBuffer(renderer.oam.buffer.buffer),
      palette: palette.buffer,
      written: copyBuffer(written.buffer),
      audio: plain(gba.audio.freeze())
    };
  }

  function restore(gba, s) {
    if (!s || s.version !== VERSION) { throw new Error('Unknown save state format'); }
    var mmu = gba.mmu;
    var renderer = gba.video.renderPath;
    var irq = gba.irq;
    var io = gba.io;

    gba.cpu.defrost(s.cpu);
    mmu.memory[mmu.REGION_WORKING_RAM].replaceData(copyBuffer(s.ram));
    mmu.memory[mmu.REGION_WORKING_IRAM].replaceData(copyBuffer(s.iram));
    gba.audio.defrost(s.audio);

    var video = plain(s.video);
    video.renderPath = null;
    gba.video.defrost(video);

    // Back to power-on display settings, then put the saved memories back.
    renderer.clear(mmu);
    mmu.mmap(mmu.REGION_PALETTE_RAM, renderer.palette);
    mmu.mmap(mmu.REGION_VRAM, renderer.vram);
    mmu.mmap(mmu.REGION_OAM, renderer.oam);
    renderer.vram.buffer.set(new Uint16Array(s.vram));
    renderer.oam.overwrite(new Uint16Array(s.oam));
    renderer.palette.overwrite(new Uint16Array(s.palette));

    // Copy into the existing DMA/timer objects: other parts of the core hold references to them.
    for (var d = 0; d < 4; d++) { copyFields(irq.dma[d], s.irq.dma[d]); }
    for (var t = 0; t < 4; t++) { copyFields(irq.timers[t], s.irq.timers[t]); }
    irq.defrost({
      enable: s.irq.enable,
      enabledIRQs: s.irq.enabledIRQs,
      interruptFlags: s.irq.interruptFlags,
      dma: irq.dma,
      timers: irq.timers,
      nextEvent: s.irq.nextEvent,
      springIRQ: s.irq.springIRQ
    });

    // I/O registers, then replay the display registers the game had set.
    var regs = new Uint16Array(copyBuffer(s.io));
    var savedWritten = new Uint8Array(s.written);
    io.registers.set(regs);
    resetTracking();
    for (var r = 0; r < VIDEO_REG_END; r += 2) {
      if (savedWritten[r >> 1]) { io.store16(r, regs[r >> 1]); }
    }
    io.store16(io.WAITCNT, regs[io.WAITCNT >> 1]);
  }

  return { attach: attach, resetTracking: resetTracking, capture: capture, restore: restore };
})();
