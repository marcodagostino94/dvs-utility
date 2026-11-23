// Check when the installed app is opened or brought back to the foreground.
// Never reload a document containing unsaved work without a user's click.
(() => {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let registration;
  let offered = false;
  function offerReload() {
    if (offered || !hadController) return;
    offered = true;
    const banner = document.createElement("aside");
    banner.setAttribute("role", "status");
    banner.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:10000;background:#202a25;color:white;border:1px solid #32d874;border-radius:16px;padding:16px;box-shadow:0 8px 35px #0008;max-width:calc(100vw - 32px);font:14px system-ui;display:flex;gap:16px;align-items:center";
    const text = document.createElement("span");
    text.textContent = "Aggiornamento pronto. Salva il lavoro prima di ricaricare.";
    const button = document.createElement("button");
    button.textContent = "Aggiorna ora";
    button.style.cssText = "background:#32d874;color:#071b10;border:0;border-radius:9px;padding:10px 14px;cursor:pointer;font-weight:700;white-space:nowrap";
    button.addEventListener("click", () => location.reload());
    banner.append(text, button);
    document.body.append(banner);
  }
  navigator.serviceWorker.addEventListener("controllerchange", offerReload);
  async function check() {
    if (registration && navigator.onLine) {
      try { await registration.update(); } catch { /* Keep offline usage working. */ }
    }
  }
  window.addEventListener("load", async () => {
    try {
      registration = await navigator.serviceWorker.register("./sw.js", {updateViaCache: "none"});
      await check();
    } catch { /* The application also works without a service worker. */ }
  });
  window.addEventListener("online", check);
  window.addEventListener("pageshow", check);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
})();
