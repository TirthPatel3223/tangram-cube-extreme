import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { AXES, type Axis } from '../puzzle/moves';
import type { PuzzleModel } from '../puzzle/model';

/** U / D / F / R / L badges just outside each turning part, to teach the notation. */
export class PartLabels {
  private readonly group = new THREE.Group();
  private readonly badges = new Map<Axis, HTMLElement>();
  private readonly dirs = new Map<Axis, THREE.Vector3>();
  private readonly tmp = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();

  constructor(private readonly root: THREE.Group) {
    root.add(this.group);
  }

  /** Dim the badges of parts on the far side of the puzzle (CSS labels are never occluded). */
  update(camera: THREE.Camera): void {
    if (!this.group.visible) return;
    this.camDir.copy(camera.position).normalize();
    for (const [axis, el] of this.badges) {
      const facing = this.tmp.copy(this.dirs.get(axis)!).applyQuaternion(this.root.quaternion).dot(this.camDir);
      el.classList.toggle('is-behind', facing < -0.2);
    }
  }

  build(model: PuzzleModel): void {
    for (const child of [...this.group.children]) {
      if (child instanceof CSS2DObject) child.element.remove();
    }
    this.group.clear();
    this.badges.clear();
    this.dirs.clear();
    for (const axis of AXES) {
      const def = model.axes[axis];
      const el = document.createElement('div');
      el.className = `part-label part-label--${def.kind}`;
      el.textContent = axis;
      el.title = def.kind === 'corner' ? `${axis}: corner layer` : `${axis}: edge flip (180°)`;
      const obj = new CSS2DObject(el);
      const [x, y, z] = def.handle;
      const k = def.kind === 'corner' ? 1.2 : 1.36;
      obj.position.set(x * k, y * k, z * k);
      this.group.add(obj);
      this.badges.set(axis, el);
      this.dirs.set(axis, new THREE.Vector3(x, y, z).normalize());
    }
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
    for (const el of this.badges.values()) el.style.display = on ? '' : 'none';
  }

  setActive(axis: Axis | null): void {
    for (const [a, el] of this.badges) el.classList.toggle('is-active', a === axis);
  }
}
