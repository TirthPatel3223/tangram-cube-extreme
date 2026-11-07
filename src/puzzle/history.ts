import { type Move, invertMove } from './moves';

/** Undo/redo stack of moves made since the last scramble or reset. */
export class MoveHistory {
  private done: Move[] = [];
  private undone: Move[] = [];

  /** Record a new move (drops anything that could have been redone). */
  push(move: Move): void {
    this.done.push(move);
    this.undone = [];
  }

  /** Returns the move that undoes the last move, or null. */
  undo(): Move | null {
    const m = this.done.pop();
    if (!m) return null;
    this.undone.push(m);
    return invertMove(m);
  }

  /** Returns the move to redo, or null. */
  redo(): Move | null {
    const m = this.undone.pop();
    if (!m) return null;
    this.done.push(m);
    return m;
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }

  get moves(): readonly Move[] {
    return this.done;
  }

  /** Moves that redo would re-apply, in the order they would be applied. */
  get redoable(): readonly Move[] {
    return this.undone.slice().reverse();
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }
}
