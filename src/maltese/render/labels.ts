import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { FACES, FACE_NORMAL, type Face } from '../geometry';

/** U / D / F / B / L / R badges just outside each face, to teach the notation. */
export class FaceLabels {
  private readonly group = new THREE.Group();
  private readonly badges = new Map<Face, HTMLElement>();
  private readonly tmp = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();

  constructor(private readonly root: THREE.Group) {
    root.add(this.group);
    for (const f of FACES) {
      const el = document.createElement('div');
      el.className = 'part-label';
      el.textContent = f;
      el.title = `${f} face`;
      const obj = new CSS2DObject(el);
      const [x, y, z] = FACE_NORMAL[f];
      const k = 1.62; // clear of edges standing 11 mm proud of a face
      obj.position.set(x * k, y * k, z * k);
      this.group.add(obj);
      this.badges.set(f, el);
    }
  }

  /** Dim badges on the far side (CSS labels are never occluded). */
  update(camera: THREE.Camera): void {
    if (!this.group.visible) return;
    this.camDir.copy(camera.position).normalize();
    for (const [f, el] of this.badges) {
      const facing = this.tmp.set(...FACE_NORMAL[f]).applyQuaternion(this.root.quaternion).dot(this.camDir);
      el.classList.toggle('is-behind', facing < -0.2);
    }
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
    for (const el of this.badges.values()) el.style.display = on ? '' : 'none';
  }

  setActive(face: Face | null): void {
    for (const [f, el] of this.badges) el.classList.toggle('is-active', f === face);
  }
}
