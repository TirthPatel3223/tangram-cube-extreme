import '@fontsource-variable/plus-jakarta-sans';
import './styles.css';
import type { AppContext } from './apps/context';
import { puzzleFromUrl, puzzleTabsHtml } from './ui/puzzleTabs';

// Light / dark theme: the initial value (light unless the visitor chose dark) is set by the inline
// script in index.html.
const THEME_KEY = 'theme-choice';
const themeBtn = document.getElementById('theme-toggle')!;
const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
function applyTheme(t: 'light' | 'dark', save: boolean) {
  document.documentElement.dataset.theme = t;
  themeBtn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  themeMeta?.setAttribute('content', t === 'dark' ? '#0f1419' : '#f8f9fc');
  if (save) {
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* private mode: just don't remember it */
    }
  }
}
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', false);
themeBtn.addEventListener('click', () =>
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true),
);

const params = new URLSearchParams(location.search);
const ctx: AppContext = {
  stageEl: document.getElementById('stage')!,
  panelEl: document.getElementById('panel')!,
  tipEl: document.getElementById('tip')!,
  params,
};

// The puzzle selector above the 3D view.
const puzzle = puzzleFromUrl(params);
document.getElementById('puzzles')!.innerHTML = puzzleTabsHtml(puzzle);

// Each puzzle is its own lazily loaded app, so a tab only downloads what it needs
// (the curved and geared puzzles bring a WebAssembly geometry kernel the Tangram never loads).
const boot =
  puzzle === 'tangram-cube-extreme' || puzzle === 'tangram-cube'
    ? import('./apps/tangram').then((m) => m.start(ctx, puzzle === 'tangram-cube' ? 'original' : 'extreme'))
    : puzzle === 'maltese-gear-cube'
      ? import('./maltese/app').then((m) => m.start(ctx))
      : import('./curvy/app').then((m) => m.start(ctx, puzzle === 'curvy-copter' ? 'cc' : 'plus'));
boot.catch((err: unknown) => {
  console.error(err);
  ctx.panelEl.textContent = 'Sorry, the puzzle failed to load. Try reloading the page.';
});
