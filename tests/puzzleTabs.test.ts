import { describe, expect, it } from 'vitest';
import { DEFAULT_PUZZLE, PUZZLE_TABS, puzzleFromUrl, puzzleHref, puzzleTabsHtml } from '../src/ui/puzzleTabs';

const from = (query: string) => puzzleFromUrl(new URLSearchParams(query));

describe('puzzle selector', () => {
  it('lists the five puzzles, the Extreme first', () => {
    expect(PUZZLE_TABS.map((t) => t.label)).toEqual([
      'Tangram Cube Extreme',
      'Tangram Cube',
      'Curvy Copter',
      'Curvy Copter Plus',
      'Maltese Gear Cube',
    ]);
    expect(DEFAULT_PUZZLE).toBe('tangram-cube-extreme');
  });

  it('round-trips every tab through its link', () => {
    for (const t of PUZZLE_TABS) expect(from(puzzleHref(t.id).slice(1))).toBe(t.id);
    expect(puzzleHref('tangram-cube-extreme')).toBe('?');
  });

  it('opens the Extreme for a bare or unknown URL', () => {
    expect(from('')).toBe('tangram-cube-extreme');
    expect(from('puzzle=nonsense')).toBe('tangram-cube-extreme');
  });

  it('keeps old links working', () => {
    expect(from('puzzle=tangram')).toBe('tangram-cube-extreme');
    expect(from('variant=original')).toBe('tangram-cube');
    expect(from('puzzle=tangram&variant=original')).toBe('tangram-cube');
    expect(from('variant=extreme')).toBe('tangram-cube-extreme');
  });

  it('marks only the active tab as the current page', () => {
    const html = puzzleTabsHtml('curvy-copter');
    expect(html.match(/aria-current/g)).toHaveLength(1);
    expect(html).toMatch(/href="\?puzzle=curvy-copter" aria-current="page">Curvy Copter</);
  });
});
