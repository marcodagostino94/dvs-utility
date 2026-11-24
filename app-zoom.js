// Suppress accidental viewport zoom without cancelling ordinary clicks,
// one-finger scrolling or selection/editing inside text fields.
(() => {
  const preventZoom = (event) => { if (event.cancelable) event.preventDefault(); };
  for (const name of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(name, preventZoom, { passive: false });
  }
  document.addEventListener("wheel", (event) => {
    if (event.ctrlKey || event.metaKey) preventZoom(event);
  }, { passive: false });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && ["+", "=", "-", "0"].includes(event.key)) preventZoom(event);
  });
  document.addEventListener("dblclick", (event) => {
    if (!event.target.closest("input, textarea, [contenteditable]")) preventZoom(event);
  });
})();
