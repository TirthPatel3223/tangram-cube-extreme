/**
 * The puzzle tabs at the top of the side panel. Each tab is a plain link to `?puzzle=<id>`, so tabs
 * are shareable, open in a new browser tab with a middle-click, and switching reloads a clean app.
 */
export type PuzzleTabId = 'tangram' | 'curvy-copter' | 'curvy-copter-plus';

export const PUZZLE_TABS: ReadonlyArray<{ readonly id: PuzzleTabId; readonly label: string }> = [
  { id: 'tangram', label: 'Tangram Cube' },
  { id: 'curvy-copter', label: 'Curvy Copter' },
  { id: 'curvy-copter-plus', label: 'Curvy Copter Plus' },
];

/** URL (query only, so it works from any sub-folder) that opens a puzzle tab. */
export function puzzleHref(id: PuzzleTabId): string {
  return id === 'tangram' ? '?' : `?puzzle=${id}`;
}

/** Read the active tab from the page URL (Tangram when absent or unknown). */
export function puzzleFromUrl(params: URLSearchParams): PuzzleTabId {
  const p = params.get('puzzle');
  return p === 'curvy-copter' || p === 'curvy-copter-plus' ? p : 'tangram';
}

export function puzzleTabsHtml(active: PuzzleTabId): string {
  const links = PUZZLE_TABS.map(
    (t) =>
      `<a class="tabs__tab" href="${puzzleHref(t.id)}"${t.id === active ? ' aria-current="page"' : ''}>${t.label}</a>`,
  ).join('');
  return `<nav class="tabs" aria-label="Puzzle">${links}</nav>`;
}
