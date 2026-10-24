// GBA Player - UI, touch controls and run loop around the GBA.js core.
// Written in plain ES5 (no let/const/arrows/classes) so it runs on iOS 9 Safari (iPad 3).
(function () {
  'use strict';

  var FRAME_MS = 1000 / 59.7275;          // GBA refresh rate
  var KEY = { A: 0, B: 1, SELECT: 2, START: 3, RIGHT: 4, LEFT: 5, UP: 6, DOWN: 7, R: 8, L: 9 };
  var SKIP_CHOICES = [0, 1, 2, 3, 5];
  var SAVE_PREFIX = 'com.endrift.gbajs.';  // where GBA.js keeps in-game saves (localStorage)

  function $(id) { return document.getElementById(id); }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame ||
    function (f) { return setTimeout(function () { f(now()); }, 16); };
  var caf = window.cancelAnimationFrame || window.webkitCancelAnimationFrame || clearTimeout;

  function addClass(el, c) { if (!el.classList.contains(c)) { el.classList.add(c); } }
  function removeClass(el, c) { if (el.classList.contains(c)) { el.classList.remove(c); } }
  function show(el) { removeClass(el, 'hidden'); }
  function hide(el) { addClass(el, 'hidden'); }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function formatSize(bytes) {
    if (bytes >= 1048576) { return (bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1) + ' MB'; }
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  // ---------- Settings ----------
  var settings = { sound: true, maxSkip: 3, fps: false, smooth: false };
  function loadSettings() {
    try {
      var raw = localStorage.getItem('gbaplayer.settings');
      if (raw) {
        var s = JSON.parse(raw);
        for (var k in settings) {
          if (settings.hasOwnProperty(k) && s.hasOwnProperty(k)) { settings[k] = s[k]; }
        }
      }
    } catch (e) { /* private mode */ }
  }
  function storeSettings() {
    try { localStorage.setItem('gbaplayer.settings', JSON.stringify(settings)); } catch (e) {}
  }

  // ---------- Emulator ----------
  var gba = null;
  var canvas = $('screen');
  var running = false;
  var skipRender = false;
  var rafId = null;
  var lastTick = 0;
  var acc = 0;
  var speed = 1;
  var current = null;        // { key, name }
  var lastError = null;
  var audioUnlocked = false;

  function base64ToBuffer(b64) {
    var bin = atob(b64);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { u8[i] = bin.charCodeAt(i); }
    return u8.buffer;
  }

  function createEmulator() {
    try {
      gba = new GameBoyAdvance();
    } catch (e) {
      gba = null;
      return false;
    }
    gba.keypad.eatInput = false;
    gba.logLevel = gba.LOG_ERROR;
    gba.setLogger(function (level, message) {
      if (level === gba.LOG_ERROR || level === -1) { lastError = String(message); }
    });
    gba.setBios(base64ToBuffer(GBA_BIOS_BASE64));
    gba.setCanvasDirect(canvas);
    SaveState.attach(gba);

    // Frame skip: when the iPad can't keep up, emulate frames without drawing them.
    var renderer = gba.video.renderPath;
    var drawScanline = renderer.drawScanline;
    renderer.drawScanline = function (y) {
      if (!skipRender) { drawScanline.call(renderer, y); }
    };
    gba.video.finishDraw = function (pixelData) {
      if (!skipRender) { this.context.putImageData(pixelData, 0, 0); }
    };

    // Sound switch: keep the audio node unplugged while sound is off (saves CPU).
    var audio = gba.audio;
    if (audio.context && audio.jsAudio) {
      try {
        var node = audio.jsAudio;
        var proto = Object.getPrototypeOf(node);
        node.connect = function (dest) {
          if (settings.sound) { proto.connect.call(node, dest); }
        };
      } catch (e) {}
    }
    return true;
  }

  function unlockAudio() {
    if (audioUnlocked || !gba || !gba.audio.context) { return; }
    var ctx = gba.audio.context;
    try {
      var buf = ctx.createBuffer(1, 1, 22050);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      if (src.start) { src.start(0); } else if (src.noteOn) { src.noteOn(0); }
      if (ctx.resume) { ctx.resume(); }
      audioUnlocked = true;
    } catch (e) {}
  }

  function applySound() {
    if (!gba) { return; }
    var audio = gba.audio;
    audio.masterEnable = !!settings.sound;
    if (!audio.context) { return; }
    if (settings.sound && running && audio.enabled) {
      audio.jsAudio.connect(audio.context.destination);
    } else if (!settings.sound) {
      try { audio.jsAudio.disconnect(); } catch (e) {}
    }
  }

  var fpsFrames = 0, fpsDrawn = 0, fpsStart = 0;
  var fpsEl = $('fps');

  function loop(t) {
    if (!running) { return; }
    rafId = raf(loop);
    t = now();
    if (!lastTick) { lastTick = t; fpsStart = t; return; }
    var dt = t - lastTick;
    lastTick = t;
    if (dt > 250) { dt = FRAME_MS; }   // came back from a pause
    acc += dt * speed;
    var n = Math.floor(acc / FRAME_MS);
    if (n < 1) { return; }
    var maxFrames = (1 + settings.maxSkip) * speed;
    if (n > maxFrames) {
      n = maxFrames;
      acc = 0;                          // running slow: let the game slow down rather than spiral
    } else {
      acc -= n * FRAME_MS;
    }
    try {
      for (var i = 0; i < n; i++) {
        skipRender = i < n - 1;
        gba.advanceFrame();
      }
    } catch (e) {
      skipRender = false;
      crashed(e);
      return;
    }
    skipRender = false;

    fpsFrames += n;
    fpsDrawn += 1;
    if (settings.fps && t - fpsStart >= 1000) {
      var secs = (t - fpsStart) / 1000;
      var gameFps = Math.round(fpsFrames / secs);
      fpsEl.innerHTML = gameFps + ' fps (' + Math.round(gameFps / 0.597275) + '% speed, ' +
        Math.round(fpsDrawn / secs) + ' drawn)';
      fpsFrames = 0; fpsDrawn = 0; fpsStart = t;
    } else if (!settings.fps && t - fpsStart >= 1000) {
      fpsFrames = 0; fpsDrawn = 0; fpsStart = t;
    }
  }

  function resume() {
    if (!gba || !gba.hasRom() || running) { return; }
    running = true;
    lastTick = 0;
    acc = 0;
    gba.paused = false;
    if (settings.sound) { gba.audio.pause(false); }
    applySound();
    rafId = raf(loop);
  }

  function pause() {
    if (!running) { return; }
    running = false;
    if (rafId !== null) { caf(rafId); rafId = null; }
    gba.paused = true;
    gba.audio.pause(true);
    flushSave();
  }

  function flushSave() {
    if (!gba || !gba.hasRom() || !gba.mmu.save) { return; }
    try {
      if (gba.mmu.saveNeedsFlush()) { gba.mmu.flushSave(); }
      gba.storeSavedata();
    } catch (e) {}
  }

  function crashed(e) {
    running = false;
    if (rafId !== null) { caf(rafId); rafId = null; }
    try { gba.audio.pause(true); } catch (x) {}
    flushSave();
    var detail = lastError || (e && e.message) || String(e);
    dialog('The game stopped',
      '<p>The emulator hit something in this game it can\'t handle yet. Some games don\'t run in this emulator.</p>' +
      '<p style="font-size:13px;color:#6b675d">' + escapeHtml(detail) + '</p>',
      [{ label: 'Back to games', action: quitToLibrary },
       { label: 'Restart game', go: true, action: function () { restartGame(); } }]);
  }

  function readHeaderTitle(buffer) {
    try {
      var u8 = new Uint8Array(buffer, 0xA0, 12);
      var s = '';
      for (var i = 0; i < u8.length; i++) {
        if (u8[i] === 0) { break; }
        if (u8[i] >= 32 && u8[i] < 127) { s += String.fromCharCode(u8[i]); }
      }
      return s.replace(/^\s+|\s+$/g, '');
    } catch (e) { return ''; }
  }

  function looksLikeGba(buffer) {
    if (!buffer || buffer.byteLength < 0xC0) { return false; }
    return new Uint8Array(buffer, 0xB2, 1)[0] === 0x96;   // fixed value in every GBA header
  }

  // Turns whatever the user picked into a playable buffer. Throws readable errors.
  function prepareRom(buffer, fileName) {
    var name = fileName || '';
    if (GameZip.isZip(buffer)) {
      var inner = GameZip.extractGame(buffer);
      buffer = inner.data;
      name = inner.name;
    } else if (/\.(7z|rar)$/i.test(name)) {
      throw new Error('This is a .' + name.split('.').pop() + ' archive. The player can open .gba and .zip files.');
    }
    if (!looksLikeGba(buffer)) {
      if (/\.gbc?$/i.test(name)) {
        throw new Error('That looks like a Game Boy or Game Boy Color game. This player only runs Game Boy Advance games (.gba).');
      }
      throw new Error('This file doesn\'t look like a Game Boy Advance game. Pick a .gba file, or a .zip that has one inside.');
    }
    return { data: buffer, name: name };
  }

  function startGame(buffer, info) {
    if (!gba && !createEmulator()) {
      dialog('Can\'t start the emulator', '<p>This browser is missing features the emulator needs.</p>', null);
      return;
    }
    if (running) { pause(); }
    lastError = null;
    var ok = false;
    try {
      SaveState.resetTracking();
      ok = gba.setRom(buffer);
    } catch (e) {
      lastError = e.message || String(e);
    }
    if (!ok) {
      dialog('Couldn\'t load the game', '<p>The emulator could not read this game file.</p>' +
        (lastError ? '<p style="font-size:13px;color:#6b675d">' + escapeHtml(lastError) + '</p>' : ''), null);
      return;
    }
    current = info;
    hide($('library'));
    show($('player'));
    layout();
    updateFastButton();
    resume();
  }

  function restartGame() {
    hide($('dialog'));
    hide($('sheet'));
    if (!current) { return; }
    loadGameByKey(current, true);
  }

  // Re-fetches the ROM for the current game and starts it from power-on.
  var lastRomBuffer = null;
  function loadGameByKey(info) {
    if (lastRomBuffer) {
      // GBA.js keeps a reference; reloading from our own copy is simplest.
      startGame(lastRomBuffer, info);
    }
  }

  function quitToLibrary() {
    hide($('dialog'));
    hide($('sheet'));
    pause();
    current = null;
    setTouchMask(0);
    hide($('player'));
    show($('library'));
    renderLibrary();
  }

  // ---------- Layout ----------
  var el = {
    bezel: $('bezel'), topbar: $('topbar'),
    l: $('btn-l'), r: $('btn-r'), a: $('btn-a'), b: $('btn-b'),
    start: $('btn-start'), select: $('btn-select'), dpad: $('dpad')
  };

  function place(node, x, y, w, h) {
    var s = node.style;
    s.left = Math.round(x) + 'px';
    s.top = Math.round(y) + 'px';
    s.width = Math.round(w) + 'px';
    s.height = Math.round(h) + 'px';
  }

  var dpadZone = { cx: 0, cy: 0, r: 0 };
  var buttonZones = [];

  function layout() {
    var W = window.innerWidth;
    var H = window.innerHeight;
    var land = W > H;
    var u = Math.min(W, H) / 768;
    if (u > 1.25) { u = 1.25; }
    if (u < 0.45) { u = 0.45; }

    var dp = 200 * u;      // d-pad size
    var face = 92 * u;     // A/B diameter
    var shW = 130 * u, shH = 54 * u;
    var smW = 64 * u, smH = 22 * u;
    var bezelPad = 12 * u;
    var sw, sh, sx, sy, dpadC, faceC, smY;

    if (land) {
      var side = Math.max(dp + 60 * u, 250 * u);
      var maxW = W - side * 2;
      var maxH = H - 54 * u - 76 * u;
      sw = Math.min(maxW, maxH * 1.5);
      sh = sw / 1.5;
      sx = (W - sw) / 2;
      sy = 54 * u + Math.max(0, (maxH - sh) / 2);
      dpadC = { x: side / 2, y: H * 0.6 };
      faceC = { x: W - side / 2, y: H * 0.6 };
      smY = sy + sh + bezelPad + 14 * u;
      place(el.l, 14 * u, 14 * u, shW, shH);
      place(el.r, W - 14 * u - shW, 14 * u, shW, shH);
    } else {
      sw = W - 2 * (bezelPad + 14 * u);
      sh = sw / 1.5;
      if (sh > H * 0.48) { sh = H * 0.48; sw = sh * 1.5; }
      sx = (W - sw) / 2;
      sy = 60 * u;
      var ctrlTop = sy + sh + bezelPad;
      var ctrlH = H - ctrlTop;
      dpadC = { x: Math.max(W * 0.26, dp / 2 + 30 * u), y: ctrlTop + ctrlH * 0.5 };
      faceC = { x: Math.min(W * 0.74, W - (face * 1.1 + 30 * u)), y: ctrlTop + ctrlH * 0.5 };
      smY = H - 64 * u;
      place(el.l, 14 * u, ctrlTop + 16 * u, shW, shH);
      place(el.r, W - 14 * u - shW, ctrlTop + 16 * u, shW, shH);
    }

    place(canvas, bezelPad, bezelPad, sw, sh);
    place(el.bezel, sx - bezelPad, sy - bezelPad, sw + bezelPad * 2, sh + bezelPad * 2 + 16 * u);
    canvas.style.left = Math.round(bezelPad) + 'px';
    canvas.style.top = Math.round(bezelPad) + 'px';
    if (settings.smooth) { addClass(canvas, 'smooth'); } else { removeClass(canvas, 'smooth'); }

    var tb = el.topbar.style;
    tb.left = '0px'; tb.right = '0px';
    tb.top = Math.round(Math.max(6, (sy - bezelPad - 34) / 2)) + 'px';

    place(el.dpad, dpadC.x - dp / 2, dpadC.y - dp / 2, dp, dp);

    // A up-right, B down-left, like the real thing
    place(el.a, faceC.x + face * 0.05, faceC.y - face * 0.85, face, face);
    place(el.b, faceC.x - face * 1.05, faceC.y - face * 0.15, face, face);
    el.a.style.lineHeight = Math.round(face) + 'px';
    el.b.style.lineHeight = Math.round(face) + 'px';
    el.a.style.fontSize = el.b.style.fontSize = Math.round(30 * u) + 'px';
    el.l.style.lineHeight = el.r.style.lineHeight = Math.round(shH) + 'px';

    var smBox = smW + 26 * u;
    place(el.select, W / 2 - smBox - 10 * u, smY, smBox, smH + 30 * u);
    place(el.start, W / 2 + 10 * u, smY, smBox, smH + 30 * u);
    var icons = [el.select.getElementsByTagName('i')[0], el.start.getElementsByTagName('i')[0]];
    for (var i = 0; i < icons.length; i++) {
      icons[i].style.width = Math.round(smW) + 'px';
      icons[i].style.height = Math.round(smH) + 'px';
      icons[i].style.marginTop = Math.round(6 * u) + 'px';
    }

    computeZones();
  }

  function computeZones() {
    var r = el.dpad.getBoundingClientRect();
    dpadZone = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 };
    buttonZones = [];
    var list = [el.a, el.b, el.l, el.r, el.start, el.select];
    for (var i = 0; i < list.length; i++) {
      var b = list[i].getBoundingClientRect();
      var padX = Math.min(b.width, b.height) * 0.22;
      buttonZones.push({
        node: list[i],
        mask: 1 << parseInt(list[i].getAttribute('data-key'), 10),
        x1: b.left - padX, y1: b.top - padX, x2: b.right + padX, y2: b.bottom + padX
      });
    }
  }

  // ---------- Touch controls ----------
  var touchMask = 0;

  function hitTest(x, y) {
    var m = 0;
    var dx = x - dpadZone.cx, dy = y - dpadZone.cy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < dpadZone.r * 1.4 && dist > dpadZone.r * 0.16) {
      var ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax > ay * 0.45) { m |= 1 << (dx > 0 ? KEY.RIGHT : KEY.LEFT); }
      if (ay > ax * 0.45) { m |= 1 << (dy > 0 ? KEY.DOWN : KEY.UP); }
      return m;
    }
    for (var i = 0; i < buttonZones.length; i++) {
      var z = buttonZones[i];
      if (x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) { m |= z.mask; }
    }
    return m;
  }

  function setTouchMask(m) {
    if (m === touchMask) { return; }
    if (gba) {
      var released = touchMask & ~m;
      var pressed = m & ~touchMask;
      gba.keypad.currentDown = (gba.keypad.currentDown | released) & ~pressed & 0x3FF;
    }
    touchMask = m;
    for (var i = 0; i < buttonZones.length; i++) {
      if (m & buttonZones[i].mask) { addClass(buttonZones[i].node, 'on'); } else { removeClass(buttonZones[i].node, 'on'); }
    }
    var d = el.dpad;
    if (m & (1 << KEY.UP)) { addClass(d, 'u'); } else { removeClass(d, 'u'); }
    if (m & (1 << KEY.DOWN)) { addClass(d, 'd'); } else { removeClass(d, 'd'); }
    if (m & (1 << KEY.LEFT)) { addClass(d, 'l'); } else { removeClass(d, 'l'); }
    if (m & (1 << KEY.RIGHT)) { addClass(d, 'r'); } else { removeClass(d, 'r'); }
  }

  function onTouch(e) {
    e.preventDefault();
    var m = 0;
    for (var i = 0; i < e.touches.length; i++) {
      m |= hitTest(e.touches[i].clientX, e.touches[i].clientY);
    }
    setTouchMask(m);
  }

  var mouseDown = false;
  function onMouse(e) {
    if (e.type === 'mousedown') { mouseDown = true; }
    if (e.type === 'mouseup') { mouseDown = false; }
    if (!mouseDown) { setTouchMask(0); return; }
    e.preventDefault();
    setTouchMask(hitTest(e.clientX, e.clientY));
  }

  var pad = $('pad');
  pad.addEventListener('touchstart', onTouch, false);
  pad.addEventListener('touchmove', onTouch, false);
  pad.addEventListener('touchend', onTouch, false);
  pad.addEventListener('touchcancel', onTouch, false);
  pad.addEventListener('mousedown', onMouse, false);
  window.addEventListener('mousemove', onMouse, false);
  window.addEventListener('mouseup', onMouse, false);

  document.addEventListener('touchstart', unlockAudio, false);
  document.addEventListener('touchend', unlockAudio, false);
  document.addEventListener('click', unlockAudio, false);

  // Stop the page from rubber-banding while playing.
  $('player').addEventListener('touchmove', function (e) { e.preventDefault(); }, false);

  // ---------- Top bar & menu ----------
  function updateFastButton() {
    var b = $('fast-btn');
    if (speed > 1) { addClass(b, 'on'); b.innerHTML = 'Fast 2x'; } else { removeClass(b, 'on'); b.innerHTML = 'Fast'; }
  }
  tap($('fast-btn'), function () {
    speed = speed > 1 ? 1 : 2;
    acc = 0;
    updateFastButton();
  });

  tap($('menu-btn'), openMenu);

  function openMenu() {
    pause();
    setTouchMask(0);
    $('sheet-title').innerHTML = current ? escapeHtml(current.name) : 'Paused';
    refreshMenu();
    show($('sheet'));
  }
  function closeMenu() {
    hide($('sheet'));
    resume();
  }

  function refreshMenu() {
    $('m-sound').getElementsByTagName('b')[0].innerHTML = settings.sound ? 'On' : 'Off';
    $('m-skip').getElementsByTagName('b')[0].innerHTML = settings.maxSkip ? 'Up to ' + settings.maxSkip : 'Off';
    $('m-fps').getElementsByTagName('b')[0].innerHTML = settings.fps ? 'On' : 'Off';
    $('m-smooth').getElementsByTagName('b')[0].innerHTML = settings.smooth ? 'On' : 'Off';
    $('m-save-note').innerHTML = '';
    if (current) {
      GameStore.get('states', current.key, function (err, rec) {
        if (rec && rec.when) {
          $('m-save-note').innerHTML = 'last saved ' + new Date(rec.when).toLocaleString();
        }
      });
    }
  }

  tap($('m-resume'), closeMenu);
  tap($('m-sound'), function () { settings.sound = !settings.sound; storeSettings(); refreshMenu(); });
  tap($('m-skip'), function () {
    var i = SKIP_CHOICES.indexOf(settings.maxSkip);
    settings.maxSkip = SKIP_CHOICES[(i + 1) % SKIP_CHOICES.length];
    storeSettings(); refreshMenu();
  });
  tap($('m-fps'), function () {
    settings.fps = !settings.fps; storeSettings(); refreshMenu();
    if (settings.fps) { fpsEl.innerHTML = ''; show(fpsEl); } else { hide(fpsEl); }
  });
  tap($('m-smooth'), function () { settings.smooth = !settings.smooth; storeSettings(); refreshMenu(); layout(); });
  tap($('m-reset'), function () {
    dialog('Restart game?', '<p>Anything not saved in the game (or in a save state) will be lost.</p>',
      [{ label: 'Cancel', action: function () { hide($('dialog')); } },
       { label: 'Restart', go: true, action: restartGame }]);
  });
  tap($('m-quit'), quitToLibrary);
  tap($('m-save'), saveState);
  tap($('m-load'), loadState);

  // ---------- Save states ----------
  function saveState() {
    if (!gba || !current) { return; }
    var snapshot;
    try {
      snapshot = SaveState.capture(gba);
    } catch (e) {
      toast('Couldn\'t make a save state for this game.');
      return;
    }
    var rec = { id: current.key, state: snapshot, when: Date.now() };
    GameStore.put('states', rec, function (err) {
      if (err) {
        toast('Couldn\'t store the save state. The iPad may be out of website storage.');
      } else {
        toast(GameStore.isPersistent() ? 'State saved.' : 'State saved until you close this page.');
        refreshMenu();
      }
    });
  }

  function loadState() {
    if (!gba || !current) { return; }
    GameStore.get('states', current.key, function (err, rec) {
      if (!rec || !rec.state) {
        toast('No save state yet. Use Save state first.');
        return;
      }
      try {
        SaveState.restore(gba, rec.state);
      } catch (e) {
        toast('This save state couldn\'t be loaded.');
        return;
      }
      hide($('sheet'));
      resume();
      toast('State loaded.');
    });
  }

  // ---------- Dialogs ----------
  function dialog(title, html, buttons) {
    $('dlg-title').innerHTML = escapeHtml(title);
    $('dlg-body').innerHTML = html;
    var box = $('dlg-buttons');
    box.innerHTML = '';
    buttons = buttons || [{ label: 'OK', go: true, action: function () { hide($('dialog')); } }];
    // floated right, so add in reverse to keep reading order
    for (var i = buttons.length - 1; i >= 0; i--) {
      (function (b) {
        var node = document.createElement('button');
        node.type = 'button';
        node.innerHTML = escapeHtml(b.label);
        if (b.go) { node.className = 'go'; }
        tap(node, b.action);
        box.appendChild(node);
      })(buttons[i]);
    }
    show($('dialog'));
  }

  var toastTimer = null;
  function toast(text) {
    var t = $('toast');
    t.innerHTML = escapeHtml(text);
    show(t);
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { hide(t); }, 2600);
  }

  function busy(text) {
    if (text) { $('busy-text').innerHTML = escapeHtml(text); show($('busy')); } else { hide($('busy')); }
  }

  // Fast, reliable taps on old iOS (avoids the 300ms click delay and ghost clicks).
  function tap(node, fn) {
    var touched = false;
    var startX = 0, startY = 0, moved = false;
    node.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      startX = t.clientX; startY = t.clientY; moved = false;
    }, false);
    node.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) { moved = true; }
    }, false);
    node.addEventListener('touchend', function (e) {
      touched = true;
      setTimeout(function () { touched = false; }, 600);
      if (moved) { return; }   // it was a scroll, not a tap
      e.preventDefault();
      unlockAudio();
      fn(e);
    }, false);
    node.addEventListener('click', function (e) {
      if (touched) { return; }
      fn(e);
    }, false);
  }

  // ---------- Library ----------
  function renderLibrary() {
    GameStore.list('meta', function (err, items) {
      items = items || [];
      items.sort(function (a, b) { return (b.lastPlayed || b.added || 0) - (a.lastPlayed || a.added || 0); });
      var box = $('carts-device');
      box.innerHTML = '';
      for (var i = 0; i < items.length; i++) { box.appendChild(makeCart(items[i], true)); }
      if (items.length) { hide($('empty-device')); } else { show($('empty-device')); }
    });

    var site = window.SITE_GAMES || [];
    var siteBox = $('carts-site');
    siteBox.innerHTML = '';
    for (var j = 0; j < site.length; j++) {
      siteBox.appendChild(makeCart({ id: 'site:' + site[j].file, name: site[j].name, file: site[j].file }, false));
    }
    if (site.length) { show($('shelf-site')); } else { hide($('shelf-site')); }
  }

  function makeCart(item, stored) {
    var node = document.createElement('div');
    node.className = 'cart';
    var meta = stored ? formatSize(item.size || 0) : 'Hosted on this site';
    node.innerHTML = '<div class="label"><span class="name">' + escapeHtml(item.name) + '</span>' +
      '<span class="meta">' + escapeHtml(meta) + '</span></div>';
    tap(node, function (e) {
      var t = e && e.target;
      if (t && t.className === 'remove') { return; }
      if (stored) { playStored(item); } else { playFromUrl(item.file, item.name, item.id); }
    });
    if (stored) {
      var rm = document.createElement('button');
      rm.className = 'remove';
      rm.type = 'button';
      rm.innerHTML = '&times;';
      rm.setAttribute('aria-label', 'Remove ' + item.name);
      tap(rm, function (e) {
        if (e && e.stopPropagation) { e.stopPropagation(); }
        dialog('Remove ' + item.name + '?',
          '<p>The game file is removed from this iPad. Your in-game saves are kept, so they come back if you import it again.</p>',
          [{ label: 'Cancel', action: function () { hide($('dialog')); } },
           { label: 'Remove', go: true, action: function () {
             hide($('dialog'));
             GameStore.remove('data', item.id, function () {
               GameStore.remove('meta', item.id, function () { renderLibrary(); });
             });
           } }]);
      });
      node.appendChild(rm);
    }
    return node;
  }

  function launch(buffer, info) {
    lastRomBuffer = buffer;
    busy(null);
    startGame(buffer, info);
  }

  function playStored(item) {
    busy('Loading game');
    GameStore.get('data', item.id, function (err, rec) {
      if (!rec || !rec.data) {
        busy(null);
        dialog('Game file missing', '<p>This game\'s file is no longer stored on this iPad. Import it again.</p>', null);
        return;
      }
      item.lastPlayed = Date.now();
      GameStore.put('meta', item);
      // tiny delay lets the spinner paint on slow devices
      setTimeout(function () { launch(rec.data, { key: item.id, name: item.name }); }, 30);
    });
  }

  function playFromUrl(url, name, key) {
    busy('Downloading game');
    var xhr = new XMLHttpRequest();
    try {
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';
    } catch (e) {
      busy(null);
      dialog('Couldn\'t open the link', '<p>' + escapeHtml(e.message || String(e)) + '</p>', null);
      return;
    }
    xhr.onprogress = function (e) {
      if (e.lengthComputable) {
        $('busy-text').innerHTML = 'Downloading ' + Math.round(e.loaded / e.total * 100) + '%';
      }
    };
    xhr.onload = function () {
      if (xhr.status && (xhr.status < 200 || xhr.status >= 300) || !xhr.response) {
        busy(null);
        dialog('Couldn\'t download the game', '<p>The server answered with error ' + xhr.status +
          '. Check that the file name in roms/games.js matches the file in the roms folder exactly (capital letters count).</p>', null);
        return;
      }
      var fileName = url.split('?')[0].split('/').pop();
      try {
        var rom = prepareRom(xhr.response, fileName);
        launch(rom.data, { key: key, name: name || readHeaderTitle(rom.data) || rom.name });
      } catch (err) {
        busy(null);
        dialog('Can\'t play this file', '<p>' + escapeHtml(err.message) + '</p>', null);
      }
    };
    xhr.onerror = function () {
      busy(null);
      dialog('Couldn\'t download the game',
        '<p>The download was blocked or the connection dropped. Links to other websites only work if that site allows it, so the most reliable way is to save the file to iCloud Drive and use Import game.</p>', null);
    };
    xhr.send();
  }

  // Import from the iPad (Files/iCloud Drive picker)
  $('file-input').addEventListener('change', function () {
    var input = this;
    var file = input.files && input.files[0];
    if (!file) { return; }
    busy('Reading game');
    var reader = new FileReader();
    reader.onload = function () {
      input.value = '';
      var rom;
      try {
        rom = prepareRom(reader.result, file.name);
      } catch (err) {
        busy(null);
        dialog('Can\'t play this file', '<p>' + escapeHtml(err.message) + '</p>', null);
        return;
      }
      var title = (rom.name || file.name).replace(/\.(gba|agb|bin|zip)$/i, '');
      if (!title || /^(image|file)\d*$/i.test(title)) { title = readHeaderTitle(rom.data) || 'Game'; }
      var id = 'g' + Date.now();
      var meta = { id: id, name: title, size: rom.data.byteLength, added: Date.now(), lastPlayed: Date.now() };
      busy('Keeping a copy on this iPad');
      GameStore.put('data', { id: id, data: rom.data }, function (err) {
        if (err) {
          busy(null);
          toast('Playing now, but there wasn\'t room to keep this game on the iPad. You\'ll need to import it again next time.');
          launch(rom.data, { key: id, name: title });
          return;
        }
        GameStore.put('meta', meta, function () {
          if (!GameStore.isPersistent()) {
            toast('This browser can\'t keep games between visits, so you\'ll need to import it again next time.');
          }
          launch(rom.data, { key: id, name: title });
        });
      });
    };
    reader.onerror = function () {
      busy(null);
      input.value = '';
      dialog('Couldn\'t read the file', '<p>The file could not be opened. Try picking it again.</p>', null);
    };
    reader.readAsArrayBuffer(file);
  }, false);

  tap($('link-btn'), function () {
    dialog('Open from a link',
      '<p>Paste a direct link to a .gba or .zip file. The site hosting it has to allow downloads from other websites; files on GitHub usually work.</p>' +
      '<input type="url" id="url-field" placeholder="https://..." autocapitalize="off" autocorrect="off">',
      [{ label: 'Cancel', action: function () { hide($('dialog')); } },
       { label: 'Open', go: true, action: function () {
         var url = ($('url-field').value || '').replace(/^\s+|\s+$/g, '');
         if (!/^https?:\/\//i.test(url)) { toast('Enter a link that starts with https://'); return; }
         hide($('dialog'));
         playFromUrl(url, null, 'url:' + url);
       } }]);
  });

  // ---------- Saves backup ----------
  tap($('saves-btn'), function () {
    var saves = {};
    var count = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(SAVE_PREFIX) === 0) { saves[k] = localStorage.getItem(k); count++; }
      }
    } catch (e) {}
    var text = count ? JSON.stringify(saves) : '';
    dialog('Back up or restore saves',
      '<p>In-game saves live in this browser. To back them up, select all the text below and copy it into a note. ' +
      'To restore, paste a backup here and tap Restore.</p>' +
      '<p>' + count + (count === 1 ? ' game save' : ' game saves') + ' found.</p>' +
      '<textarea id="saves-text" autocapitalize="off" autocorrect="off" spellcheck="false">' + escapeHtml(text) + '</textarea>',
      [{ label: 'Close', action: function () { hide($('dialog')); } },
       { label: 'Restore', go: true, action: function () {
         var raw = $('saves-text').value;
         var data;
         try { data = JSON.parse(raw); } catch (e) { toast('That text isn\'t a saves backup.'); return; }
         var n = 0;
         try {
           for (var key in data) {
             if (data.hasOwnProperty(key) && key.indexOf(SAVE_PREFIX) === 0 && typeof data[key] === 'string') {
               localStorage.setItem(key, data[key]); n++;
             }
           }
         } catch (e) { toast('Couldn\'t write the saves. Private Browsing blocks storage.'); return; }
         hide($('dialog'));
         toast(n ? 'Restored ' + n + (n === 1 ? ' save.' : ' saves.') : 'No saves found in that text.');
       } }]);
  });

  tap($('help-btn'), function () {
    dialog('Controls and tips',
      '<table>' +
      '<tr><td>Move</td><td>D-pad (slide your thumb to roll between directions)</td></tr>' +
      '<tr><td>Press A and B together</td><td>Put your thumb between them</td></tr>' +
      '<tr><td>Keyboard</td><td>Arrows, Z = A, X = B, A = L, S = R, Enter = Start, \\ = Select</td></tr>' +
      '</table>' +
      '<p><b>Saving.</b> Games that save on a real cartridge save here automatically when you save in the game. ' +
      'Save state stores a snapshot of exactly where you are, one per game.</p>' +
      '<p><b>Running slow?</b> The iPad 3 is at the edge of what this emulator needs. Turn Sound off and keep Frame skip at Up to 3 or 5. ' +
      'Close other Safari tabs and restart the iPad if it has been on for days.</p>' +
      '<p><b>Full screen.</b> In Safari tap Share, then Add to Home Screen. Open it from the new icon to hide the address bar.</p>',
      null);
  });

  // ---------- App lifecycle ----------
  function onHide() {
    if (running) {
      pause();
      // When they come back, show the menu so they choose when to continue.
      $('sheet-title').innerHTML = current ? escapeHtml(current.name) : 'Paused';
      refreshMenu();
      show($('sheet'));
    } else {
      flushSave();
    }
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) { onHide(); } }, false);
  document.addEventListener('webkitvisibilitychange', function () { if (document.webkitHidden) { onHide(); } }, false);
  window.addEventListener('pagehide', onHide, false);
  window.addEventListener('blur', function () { flushSave(); }, false);

  var resizeTimer = null;
  function onResize() {
    if (resizeTimer) { clearTimeout(resizeTimer); }
    resizeTimer = setTimeout(function () {
      if (!$('player').classList.contains('hidden')) { layout(); }
    }, 120);
  }
  window.addEventListener('resize', onResize, false);
  window.addEventListener('orientationchange', onResize, false);

  // ---------- Start ----------
  loadSettings();
  if (settings.fps) { show(fpsEl); }
  if (!window.FileReader || !window.Uint8Array || !window.DataView) {
    dialog('This browser is too old', '<p>The emulator needs a newer browser. iOS 9 Safari or later works.</p>', null);
  } else {
    createEmulator();
  }
  busy('Starting');
  GameStore.init(function () {
    busy(null);
    renderLibrary();
  });

  // Exposed for debugging from the console.
  window.GBAPlayer = {
    gba: function () { return gba; },
    settings: settings,
    isRunning: function () { return running; },
    startGame: startGame,
    prepareRom: prepareRom
  };
})();
