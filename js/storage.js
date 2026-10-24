// Keeps imported games and save states in IndexedDB (falls back gracefully when unavailable).
// Plain ES5 + callbacks so it runs on iOS 9 Safari.
var GameStore = (function () {
  var db = null;
  var memory = { meta: {}, data: {}, states: {} }; // used when IndexedDB is unavailable

  function init(callback) {
    var idb = null;
    try { idb = window.indexedDB || window.webkitIndexedDB || null; } catch (e) { idb = null; }
    if (!idb) { callback(false); return; }

    var finished = false;
    function done(ok) {
      if (finished) { return; }
      finished = true;
      callback(ok);
    }
    var req;
    try {
      req = idb.open('gba-player', 1);
    } catch (e) {
      done(false);
      return;
    }
    req.onupgradeneeded = function (e) {
      var d = e.target.result;
      var names = d.objectStoreNames;
      if (!names.contains('meta')) { d.createObjectStore('meta', { keyPath: 'id' }); }
      if (!names.contains('data')) { d.createObjectStore('data', { keyPath: 'id' }); }
      if (!names.contains('states')) { d.createObjectStore('states', { keyPath: 'id' }); }
    };
    req.onsuccess = function (e) {
      db = e.target.result;
      done(true);
    };
    req.onerror = function () { done(false); };
    req.onblocked = function () { done(false); };
    // Old Safari sometimes never answers; don't hang the app.
    setTimeout(function () { done(!!db); }, 5000);
  }

  // Older Safari IndexedDB may refuse ArrayBuffers. If so, store them as binary strings.
  function encode(value) {
    if (value instanceof ArrayBuffer) {
      var u8 = new Uint8Array(value);
      var parts = [];
      for (var i = 0; i < u8.length; i += 8192) {
        parts.push(String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 8192, u8.length))));
      }
      return { __bin: parts.join('') };
    }
    if (value && typeof value === 'object') {
      var out = (value instanceof Array) ? [] : {};
      for (var k in value) {
        if (value.hasOwnProperty(k)) { out[k] = encode(value[k]); }
      }
      return out;
    }
    return value;
  }

  function decode(value) {
    if (value && typeof value === 'object') {
      if (typeof value.__bin === 'string') {
        var str = value.__bin;
        var u8 = new Uint8Array(str.length);
        for (var i = 0; i < str.length; i++) { u8[i] = str.charCodeAt(i); }
        return u8.buffer;
      }
      if (value instanceof ArrayBuffer) { return value; }
      for (var k in value) {
        if (value.hasOwnProperty(k)) { value[k] = decode(value[k]); }
      }
    }
    return value;
  }

  function rawPut(store, obj, callback) {
    try {
      var tx = db.transaction([store], 'readwrite');
      tx.oncomplete = function () { callback(null); };
      tx.onabort = tx.onerror = function () {
        callback(tx.error || new Error('Could not save'));
      };
      tx.objectStore(store).put(obj);
    } catch (e) {
      callback(e);
    }
  }

  function put(store, obj, callback) {
    callback = callback || function () {};
    if (!db) {
      memory[store][obj.id] = obj;
      callback(null);
      return;
    }
    rawPut(store, obj, function (err) {
      if (!err) { callback(null); return; }
      var name = (err && err.name) || '';
      if (name === 'QuotaExceededError') { callback(err); return; }
      var encoded;
      try { encoded = encode(obj); } catch (e) { callback(err); return; }
      rawPut(store, encoded, callback);
    });
  }

  function get(store, id, callback) {
    if (!db) { callback(null, memory[store][id] || null); return; }
    try {
      var tx = db.transaction([store], 'readonly');
      var req = tx.objectStore(store).get(id);
      req.onsuccess = function () { callback(null, req.result ? decode(req.result) : null); };
      req.onerror = function () { callback(req.error || new Error('Could not read'), null); };
    } catch (e) {
      callback(e, null);
    }
  }

  function remove(store, id, callback) {
    callback = callback || function () {};
    if (!db) { delete memory[store][id]; callback(null); return; }
    try {
      var tx = db.transaction([store], 'readwrite');
      tx.oncomplete = function () { callback(null); };
      tx.onabort = tx.onerror = function () { callback(tx.error || new Error('Could not delete')); };
      tx.objectStore(store)['delete'](id);
    } catch (e) {
      callback(e);
    }
  }

  function list(store, callback) {
    var out = [];
    if (!db) {
      for (var k in memory[store]) {
        if (memory[store].hasOwnProperty(k)) { out.push(memory[store][k]); }
      }
      callback(null, out);
      return;
    }
    try {
      var tx = db.transaction([store], 'readonly');
      var req = tx.objectStore(store).openCursor();
      req.onsuccess = function (e) {
        var cursor = e.target.result;
        if (cursor) {
          out.push(decode(cursor.value));
          cursor['continue']();
        } else {
          callback(null, out);
        }
      };
      req.onerror = function () { callback(req.error, out); };
    } catch (e) {
      callback(e, out);
    }
  }

  return {
    init: init,
    put: put,
    get: get,
    remove: remove,
    list: list,
    isPersistent: function () { return !!db; }
  };
})();
