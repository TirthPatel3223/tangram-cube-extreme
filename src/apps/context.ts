/** What the bootstrap (`src/main.ts`) hands to each puzzle app. */
export interface AppContext {
  readonly stageEl: HTMLElement;
  readonly panelEl: HTMLElement;
  readonly tipEl: HTMLElement;
  readonly params: URLSearchParams;
}
