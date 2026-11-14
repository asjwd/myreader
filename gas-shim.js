// V4A_MYREADER_BROWSER_CACHE_PREFETCH_20261114
(() => {
  'use strict';

  const BRIDGE_URL = "https://script.google.com/macros/s/AKfycbxgaIy-w6LFAozSefIOpwDx8pnfVSVZ_QdXkVLwuY9OJJiT9Brpl3bpihzM_zd-PiOmog/exec?bridge=myreader-v1";
  let bridgeOrigin = '';
  const TOKEN_KEY = 'JAW_MYREADER_DEVICE_TOKEN_V1';
  const LEGACY_TOKEN_KEY = 'JAW_RESEARCH_LIBRARY_DEVICE_V108';
  const LEGACY_TOKEN_KEY_2 = 'JAW_ANNOTATED_DEVICE_TOKEN_V75';
  const RPC_TIMEOUT_MS = 120000;
  const GITHUB_ORIGIN = location.origin;
  const IS_TOP = window === window.top;
  const CHILD_RPC_TYPE = 'MYREADER_CHILD_RPC_V3';
  const CHILD_RESULT_TYPE = 'MYREADER_CHILD_RPC_RESULT_V3';
  const CHILD_NAV_TYPE = 'MYREADER_CHILD_NAV_V3';
  const BOOT_CACHE_DB_V4A = 'jaw-myreader-v4a';
  const BOOT_CACHE_STORE_V4A = 'bootstrap';
  const BOOT_CACHE_TTL_MS_V4A = 10 * 60 * 1000;
  const ACCESS_SENTINEL_V4A = '__MYREADER_ACCESS__';

  let bridgeReady = false;
  let bridgeFrame = null;
  let bridgeRpcWindow = null;
  let seq = 0;
  const pending = new Map();
  const queued = [];
  const childRoutes = new Map();
  const bootstrapCacheAttemptedV4A = new Set();
  const bootstrapPrefetchInFlightV4A = new Set();
  let bootstrapDbPromiseV4A = null;

  function currentFingerprint() {
    const ua = String(navigator.userAgent || '');
    const platform = String(navigator.platform || '');
    const touch = Number(navigator.maxTouchPoints || 0);
    const sw = Math.min(Number(screen.width || 0), Number(screen.height || 0));
    const sh = Math.max(Number(screen.width || 0), Number(screen.height || 0));
    const dpr = Math.round(Number(window.devicePixelRatio || 1) * 100) / 100;

    let family = 'Browser';
    if (/CriOS/i.test(ua)) family = 'Chrome-iOS';
    else if (/FxiOS/i.test(ua)) family = 'Firefox-iOS';
    else if (/EdgiOS/i.test(ua)) family = 'Edge-iOS';
    else if (/Chrome/i.test(ua)) family = 'Chrome';
    else if (/Safari/i.test(ua)) family = 'Safari';

    let deviceClass = 'Desktop';
    if (/iPhone/i.test(ua)) deviceClass = 'iPhone';
    else if (/iPad/i.test(ua) || (platform === 'MacIntel' && touch > 1)) deviceClass = 'iPad';
    else if (/Android/i.test(ua)) deviceClass = 'Android';

    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (err) {}

    return [
      deviceClass,
      family,
      platform,
      `${sw}x${sh}`,
      `dpr:${dpr}`,
      `touch:${touch}`,
      `lang:${String(navigator.language || '')}`,
      `tz:${tz}`,
      `depth:${Number(screen.colorDepth || 0)}`
    ].join('|');
  }

  function getToken() {
    try {
      return String(
        localStorage.getItem(TOKEN_KEY) ||
        localStorage.getItem(LEGACY_TOKEN_KEY) ||
        localStorage.getItem(LEGACY_TOKEN_KEY_2) ||
        ''
      ).trim();
    } catch (err) {
      return '';
    }
  }

  function saveToken(token) {
    const value = String(token || '').trim();
    if (!value) return;
    try {
      localStorage.setItem(TOKEN_KEY, value);
      localStorage.setItem(LEGACY_TOKEN_KEY, value);
    } catch (err) {}
  }

  function clearToken() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY_2);
    } catch (err) {}
    bootstrapCacheAttemptedV4A.clear();
    bootstrapCacheDeleteV4A('').catch(() => {});
  }

  function absorbDeviceFromUrl() {
    try {
      const url = new URL(location.href);
      const token = String(url.searchParams.get('device') || '').trim();
      if (!token) return;
      saveToken(token);
      url.searchParams.delete('device');
      url.searchParams.delete('key');
      history.replaceState(history.state || {}, '', url.toString());
    } catch (err) {}
  }

  function queryParam(name) {
    try { return String(new URL(location.href).searchParams.get(name) || ''); }
    catch (err) { return ''; }
  }

  function serializeForm(form) {
    const payload = { __myReaderFormV1: true, fields: {}, files: {} };
    const fd = new FormData(form);

    for (const [name, value] of fd.entries()) {
      if (value instanceof File) {
        if (!value.name && !value.size) continue;
        if (!payload.files[name]) payload.files[name] = [];
        payload.files[name].push(value);
      } else {
        if (!payload.fields[name]) payload.fields[name] = [];
        payload.fields[name].push(String(value));
      }
    }

    Object.keys(payload.fields).forEach(name => {
      if (payload.fields[name].length === 1) payload.fields[name] = payload.fields[name][0];
    });
    Object.keys(payload.files).forEach(name => {
      if (payload.files[name].length === 1) payload.files[name] = payload.files[name][0];
    });

    return payload;
  }

  function makeSerializable(value) {
    if (typeof HTMLFormElement !== 'undefined' && value instanceof HTMLFormElement) {
      return serializeForm(value);
    }
    if (Array.isArray(value)) return value.map(makeSerializable);
    if (
      value &&
      typeof value === 'object' &&
      !(value instanceof File) &&
      !(value instanceof Blob)
    ) {
      const out = {};
      Object.keys(value).forEach(key => {
        out[key] = makeSerializable(value[key]);
      });
      return out;
    }
    return value;
  }

  function tokenPartitionV4A() {
    const raw = getToken();
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function normalizeBootstrapSurfaceV4A(method, args) {
    const name = String(method || '');
    const a = Array.isArray(args) ? args : [];
    if (name === 'getLiteratureLibraryBootstrapFastV70' || name === 'getLiteratureLibraryBootstrap') {
      return 'article';
    }
    if (name === 'getResearchSurfaceBootstrapV127') {
      const raw = String(a[0] || '').toLowerCase();
      if (raw === 'book' || raw === 'books') return 'book';
      if (raw === 'project' || raw === 'projects' || raw === 'manuscript' || raw === 'manuscripts') return 'project';
    }
    return '';
  }

  function bootstrapCacheKeyV4A(surface) {
    return tokenPartitionV4A() + '::' + String(surface || '').toLowerCase();
  }

  function openBootstrapDbV4A() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unavailable'));
    if (bootstrapDbPromiseV4A) return bootstrapDbPromiseV4A;
    bootstrapDbPromiseV4A = new Promise((resolve, reject) => {
      const req = indexedDB.open(BOOT_CACHE_DB_V4A, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(BOOT_CACHE_STORE_V4A)) {
          db.createObjectStore(BOOT_CACHE_STORE_V4A, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
    return bootstrapDbPromiseV4A;
  }

  async function bootstrapCacheGetV4A(surface) {
    if (!surface || !getToken()) return null;
    try {
      const db = await openBootstrapDbV4A();
      const key = bootstrapCacheKeyV4A(surface);
      const row = await new Promise((resolve, reject) => {
        const tx = db.transaction(BOOT_CACHE_STORE_V4A, 'readonly');
        const req = tx.objectStore(BOOT_CACHE_STORE_V4A).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
      });
      if (!row || !row.data || !row.savedAt) return null;
      if ((Date.now() - Number(row.savedAt || 0)) > BOOT_CACHE_TTL_MS_V4A) {
        bootstrapCacheDeleteV4A(surface).catch(() => {});
        return null;
      }
      return row.data;
    } catch (err) {
      return null;
    }
  }

  async function bootstrapCachePutV4A(surface, value) {
    if (!surface || !value || value.ok === false || !getToken()) return false;
    try {
      const db = await openBootstrapDbV4A();
      const row = {
        key: bootstrapCacheKeyV4A(surface),
        surface: String(surface),
        savedAt: Date.now(),
        data: value
      };
      await new Promise((resolve, reject) => {
        const tx = db.transaction(BOOT_CACHE_STORE_V4A, 'readwrite');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
        tx.objectStore(BOOT_CACHE_STORE_V4A).put(row);
      });
      return true;
    } catch (err) {
      return false;
    }
  }

  async function bootstrapCacheDeleteV4A(surface) {
    try {
      const db = await openBootstrapDbV4A();
      const tx = db.transaction(BOOT_CACHE_STORE_V4A, 'readwrite');
      const store = tx.objectStore(BOOT_CACHE_STORE_V4A);
      if (surface) {
        store.delete(bootstrapCacheKeyV4A(surface));
      } else {
        store.clear();
      }
      return await new Promise(resolve => {
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      });
    } catch (err) {
      return false;
    }
  }

  function isBootstrapMutationV4A(method) {
    const name = String(method || '');
    if (!name) return false;
    if (/^(get|verify|download|send|warm|diagnose|record)/i.test(name)) return false;
    return /^(add|create|delete|remove|save|set|sync|update|upload|process)/i.test(name);
  }

  function postToBridge(message) {
    if (!bridgeReady || !bridgeRpcWindow || !bridgeOrigin) {
      queued.push(message);
      return;
    }
    bridgeRpcWindow.postMessage(message, bridgeOrigin);
  }

  function flushQueue() {
    if (!bridgeReady || !bridgeRpcWindow || !bridgeOrigin) return;
    while (queued.length) {
      bridgeRpcWindow.postMessage(queued.shift(), bridgeOrigin);
    }
  }

  function routeRpcMessage(message) {
    if (IS_TOP) {
      postToBridge(message);
      return;
    }
    window.parent.postMessage({ type: CHILD_RPC_TYPE, payload: message }, GITHUB_ORIGIN);
  }

  function invokeNetworkV4A(method, args, success, failure, userObject) {
    const rawArgs = Array.isArray(args) ? args : [];
    const surface = normalizeBootstrapSurfaceV4A(method, rawArgs);
    const mutation = isBootstrapMutationV4A(method);

    const wrappedSuccess = (value, obj) => {
      if (surface) bootstrapCachePutV4A(surface, value).catch(() => {});
      if (mutation) bootstrapCacheDeleteV4A('').catch(() => {});
      if (typeof success === 'function') success(value, obj);
    };

    const id = `v4a-${Date.now()}-${++seq}`;
    const timer = setTimeout(() => {
      const item = pending.get(id);
      if (!item) return;
      pending.delete(id);
      const err = new Error('MyReader backend did not respond.');
      if (typeof item.failure === 'function') item.failure(err, item.userObject);
      else console.error(err);
    }, RPC_TIMEOUT_MS);

    pending.set(id, {
      success: wrappedSuccess,
      failure,
      userObject,
      timer,
      method,
      args: rawArgs,
      surface
    });

    routeRpcMessage({
      type: 'MYREADER_RPC_V1',
      id,
      method: String(method || ''),
      args: rawArgs.map(makeSerializable),
      deviceToken: getToken(),
      fingerprint: currentFingerprint()
    });
  }

  function invoke(method, args, success, failure, userObject) {
    const rawArgs = Array.isArray(args) ? args : [];
    const surface = normalizeBootstrapSurfaceV4A(method, rawArgs);

    if (surface && !bootstrapCacheAttemptedV4A.has(surface)) {
      bootstrapCacheAttemptedV4A.add(surface);
      bootstrapCacheGetV4A(surface).then(cached => {
        if (cached) {
          setTimeout(() => {
            try {
              if (typeof success === 'function') success(cached, userObject);
            } catch (err) {
              console.error(err);
            }
          }, 0);

          // Stale-while-revalidate: refresh the snapshot quietly.
          invokeNetworkV4A(method, rawArgs, null, null, undefined);
          return;
        }
        invokeNetworkV4A(method, rawArgs, success, failure, userObject);
      }).catch(() => {
        invokeNetworkV4A(method, rawArgs, success, failure, userObject);
      });
      return;
    }

    invokeNetworkV4A(method, rawArgs, success, failure, userObject);
  }

  function prefetchBootstrapV4A(surface) {
    const name = String(surface || '').toLowerCase();
    if (!getToken() || bootstrapPrefetchInFlightV4A.has(name)) return;
    bootstrapPrefetchInFlightV4A.add(name);

    let method = '';
    let args = [];
    if (name === 'article') {
      method = 'getLiteratureLibraryBootstrapFastV70';
      args = [ACCESS_SENTINEL_V4A];
    } else if (name === 'book') {
      method = 'getResearchSurfaceBootstrapV127';
      args = ['book', ACCESS_SENTINEL_V4A];
    } else if (name === 'project') {
      method = 'getResearchSurfaceBootstrapV127';
      args = ['project', ACCESS_SENTINEL_V4A];
    } else {
      bootstrapPrefetchInFlightV4A.delete(name);
      return;
    }

    invokeNetworkV4A(
      method,
      args,
      () => bootstrapPrefetchInFlightV4A.delete(name),
      () => bootstrapPrefetchInFlightV4A.delete(name),
      undefined
    );
  }

  function prefetchAllV4A() {
    if (!IS_TOP || !getToken()) return;
    const schedule = (fn, delay) => {
      if ('requestIdleCallback' in window) {
        setTimeout(() => requestIdleCallback(fn, { timeout: 1500 }), delay);
      } else {
        setTimeout(fn, delay);
      }
    };
    schedule(() => prefetchBootstrapV4A('article'), 0);
    schedule(() => prefetchBootstrapV4A('book'), 180);
    schedule(() => prefetchBootstrapV4A('project'), 360);
  }

  function createRunner() {
    const state = {
      success: null,
      failure: null,
      userObject: undefined
    };

    let proxy;
    proxy = new Proxy({}, {
      get(target, prop) {
        if (prop === 'withSuccessHandler') {
          return fn => { state.success = fn; return proxy; };
        }
        if (prop === 'withFailureHandler') {
          return fn => { state.failure = fn; return proxy; };
        }
        if (prop === 'withUserObject') {
          return obj => { state.userObject = obj; return proxy; };
        }
        if (prop === 'then') return undefined;

        return (...args) => {
          invoke(String(prop), args, state.success, state.failure, state.userObject);
          return proxy;
        };
      }
    });
    return proxy;
  }

  function installGoogleScriptRunShim() {
    window.google = window.google || {};
    window.google.script = window.google.script || {};
    Object.defineProperty(window.google.script, 'run', {
      configurable: true,
      enumerable: true,
      get: createRunner
    });
  }

  function isTrustedBridgeOrigin(origin) {
    try {
      const host = new URL(String(origin || '')).hostname.toLowerCase();
      return host === 'script.google.com' ||
        host === 'script.googleusercontent.com' ||
        host.endsWith('.googleusercontent.com');
    } catch (err) {
      return false;
    }
  }

  function moduleUrlInfo(raw) {
    try {
      const u = new URL(String(raw || ''), location.href);
      if (u.origin !== location.origin) return null;
      const p = u.pathname.replace(/\/+$/, '');
      if (p === '/myreader' || p === '/myreader/index.html') return { kind: 'home', url: u.toString() };
      if (/^\/myreader\/(articles|books|manuscripts)\.html$/i.test(p)) {
        return { kind: 'module', url: u.toString() };
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  function navigateV3(raw) {
    const info = moduleUrlInfo(raw);
    if (!info) {
      try { window.top.location.href = String(raw || ''); }
      catch (err) { location.href = String(raw || ''); }
      return true;
    }

    if (!IS_TOP) {
      window.parent.postMessage({ type: CHILD_NAV_TYPE, url: info.url }, GITHUB_ORIGIN);
      return true;
    }

    if (typeof window.myReaderShellNavigateV3 === 'function') {
      window.myReaderShellNavigateV3(info.url);
      return true;
    }

    location.href = info.url;
    return true;
  }

  window.addEventListener('message', event => {
    const data = event.data || {};

    if (IS_TOP && event.origin === GITHUB_ORIGIN && data.type === CHILD_RPC_TYPE) {
      const payload = data.payload || {};
      if (!payload.id || payload.type !== 'MYREADER_RPC_V1') return;
      childRoutes.set(String(payload.id), event.source);
      postToBridge(payload);
      return;
    }

    if (IS_TOP && event.origin === GITHUB_ORIGIN && data.type === CHILD_NAV_TYPE) {
      if (typeof window.myReaderShellNavigateV3 === 'function') {
        window.myReaderShellNavigateV3(String(data.url || ''));
      }
      return;
    }

    if (!IS_TOP && event.origin === GITHUB_ORIGIN && event.source === window.parent && data.type === CHILD_RESULT_TYPE) {
      const payload = data.payload || {};
      const item = pending.get(String(payload.id || ''));
      if (!item) return;
      pending.delete(String(payload.id));
      clearTimeout(item.timer);

      if (payload.ok) {
        if (item.method === 'confirmLiteratureDevicePairingV62') {
          const token = String(payload.value && payload.value.deviceToken || '');
          if (token) saveToken(token);
        }
        if (item.method === 'revokeLiteratureCurrentDeviceV62') clearToken();
        if (typeof item.success === 'function') item.success(payload.value, item.userObject);
      } else {
        const err = new Error(String(payload.error || 'MyReader backend error'));
        if (typeof item.failure === 'function') item.failure(err, item.userObject);
        else console.error(err);
      }
      return;
    }

    if (!IS_TOP || !isTrustedBridgeOrigin(event.origin)) return;

    if (data.type === 'MYREADER_BRIDGE_READY_V1') {
      bridgeOrigin = event.origin;
      bridgeRpcWindow = event.source;
      bridgeReady = !!bridgeRpcWindow;
      flushQueue();
      return;
    }

    if (!bridgeReady || !bridgeRpcWindow || event.source !== bridgeRpcWindow) return;
    if (data.type !== 'MYREADER_RPC_RESULT_V1' || !data.id) return;

    const child = childRoutes.get(String(data.id));
    if (child) {
      childRoutes.delete(String(data.id));
      try {
        child.postMessage({ type: CHILD_RESULT_TYPE, payload: data }, GITHUB_ORIGIN);
      } catch (err) {}
      return;
    }

    const item = pending.get(String(data.id));
    if (!item) return;
    pending.delete(String(data.id));
    clearTimeout(item.timer);

    if (data.ok) {
      if (item.method === 'confirmLiteratureDevicePairingV62') {
        const token = String(data.value && data.value.deviceToken || '');
        if (token) saveToken(token);
      }
      if (item.method === 'revokeLiteratureCurrentDeviceV62') clearToken();
      if (typeof item.success === 'function') item.success(data.value, item.userObject);
    } else {
      const err = new Error(String(data.error || 'MyReader backend error'));
      if (typeof item.failure === 'function') item.failure(err, item.userObject);
      else console.error(err);
    }
  });

  function mountBridge() {
    if (!IS_TOP || bridgeFrame) return;
    bridgeFrame = document.createElement('iframe');
    bridgeFrame.src = BRIDGE_URL;
    bridgeFrame.title = 'MyReader backend bridge';
    bridgeFrame.setAttribute('aria-hidden', 'true');
    bridgeFrame.tabIndex = -1;
    bridgeFrame.style.cssText =
      'position:fixed;width:1px;height:1px;border:0;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
    (document.body || document.documentElement).appendChild(bridgeFrame);
  }

  function installEmbeddedNavigationCapture() {
    if (IS_TOP) return;
    document.addEventListener('click', event => {
      const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!anchor) return;
      const info = moduleUrlInfo(anchor.href || anchor.getAttribute('href'));
      if (!info) return;
      event.preventDefault();
      event.stopPropagation();
      navigateV3(info.url);
    }, true);
  }

  absorbDeviceFromUrl();
  installGoogleScriptRunShim();
  installEmbeddedNavigationCapture();

  window.myReaderGetDeviceTokenV1 = getToken;
  window.myReaderSaveDeviceTokenV1 = saveToken;
  window.myReaderClearDeviceTokenV1 = clearToken;
  window.myReaderFingerprintV1 = currentFingerprint;
  window.myReaderQueryParamV1 = queryParam;
  window.myReaderNavigateV3 = navigateV3;
  window.myReaderIsEmbeddedV3 = !IS_TOP;
  window.myReaderBootstrapCacheGetV4A = bootstrapCacheGetV4A;
  window.myReaderBootstrapCachePutV4A = bootstrapCachePutV4A;
  window.myReaderBootstrapCacheClearV4A = bootstrapCacheDeleteV4A;
  window.myReaderPrefetchAllV4A = prefetchAllV4A;

  if (IS_TOP && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountBridge, { once: true });
  } else if (IS_TOP) {
    mountBridge();
  }
})();
