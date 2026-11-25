// An input is always single-line, even on paper. Use a wrapping text copy
// for PDF output and keep the editable input unchanged on screen.
(() => {
  function prepareTitles() {
    document.querySelectorAll(".report-title-input").forEach((input) => {
      let title = input.nextElementSibling;
      if (!title || !title.classList.contains("print-report-title")) {
        title = document.createElement("div");
        title.className = "print-report-title";
        input.after(title);
      }
      title.textContent = input.value;
    });
  }
  window.addEventListener("beforeprint", prepareTitles);
  let scheduled = false;
  function resizeTitles() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      document.querySelectorAll("textarea.report-title-input").forEach((field) => {
        if (!field.getClientRects().length) return;
        field.style.height = "auto";
        field.style.height = `${field.scrollHeight + 2}px`;
      });
    });
  }
  document.addEventListener("input", (event) => {
    if (event.target.matches("textarea.report-title-input")) resizeTitles();
  });
  new MutationObserver(resizeTitles).observe(document.body, {childList:true, subtree:true, attributes:true, attributeFilter:["class"]});
  window.addEventListener("resize", resizeTitles);
  window.addEventListener("afterprint", resizeTitles);
  document.fonts?.ready.then(resizeTitles);
  resizeTitles();
})();
