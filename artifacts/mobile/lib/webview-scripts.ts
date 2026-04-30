import type { AIProvider } from "./providers";

const escape = (s: string): string =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");

export interface AutomationStartMessage {
  type: "automation:start";
  prompt: string;
  provider: AIProvider;
}

export interface InboundEvent {
  type:
    | "cookies"
    | "profile"
    | "loginDetected"
    | "automation:typing"
    | "automation:response"
    | "automation:error"
    | "automation:limit"
    | "log";
  payload?: unknown;
}

/** Posts cookies + a heuristic loginDetected signal whenever the page changes. */
export function loginObserverScript(provider: AIProvider): string {
  const sessionKeys = JSON.stringify(provider.sessionCookieKeys);
  return `
(function(){
  if (window.__macInjected) return; window.__macInjected = true;
  function send(type, payload){
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({type, payload}));
    } catch(e){}
  }
  function hasSessionCookie(){
    var keys = ${sessionKeys};
    var docCookie = document.cookie || "";
    for (var i=0;i<keys.length;i++){
      if (docCookie.indexOf(keys[i] + "=") >= 0) return true;
    }
    return false;
  }
  function tryFindEmail(){
    try {
      var metas = document.querySelectorAll('meta');
      for (var i=0;i<metas.length;i++){
        var c = metas[i].getAttribute('content') || '';
        var m = c.match(/[\\w.+-]+@[\\w-]+\\.[\\w.-]+/);
        if (m) return m[0];
      }
      var bodyText = (document.body && document.body.innerText) || '';
      var m2 = bodyText.match(/[\\w.+-]+@[\\w-]+\\.[\\w.-]+/);
      if (m2) return m2[0];
    } catch(e){}
    return null;
  }
  function snapshot(){
    send('cookies', { cookie: document.cookie || '' });
    var email = tryFindEmail();
    var title = document.title || '';
    send('profile', { email: email, title: title, url: location.href });
    if (hasSessionCookie()){
      send('loginDetected', { url: location.href });
    }
  }
  setTimeout(snapshot, 800);
  setInterval(snapshot, 2000);
  var lastUrl = location.href;
  setInterval(function(){
    if (location.href !== lastUrl){ lastUrl = location.href; setTimeout(snapshot, 600); }
  }, 700);
})();
true;
`;
}

/**
 * Lets the user tap any element on the page. The tapped element's CSS
 * selector is sent back as `selector:picked` (with the active mode).
 *
 * Runs as a fixed overlay with three mode buttons + a Cancel button.
 */
export function selectorPickerScript(): string {
  return `
(function(){
  if (window.__macPicker) return;
  window.__macPicker = true;

  function send(type, payload){
    try { window.ReactNativeWebView.postMessage(JSON.stringify({type, payload})); } catch(e){}
  }

  function cssPath(el){
    if (!(el instanceof Element)) return '';
    var path = [];
    while (el && el.nodeType === 1 && el !== document.body && path.length < 6) {
      var sel = el.nodeName.toLowerCase();
      if (el.id) { sel += '#' + el.id; path.unshift(sel); break; }
      var sib = el, nth = 1;
      while ((sib = sib.previousElementSibling)) {
        if (sib.nodeName.toLowerCase() === sel) nth++;
      }
      var cls = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(function(c){
        return c && !/^[a-z]+-[a-z0-9]+$/i.test(c) && c.length < 30;
      }).slice(0,2);
      if (cls.length) sel += '.' + cls.join('.');
      var role = el.getAttribute('role');
      if (role) sel += '[role="' + role + '"]';
      var aria = el.getAttribute('aria-label');
      if (aria && aria.length < 40) sel += '[aria-label="' + aria.replace(/"/g,'\\\\"') + '"]';
      var ce = el.getAttribute('contenteditable');
      if (ce) sel += '[contenteditable="' + ce + '"]';
      sel += ':nth-of-type(' + nth + ')';
      path.unshift(sel);
      el = el.parentElement;
    }
    return path.join(' > ');
  }

  var mode = null; // 'input' | 'send' | 'response'
  var hover = null;

  // ---- overlay UI -----------------------------------------------------------
  var bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;background:#000;color:#fff;border:1px solid #333;border-radius:14px;padding:10px;font:13px -apple-system,Segoe UI,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5);';
  bar.innerHTML = ''
    + '<div style="margin-bottom:8px;font-weight:600">Tap an element to teach the app</div>'
    + '<div id="__macStatus" style="opacity:.7;margin-bottom:8px;font-size:12px">Pick a target below, then tap the element on the page</div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
    + '  <button data-m="input"    style="flex:1;background:#fff;color:#000;border:0;border-radius:10px;padding:8px;font-weight:600">Input</button>'
    + '  <button data-m="send"     style="flex:1;background:#fff;color:#000;border:0;border-radius:10px;padding:8px;font-weight:600">Send</button>'
    + '  <button data-m="response" style="flex:1;background:#fff;color:#000;border:0;border-radius:10px;padding:8px;font-weight:600">Response</button>'
    + '  <button data-m="cancel"   style="background:#1c1c1c;color:#fff;border:1px solid #333;border-radius:10px;padding:8px">×</button>'
    + '</div>';
  document.documentElement.appendChild(bar);

  var status = bar.querySelector('#__macStatus');

  function setMode(m){
    mode = m;
    var labels = { input: 'Now tap the chat INPUT field', send: 'Now tap the SEND button', response: 'Now tap on a model RESPONSE bubble' };
    status.textContent = labels[m] || 'Pick a target';
    bar.querySelectorAll('button[data-m]').forEach(function(b){
      var on = b.getAttribute('data-m') === m;
      b.style.background = on ? '#22c55e' : (b.getAttribute('data-m') === 'cancel' ? '#1c1c1c' : '#fff');
      b.style.color = on ? '#000' : (b.getAttribute('data-m') === 'cancel' ? '#fff' : '#000');
    });
  }

  bar.addEventListener('click', function(e){
    var t = e.target.closest('button[data-m]');
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    var m = t.getAttribute('data-m');
    if (m === 'cancel'){ cleanup(); send('selector:cancel', {}); return; }
    setMode(m);
  }, true);

  // ---- highlight + capture --------------------------------------------------
  var hl = document.createElement('div');
  hl.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #22c55e;background:rgba(34,197,94,.18);z-index:2147483646;border-radius:6px;transition:all .08s';
  hl.style.display = 'none';
  document.documentElement.appendChild(hl);

  function moveHL(el){
    if (!el) { hl.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    hl.style.display = 'block';
    hl.style.left = r.left + 'px';
    hl.style.top = r.top + 'px';
    hl.style.width = r.width + 'px';
    hl.style.height = r.height + 'px';
  }

  function isOurUI(el){
    while (el){ if (el === bar || el === hl) return true; el = el.parentElement; }
    return false;
  }

  function onMove(e){
    if (!mode) return;
    var t = (e.touches && e.touches[0]) ? document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY) : e.target;
    if (!t || isOurUI(t)) { moveHL(null); return; }
    hover = t;
    moveHL(t);
  }
  function onPick(e){
    if (!mode) return;
    var t = (e.changedTouches && e.changedTouches[0]) ? document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY) : e.target;
    if (!t || isOurUI(t)) return;
    e.preventDefault(); e.stopPropagation();
    var sel = cssPath(t);
    send('selector:picked', { mode: mode, selector: sel, tag: t.tagName, text: (t.innerText || '').slice(0, 60) });
    moveHL(null);
    status.textContent = 'Saved ' + mode + '. Pick another or close.';
    mode = null;
    bar.querySelectorAll('button[data-m]').forEach(function(b){
      b.style.background = b.getAttribute('data-m') === 'cancel' ? '#1c1c1c' : '#fff';
      b.style.color = b.getAttribute('data-m') === 'cancel' ? '#fff' : '#000';
    });
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('touchmove', onMove, true);
  document.addEventListener('click', onPick, true);
  document.addEventListener('touchend', onPick, true);

  function cleanup(){
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('touchmove', onMove, true);
    document.removeEventListener('click', onPick, true);
    document.removeEventListener('touchend', onPick, true);
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    if (hl && hl.parentNode) hl.parentNode.removeChild(hl);
    window.__macPicker = false;
  }
  window.__macPickerCleanup = cleanup;
})();
true;
`;
}

/** Run inside an active session WebView. Drives the AI service from JS. */
export function automationScript(
  prompt: string,
  provider: AIProvider,
  imageDataUrl?: string | null,
): string {
  const safePrompt = escape(prompt);
  const inputSel = JSON.stringify(provider.inputSelector);
  const sendSel = JSON.stringify(provider.sendButtonSelector);
  const respSel = JSON.stringify(provider.responseSelector);
  const imageJson = JSON.stringify(imageDataUrl || "");
  return `
(function(){
  function send(type, payload){
    try { window.ReactNativeWebView.postMessage(JSON.stringify({type, payload})); } catch(e){}
  }
  function log(msg){ send('log', { msg: msg }); }

  function findInput(){
    var sels = ${inputSel}.split(',');
    for (var i=0;i<sels.length;i++){
      var el = document.querySelector(sels[i].trim());
      if (el) return el;
    }
    return null;
  }
  function findSend(){
    var sels = ${sendSel}.split(',');
    for (var i=0;i<sels.length;i++){
      var el = document.querySelector(sels[i].trim());
      if (el) return el;
    }
    return null;
  }
  function allResponseNodes(){
    var sels = ${respSel}.split(',');
    var nodes = [];
    for (var i=0;i<sels.length;i++){
      var n = document.querySelectorAll(sels[i].trim());
      for (var j=0;j<n.length;j++) nodes.push(n[j]);
    }
    return nodes;
  }
  function nodeText(el){
    return (el && (el.innerText || el.textContent)) || '';
  }
  function setInputText(el, text){
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT'){
      var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      if (setter && setter.set) setter.set.call(el, text); else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.focus();
      el.innerHTML = '';
      var p = document.createElement('p');
      p.textContent = text;
      el.appendChild(p);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
  }
  function detectLimit(){
    var t = (document.body && document.body.innerText) || '';
    return /usage limit|message limit|rate limit|too many requests|please try again later|out of (free )?messages|reached the limit|reached your.*limit/i.test(t);
  }

  // Try to parse a reset moment out of the on-page limit message. Returns
  // a unix-ms timestamp or null. Recognises:
  //   - "try again at 3:45 PM"  /  "available again at 15:45"
  //   - "resets at 3 PM"        /  "until 3:45 PM"
  //   - "try again in 2 hours"  /  "in 45 minutes" / "in 1 hour 30 minutes"
  //   - "available in X hour(s)" / "wait X minutes"
  function parseLimitResetMs(){
    try {
      var t = (document.body && document.body.innerText) || '';
      var now = new Date();

      // ---- Relative form: "in 2 hours 30 minutes" / "in 45 minutes" ----
      var relRe = /(?:try again|available|wait|reset[s]?)\\s+in\\s+(?:(\\d+)\\s*(?:hours?|hr?s?|h))?\\s*(?:(\\d+)\\s*(?:minutes?|mins?|m))?/i;
      var rel = relRe.exec(t);
      if (rel && (rel[1] || rel[2])){
        var hrs = parseInt(rel[1] || '0', 10);
        var mins = parseInt(rel[2] || '0', 10);
        if (hrs > 0 || mins > 0){
          return Date.now() + (hrs * 3600 + mins * 60) * 1000;
        }
      }

      // Same idea but minutes-only: "in 45 minutes"
      var relMin = /(?:try again|available|wait|reset[s]?)\\s+in\\s+(\\d+)\\s*(?:minutes?|mins?|m)\\b/i.exec(t);
      if (relMin){
        var mm = parseInt(relMin[1], 10);
        if (mm > 0) return Date.now() + mm * 60 * 1000;
      }

      // Hours-only: "in 3 hours"
      var relHr = /(?:try again|available|wait|reset[s]?)\\s+in\\s+(\\d+)\\s*(?:hours?|hrs?|h)\\b/i.exec(t);
      if (relHr){
        var hh = parseInt(relHr[1], 10);
        if (hh > 0) return Date.now() + hh * 3600 * 1000;
      }

      // ---- Absolute form: "at 3:45 PM" / "until 15:45" / "resets at 3 PM" ----
      var absRe = /(?:try again|available|reset[s]?|until)\\s+(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?/i;
      var abs = absRe.exec(t);
      if (abs){
        var h = parseInt(abs[1], 10);
        var m = abs[2] ? parseInt(abs[2], 10) : 0;
        var ampm = (abs[3] || '').toLowerCase();
        if (ampm === 'pm' && h < 12) h += 12;
        if (ampm === 'am' && h === 12) h = 0;
        if (h >= 0 && h < 24 && m >= 0 && m < 60){
          var when = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
          // If parsed time is already in the past (or within 2 min of now),
          // assume it's tomorrow.
          if (when.getTime() <= now.getTime() + 120 * 1000){
            when.setDate(when.getDate() + 1);
          }
          return when.getTime();
        }
      }
    } catch(e){}
    return null;
  }

  // Build a File object from a data: URL. Returns null on failure.
  function fileFromDataUrl(dataUrl){
    try {
      var m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
      if (!m) return null;
      var mime = m[1];
      var b64 = m[2];
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
      var ext = (mime.split('/')[1] || 'png').replace('jpeg','jpg');
      return new File([bytes], 'photo.' + ext, { type: mime });
    } catch(e){ return null; }
  }

  // Look for the hidden <input type="file"> the chat UI exposes for uploads.
  // Most modern AI sites use one of these. We look broadly because they're
  // often visually hidden via display:none / opacity:0 / aria-hidden.
  function findFileInput(){
    var inputs = document.querySelectorAll('input[type="file"]');
    if (!inputs.length) return null;
    // Prefer image-accepting inputs over generic file pickers
    for (var i=0;i<inputs.length;i++){
      var ip = inputs[i];
      var accept = (ip.getAttribute('accept') || '').toLowerCase();
      if (accept.indexOf('image') >= 0 || accept === '' || accept === '*/*') return ip;
    }
    return inputs[0];
  }

  // Attach an image to the chat. Returns Promise<boolean> resolving true if
  // ANY attachment strategy reported success. Strategy order:
  //   1. Hidden <input type="file"> — set .files via DataTransfer and fire
  //      'change' (the most reliable path; works on ChatGPT, Claude, Gemini,
  //      Perplexity since all of them use a hidden file input under the hood).
  //   2. Synthetic ClipboardEvent('paste') on the editor.
  //   3. Synthetic DragEvent('drop') on the editor.
  function attachImage(editor, dataUrl){
    return new Promise(function(resolve){
      var file = fileFromDataUrl(dataUrl);
      if (!file){ resolve(false); return; }

      // Strategy 1: native file input
      var fileInput = findFileInput();
      if (fileInput){
        try {
          var dt = new DataTransfer();
          dt.items.add(file);
          // Some browsers won't allow direct .files = ; this works in WebView
          Object.defineProperty(fileInput, 'files', {
            value: dt.files,
            writable: false,
            configurable: true,
          });
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          fileInput.dispatchEvent(new Event('input', { bubbles: true }));
          // Give the UI time to render the upload preview
          setTimeout(function(){ resolve(true); }, 200);
          return;
        } catch(e){ /* fall through to paste/drop */ }
      }

      // Strategy 2: paste on the editor
      try {
        try { editor.focus(); } catch(e){}
        var pdt = new DataTransfer();
        pdt.items.add(file);
        var pasteEv = new ClipboardEvent('paste', { clipboardData: pdt, bubbles: true, cancelable: true });
        try { Object.defineProperty(pasteEv, 'clipboardData', { value: pdt }); } catch(e){}
        editor.dispatchEvent(pasteEv);
      } catch(e){}

      // Strategy 3: drop on the editor
      setTimeout(function(){
        try {
          var ddt = new DataTransfer();
          ddt.items.add(file);
          var dropEv = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: ddt });
          editor.dispatchEvent(dropEv);
        } catch(e){}
        resolve(false);
      }, 80);
    });
  }

  // ---- baseline: snapshot existing response bubbles BEFORE we send so the
  // ---- "wait" loop never reports a stale prior response as the new one.
  var baseline = (function(){
    var nodes = allResponseNodes();
    return {
      count: nodes.length,
      lastText: nodes.length ? nodeText(nodes[nodes.length - 1]) : '',
    };
  })();

  var attempts = 0;
  function tryStart(){
    attempts++;
    var input = findInput();
    if (!input){
      if (attempts < 25){ setTimeout(tryStart, 400); return; }
      send('automation:error', { reason: 'input_not_found' });
      return;
    }
    if (detectLimit()){
      send('automation:limit', { reason: 'limit_visible', resetAtMs: parseLimitResetMs() });
      return;
    }
    send('automation:typing', { stage: 'typing' });
    var imageUrl = ${imageJson};
    var afterAttach = function(){
      setInputText(input, \`${safePrompt}\`);
      // Wait up to ~3s for the send button to become enabled. Many sites
      // disable it until they finish processing the input event, and our
      // previous immediate click was sometimes silently no-op'd.
      var clickAttempts = 0;
      var tryClick = function(){
        clickAttempts++;
        var btn = findSend();
        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true'){
          try { btn.click(); } catch(e){}
          send('automation:typing', { stage: 'sent' });
          waitForResponse();
          return;
        }
        if (clickAttempts < 15){
          setTimeout(tryClick, 200);
          return;
        }
        // Final fallback: synthesize Enter key on the input
        try { input.focus(); } catch(e){}
        var down = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
        var press = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
        var up = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
        input.dispatchEvent(down);
        input.dispatchEvent(press);
        input.dispatchEvent(up);
        send('automation:typing', { stage: 'sent' });
        waitForResponse();
      };
      setTimeout(tryClick, 400);
    };
    if (imageUrl){
      attachImage(input, imageUrl).then(function(){
        // Wait long enough for upload to start AND for the upload preview
        // to register with the chat UI's internal state. ChatGPT in
        // particular needs a beat before it considers the message valid.
        setTimeout(afterAttach, 1400);
      });
    } else {
      afterAttach();
    }
  }

  // Ephemeral status strings that AI sites show inside the response bubble
  // BEFORE actual content (e.g. "Thinking…", "Searching…", "Analyzing…").
  // We must not surface these to the user as the final reply.
  function isStatusOnly(txt){
    if (!txt) return true;
    var t = txt.trim();
    if (t.length === 0) return true;
    // Strip trailing ellipsis/dots
    var core = t.replace(/[\\.\\u2026\\s]+$/g, '').toLowerCase();
    if (core.length === 0) return true;
    // Single short status word(s)
    var statusRe = /^(thinking|reasoning|analy[sz]ing|searching|researching|working|loading|processing|generating|writing|reading|thought for [^\\n]{0,40}|searched [^\\n]{0,40}|browsing|planning|computing|preparing( your)?( response)?)$/;
    if (statusRe.test(core)) return true;
    // Very short text that's probably still a placeholder
    if (t.length <= 3 && /^[\\.\\u2026]+$/.test(t)) return true;
    return false;
  }

  function waitForResponse(){
    var startedAt = Date.now();
    var stableSince = null;
    var lastText = '';
    var sawNew = false;
    var iv = setInterval(function(){
      if (detectLimit()){
        clearInterval(iv);
        send('automation:limit', { reason: 'limit_after_send', resetAtMs: parseLimitResetMs() });
        return;
      }
      var nodes = allResponseNodes();
      // Only consider this a NEW response if either:
      //   1) more bubbles than before were appended, OR
      //   2) the last bubble's text changed from the pre-send baseline.
      var isNew = nodes.length > baseline.count
        || (nodes.length > 0 && nodeText(nodes[nodes.length - 1]) !== baseline.lastText);
      if (!isNew){
        if (Date.now() - startedAt > 90000){
          clearInterval(iv);
          send('automation:error', { reason: 'timeout' });
        }
        return;
      }
      sawNew = true;
      var txt = nodeText(nodes[nodes.length - 1]);
      if (!txt) return;
      // Treat "Thinking…" / "Searching…" / etc. as still-streaming so the
      // local chat never displays them as the final assistant reply.
      if (isStatusOnly(txt)){
        send('automation:typing', { stage: 'thinking' });
        // reset stability — wait for real content
        lastText = '';
        stableSince = null;
        if (Date.now() - startedAt > 120000){
          clearInterval(iv);
          send('automation:error', { reason: 'timeout' });
        }
        return;
      }
      if (txt === lastText){
        if (stableSince && Date.now() - stableSince > 2000){
          clearInterval(iv);
          send('automation:response', { text: txt });
          return;
        }
      } else {
        lastText = txt;
        stableSince = Date.now();
        send('automation:typing', { stage: 'streaming' });
      }
      if (Date.now() - startedAt > 120000){
        clearInterval(iv);
        if (lastText && !isStatusOnly(lastText)) send('automation:response', { text: lastText });
        else send('automation:error', { reason: 'timeout' });
      }
    }, 600);
  }

  setTimeout(tryStart, 600);
})();
true;
`;
}
