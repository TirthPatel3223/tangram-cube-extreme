/**
 * The puzzle selector, centred above the 3D view. Each tab is a plain link to `?puzzle=<id>`, so
 * tabs are shareable, open in a new browser tab with a middle-click, and switching reloads a clean app.
 */
export type PuzzleTabId = 'tangram-cube-extreme' | 'tangram-cube' | 'curvy-copter' | 'curvy-copter-plus' | 'maltese-gear-cube';

export const PUZZLE_TABS: ReadonlyArray<{ readonly id: PuzzleTabId; readonly label: string }> = [
  { id: 'tangram-cube-extreme', label: 'Tangram Cube Extreme' },
  { id: 'tangram-cube', label: 'Tangram Cube' },
  { id: 'curvy-copter', label: 'Curvy Copter' },
  { id: 'curvy-copter-plus', label: 'Curvy Copter Plus' },
  { id: 'maltese-gear-cube', label: 'Maltese Gear Cube' },
];

/** The puzzle the bare site URL opens. */
export const DEFAULT_PUZZLE: PuzzleTabId = 'tangram-cube-extreme';

/** URL (query only, so it works from any sub-folder) that opens a puzzle tab. */
export function puzzleHref(id: PuzzleTabId): string {
  return id === DEFAULT_PUZZLE ? '?' : `?puzzle=${id}`;
}

/**
 * Read the active tab from the page URL. Older links still work: `?puzzle=tangram` (or none) opens
 * the Extreme, and `?variant=original` the original Tangram Cube.
 */
export function puzzleFromUrl(params: URLSearchParams): PuzzleTabId {
  const p = params.get('puzzle');
  const tab = PUZZLE_TABS.find((t) => t.id === p);
  if (tab) return tab.id;
  if ((p === null || p === 'tangram') && params.get('variant') === 'original') return 'tangram-cube';
  return DEFAULT_PUZZLE;
}

export function puzzleTabsHtml(active: PuzzleTabId): string {
  return PUZZLE_TABS.map(
    (t) =>
      `<a class="puzzles__tab" href="${puzzleHref(t.id)}"${t.id === active ? ' aria-current="page"' : ''}>${t.label}</a>`,
  ).join('');
}
