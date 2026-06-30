// ==UserScript==
// @name         WhatsApp passkey bridge (whatsmeow)
// @namespace    whatsmeow
// @version      1.0
// @description  Bridges web.whatsapp.com passkey assertions to a local whatsmeow client.
// @match        https://web.whatsapp.com/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==
(function () {
  "use strict";
  var BASE = "http://127.0.0.1:7799";

  // Page-world signer: runs navigator.credentials.get with page-native buffers, replies via postMessage.
  function pageSigner() {
    var b64url = function (buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
    var fromB64url = function (s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); var pad = s.length % 4 ? "=".repeat(4 - s.length % 4) : ""; var bin = atob(s + pad); var u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
    window.addEventListener("message", function (ev) {
      var d = ev.data;
      if (!d || d.__pkbridge !== "req") return;
      (async function () {
        try {
          var opts = JSON.parse(d.options);
          if (opts.challenge) opts.challenge = fromB64url(opts.challenge);
          if (Array.isArray(opts.allowCredentials)) opts.allowCredentials.forEach(function (c) { if (c.id) c.id = fromB64url(c.id); });
          var cred = await navigator.credentials.get({ publicKey: opts });
          var assertion = {
            id: cred.id, rawId: b64url(cred.rawId), type: cred.type,
            response: {
              clientDataJSON: b64url(cred.response.clientDataJSON),
              authenticatorData: b64url(cred.response.authenticatorData),
              signature: b64url(cred.response.signature),
              userHandle: cred.response.userHandle ? b64url(cred.response.userHandle) : null
            }
          };
          window.postMessage({ __pkbridge: "res", id: d.id, assertion_json: JSON.stringify(assertion), credential_id: b64url(cred.rawId) }, "*");
        } catch (e) {
          window.postMessage({ __pkbridge: "res", id: d.id, error: String(e) }, "*");
        }
      })();
    });
  }

  var script = document.createElement("script");
  script.textContent = "(" + pageSigner.toString() + ")();";
  (document.documentElement || document.head).appendChild(script);
  script.remove();

  var pending = {};
  window.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d || d.__pkbridge !== "res") return;
    var cb = pending[d.id];
    if (cb) { delete pending[d.id]; cb(d); }
  });
  function signInPage(id, options) {
    return new Promise(function (resolve) { pending[id] = resolve; window.postMessage({ __pkbridge: "req", id: id, options: options }, "*"); });
  }
  function gm(method, url, body) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({ method: method, url: url, headers: { "Content-Type": "application/json" }, data: body, onload: resolve, onerror: reject });
    });
  }
  async function tick() {
    try {
      var r = await gm("GET", BASE + "/pending");
      if (r.status === 200 && r.responseText) {
        var job = JSON.parse(r.responseText);
        var res = await signInPage(job.id, job.options);
        var body = res.error
          ? { id: job.id, error: res.error }
          : { id: job.id, assertion_json: res.assertion_json, credential_id: res.credential_id };
        await gm("POST", BASE + "/assertion", JSON.stringify(body));
      }
    } catch (e) { /* bridge not reachable yet */ }
    setTimeout(tick, 1500);
  }
  tick();
  console.log("[passkey-bridge] ativo (Tampermonkey), escutando " + BASE);
})();
