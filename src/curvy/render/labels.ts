import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EDGES, EDGE_HANDLE, type EdgeName } from '../geometry';

/** UF / UR / … badges just outside each edge, to teach the notation. */
export class EdgeLabels {
  private readonly group = new THREE.Group();
  private readonly badges = new Map<EdgeName, HTMLElement>();
  private readonly dirs = new Map<EdgeName, THREE.Vector3>();
  private readonly tmp = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();

  constructor(private readonly root: THREE.Group) {
    root.add(this.group);
    for (const e of EDGES) {
      const el = document.createElement('div');
      el.className = 'part-label';
      el.textContent = e;
      el.title = `${e} edge`;
      const obj = new CSS2DObject(el);
      const [x, y, z] = EDGE_HANDLE[e];
      const k = 1.32;
      obj.position.set(x * k, y * k, z * k);
      this.group.add(obj);
      this.badges.set(e, el);
      this.dirs.set(e, new THREE.Vector3(x, y, z).normalize());
    }
  }

  /** Dim badges on the far side (CSS labels are never occluded). */
  update(camera: THREE.Camera): void {
    if (!this.group.visible) return;
    this.camDir.copy(camera.position).normalize();
    for (const [e, el] of this.badges) {
      const facing = this.tmp.copy(this.dirs.get(e)!).applyQuaternion(this.root.quaternion).dot(this.camDir);
      el.classList.toggle('is-behind', facing < -0.2);
    }
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
    for (const el of this.badges.values()) el.style.display = on ? '' : 'none';
  }

  setActive(edge: EdgeName | null, blocked = false): void {
    for (const [e, el] of this.badges) {
      el.classList.toggle('is-active', e === edge);
      el.classList.toggle('is-blocked', e === edge && blocked);
    }
  }
}
