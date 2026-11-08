/**
 * Undo/redo stack of moves made since the last scramble or reset. Generic over the move type so
 * every puzzle can use it; `invert` turns a recorded move into the move that undoes it.
 */
export class MoveHistory<M> {
  private done: M[] = [];
  private undone: M[] = [];

  constructor(private readonly invert: (m: M) => M) {}

  /** Record a new move (drops anything that could have been redone). */
  push(move: M): void {
    this.done.push(move);
    this.undone = [];
  }

  /** Returns the move that undoes the last move, or null. */
  undo(): M | null {
    const m = this.done.pop();
    if (m === undefined) return null;
    this.undone.push(m);
    return this.invert(m);
  }

  /** Returns the move to redo, or null. */
  redo(): M | null {
    const m = this.undone.pop();
    if (m === undefined) return null;
    this.done.push(m);
    return m;
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }

  get moves(): readonly M[] {
    return this.done;
  }

  /** Moves that redo would re-apply, in the order they would be applied. */
  get redoable(): readonly M[] {
    return this.undone.slice().reverse();
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }
}
