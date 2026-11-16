(() => {
  const overlay = document.getElementById('appIntro');
  if (!overlay || overlay.dataset.started) return;
  overlay.dataset.started = 'true';
  const panels = [...document.querySelectorAll('.app-shell')];
  const previous = panels.map(panel => panel.inert);
  panels.forEach(panel => { panel.inert = true; });
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finish = () => {
    overlay.classList.add('is-finished');
    setTimeout(() => {
      overlay.remove();
      panels.forEach((panel, i) => { panel.inert = previous[i]; });
    }, reduced ? 0 : 400);
  };
  setTimeout(finish, reduced ? 150 : 3100);
})();

