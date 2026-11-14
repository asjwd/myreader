// V1_MYREADER_GITHUB_RPC_SHIM_20261114
(() => {
  'use strict';

  const BRIDGE_URL = "https://script.google.com/macros/s/AKfycbxgaIy-w6LFAozSefIOpwDx8pnfVSVZ_QdXkVLwuY9OJJiT9Brpl3bpihzM_zd-PiOmog/exec?bridge=myreader-v1";
  let bridgeOrigin = '';
  const TOKEN_KEY = 'JAW_MYREADER_DEVICE_TOKEN_V1';
  const LEGACY_TOKEN_KEY = 'JAW_RESEARCH_LIBRARY_DEVICE_V108';
  const LEGACY_TOKEN_KEY_2 = 'JAW_ANNOTATED_DEVICE_TOKEN_V75';
  const RPC_TIMEOUT_MS = 120000;

  let bridgeReady = false;
  let bridgeFrame = null;
  let seq = 0;
  const pending = new Map();
  const queued = [];

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

  function postRpc(message) {
    if (!bridgeFrame || !bridgeFrame.contentWindow) {
      queued.push(message);
      return;
    }
    if (!bridgeReady) {
      queued.push(message);
      return;
    }
    bridgeFrame.contentWindow.postMessage(message, bridgeOrigin);
  }

  function flushQueue() {
    if (!bridgeReady || !bridgeFrame || !bridgeFrame.contentWindow) return;
    while (queued.length) {
      bridgeFrame.contentWindow.postMessage(queued.shift(), bridgeOrigin);
    }
  }

  function invoke(method, args, success, failure, userObject) {
    const id = `v1-${Date.now()}-${++seq}`;
    const timer = setTimeout(() => {
      const item = pending.get(id);
      if (!item) return;
      pending.delete(id);
      const err = new Error('MyReader backend did not respond.');
      if (typeof item.failure === 'function') item.failure(err, item.userObject);
      else console.error(err);
    }, RPC_TIMEOUT_MS);

    pending.set(id, { success, failure, userObject, timer, method });

    postRpc({
      type: 'MYREADER_RPC_V1',
      id,
      method: String(method || ''),
      args: (Array.isArray(args) ? args : []).map(makeSerializable),
      deviceToken: getToken(),
      fingerprint: currentFingerprint()
    });
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

  window.addEventListener('message', event => {
    if (!bridgeFrame || event.source !== bridgeFrame.contentWindow) return;
    if (!isTrustedBridgeOrigin(event.origin)) return;
    const data = event.data || {};

    if (data.type === 'MYREADER_BRIDGE_READY_V1') {
      bridgeOrigin = event.origin;
      bridgeReady = true;
      flushQueue();
      return;
    }

    if (data.type !== 'MYREADER_RPC_RESULT_V1' || !data.id) return;

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
    if (bridgeFrame) return;
    bridgeFrame = document.createElement('iframe');
    bridgeFrame.src = BRIDGE_URL;
    bridgeFrame.title = 'MyReader backend bridge';
    bridgeFrame.setAttribute('aria-hidden', 'true');
    bridgeFrame.tabIndex = -1;
    bridgeFrame.style.cssText =
      'position:fixed;width:1px;height:1px;border:0;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
    (document.body || document.documentElement).appendChild(bridgeFrame);
  }

  absorbDeviceFromUrl();
  installGoogleScriptRunShim();

  window.myReaderGetDeviceTokenV1 = getToken;
  window.myReaderSaveDeviceTokenV1 = saveToken;
  window.myReaderClearDeviceTokenV1 = clearToken;
  window.myReaderFingerprintV1 = currentFingerprint;
  window.myReaderQueryParamV1 = queryParam;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountBridge, { once: true });
  } else {
    mountBridge();
  }
})();
