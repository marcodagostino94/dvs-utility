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
})();
