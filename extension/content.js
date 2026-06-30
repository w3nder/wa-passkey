// Content script: one widget on web.whatsapp.com that (1) shows the bridge status and auto-signs the
// passkey when whatsmeow requests it, and (2) has a button to check the account's passkey.
(function () {
  "use strict";
  var BASE = "http://127.0.0.1:7799";

  var inject = document.createElement("script");
  inject.src = chrome.runtime.getURL("inject.js");
  inject.onload = function () { inject.remove(); };
  (document.documentElement || document.head).appendChild(inject);

  // ---- UI ----------------------------------------------------------------
  var widget = document.createElement("div");
  Object.assign(widget.style, {
    position: "fixed", bottom: "16px", right: "16px", zIndex: 2147483647,
    width: "300px", background: "#111b21", color: "#e9edef", borderRadius: "12px",
    boxShadow: "0 6px 22px rgba(0,0,0,.5)", fontFamily: "system-ui, sans-serif", fontSize: "13px",
    overflow: "hidden",
  });
  widget.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#202c33;font-weight:600">' +
      '<span id="pk-dot" style="width:9px;height:9px;border-radius:50%;background:#8696a0;display:inline-block"></span>' +
      '<span style="flex:1">WhatsApp passkey</span>' +
      '<span id="pk-min" title="Minimizar" style="cursor:pointer;opacity:.65;padding:0 5px;font-size:16px;line-height:1">–</span>' +
      '<span id="pk-close" title="Fechar" style="cursor:pointer;opacity:.65;padding:0 4px;font-size:16px;line-height:1">×</span>' +
    '</div>' +
    '<div id="pk-body" style="padding:12px">' +
      '<div id="pk-status" style="color:#8696a0;margin-bottom:10px">Conectando ao whatsmeow…</div>' +
      '<button id="pk-check" style="width:100%;padding:9px;border:none;border-radius:8px;cursor:pointer;background:#25D366;color:#073127;font-weight:600;font-size:13px">🔑 Verificar passkey</button>' +
      '<div id="pk-result" style="margin-top:10px;white-space:pre-wrap;word-break:break-word;line-height:1.45"></div>' +
    '</div>';
  document.documentElement.appendChild(widget);

  var dot = widget.querySelector("#pk-dot");
  var statusEl = widget.querySelector("#pk-status");
  var resultEl = widget.querySelector("#pk-result");
  var body = widget.querySelector("#pk-body");

  // Floating launcher to reopen after closing (the bridge keeps working while hidden).
  var launcher = document.createElement("button");
  launcher.textContent = "🔑";
  launcher.title = "Abrir WhatsApp passkey";
  Object.assign(launcher.style, {
    position: "fixed", bottom: "16px", right: "16px", zIndex: 2147483647,
    width: "44px", height: "44px", borderRadius: "50%", border: "none", cursor: "pointer",
    background: "#25D366", fontSize: "20px", boxShadow: "0 4px 14px rgba(0,0,0,.4)", display: "none",
  });
  document.documentElement.appendChild(launcher);

  function openWidget() { widget.style.display = "block"; launcher.style.display = "none"; localStorage.removeItem("pk-closed"); }
  function closeWidget() { widget.style.display = "none"; launcher.style.display = "block"; localStorage.setItem("pk-closed", "1"); }
  function toggleMin() {
    var hidden = body.style.display === "none";
    body.style.display = hidden ? "block" : "none";
    localStorage.setItem("pk-min", hidden ? "0" : "1");
  }
  widget.querySelector("#pk-close").addEventListener("click", closeWidget);
  widget.querySelector("#pk-min").addEventListener("click", toggleMin);
  launcher.addEventListener("click", openWidget);

  // Restore last UI state (the signing loop runs regardless of visibility).
  if (localStorage.getItem("pk-closed") === "1") closeWidget();
  if (localStorage.getItem("pk-min") === "1") body.style.display = "none";

  function setStatus(online, text) {
    dot.style.background = online ? "#25D366" : "#8696a0";
    statusEl.textContent = text;
  }
  function setResult(html) { resultEl.innerHTML = html; }
  function describe(att) {
    if (att === "platform") return "🖥️ Neste dispositivo (ex.: Touch ID do Mac). Assina sem celular, sem Bluetooth.";
    if (att === "cross-platform") return "📱 No celular/chave. Precisa dele por perto (Bluetooth).";
    return "tipo: " + att;
  }

  widget.querySelector("#pk-check").addEventListener("click", function () {
    setResult("Abrindo o prompt do sistema… confirme.");
    window.postMessage({ __pk: "check" }, "*");
  });

  // ---- relay to page-world inject.js ------------------------------------
  var pending = {};
  window.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d) return;
    if (d.__pk === "sign-res") {
      var cb = pending[d.id];
      if (cb) { delete pending[d.id]; cb(d); }
    } else if (d.__pk === "check-res") {
      if (d.ok) {
        setResult("<b style='color:#25D366'>✅ Passkey encontrada</b>\n" + describe(d.attachment) + "\n\nid: " + d.id);
      } else if (d.name === "NotAllowedError") {
        setResult("<b style='color:#f15c6d'>❌ Sem passkey usada</b>\nVocê cancelou, ou esta conta não tem passkey.");
      } else {
        setResult("<b style='color:#f15c6d'>⚠️ " + d.name + "</b>\n" + d.message);
      }
    }
  });
  function signInPage(id, options) {
    return new Promise(function (resolve) { pending[id] = resolve; window.postMessage({ __pk: "sign", id: id, options: options }, "*"); });
  }

  // ---- bridge loop -------------------------------------------------------
  function bgFetch(method, url, body) {
    return chrome.runtime.sendMessage({ type: "pkbridge-fetch", method: method, url: url, body: body });
  }
  async function tick() {
    try {
      var r = await bgFetch("GET", BASE + "/pending");
      setStatus(!!r, r ? "Bridge online — pronto para assinar." : "whatsmeow offline (rode -mode bridge).");
      if (r && r.status === 200 && r.text) {
        var job = JSON.parse(r.text);
        setResult("whatsmeow pediu a passkey — confirme o prompt…");
        var res = await signInPage(job.id, job.options);
        var body = res.error
          ? { id: job.id, error: res.error }
          : { id: job.id, assertion_json: res.assertion_json, credential_id: res.credential_id };
        await bgFetch("POST", BASE + "/assertion", JSON.stringify(body));
        setResult(res.error ? "<b style='color:#f15c6d'>Erro ao assinar</b>\n" + res.error : "<b style='color:#25D366'>Assinado ✅</b> — vínculo seguindo.");
      }
    } catch (e) {
      setStatus(false, "whatsmeow offline (rode -mode bridge).");
    }
    setTimeout(tick, 1500);
  }
  tick();
  console.log("[wa-passkey] extensão ativa no web.whatsapp.com");
})();
