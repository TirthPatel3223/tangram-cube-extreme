import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

/** The Tangram app's camera presets. Other puzzles pass their own presets to `createStage`. */
export type ViewName = 'prism' | 'cube';

export interface ViewPreset {
  /** World-from-model rotation, given as rows (model vector p -> (row0·p, row1·p, row2·p)). */
  rows: [number[], number[], number[]];
  /** Viewing direction (spherical): azimuth around +Y from +Z, elevation above the horizon, in degrees. */
  azimuth: number;
  elevation: number;
}

const S2 = Math.SQRT2;
const S3 = Math.sqrt(3);
const S6 = Math.sqrt(6);

export const TANGRAM_VIEWS: Readonly<Record<ViewName, ViewPreset>> = {
  // Corner T straight up (the turning diagonal vertical) and the F flip edge facing the viewer.
  prism: {
    rows: [
      [1 / S6, 1 / S6, -2 / S6],
      [1 / S3, 1 / S3, 1 / S3],
      [1 / S2, -1 / S2, 0],
    ],
    azimuth: -12,
    elevation: 24,
  },
  // Classic cube view like the retail photo: green (+z) on top, white (-y) front-left, orange (+x) front-right.
  cube: {
    rows: [
      [1, 0, 0],
      [0, 0, 1],
      [0, -1, 0],
    ],
    azimuth: 45,
    elevation: 27,
  },
};

const DEFAULT_DISTANCE = 9.4;
const MIN_DISTANCE = 4.2;
const MAX_DISTANCE = 22;
/** Radians of rotation per pixel of pointer travel. */
export const ROTATE_PER_PX = 0.0065;
/** Time constant of the spin that continues after a flick, in ms. */
const SPIN_DECAY_MS = 240;

export interface Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly labelRenderer: CSS2DRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Parent of all puzzle meshes; its local frame is the puzzle model frame. */
  readonly root: THREE.Group;
  setView(name: string, animate?: boolean): void;
  /**
   * Rotate the puzzle freely about the screen axes, as if dragging its front surface by (dx, dy)
   * pixels. There is no up-vector and no angle limit: it can roll over in any direction.
   */
  rotateBy(dx: number, dy: number, radPerPx?: number): void;
  /** Keep spinning after a flick (velocity in pixels per millisecond), slowing down smoothly. */
  fling(vx: number, vy: number): void;
  /** Stop any spin or view transition (e.g. when the user grabs the puzzle). */
  stopMotion(): void;
  /** Multiply the camera distance (factor < 1 zooms in). */
  zoomBy(factor: number): void;
  /** Advance spin/transitions and render one frame. */
  frame(nowMs: number): void;
  resize(): void;
}

/**
 * Root orientation that shows the preset with the camera fixed on +Z: the old "camera orbiting a
 * fixed puzzle" view expressed as "fixed camera, rotated puzzle".
 */
function presetQuaternion(p: ViewPreset): THREE.Quaternion {
  const m = new THREE.Matrix4().set(
    p.rows[0][0], p.rows[0][1], p.rows[0][2], 0,
    p.rows[1][0], p.rows[1][1], p.rows[1][2], 0,
    p.rows[2][0], p.rows[2][1], p.rows[2][2], 0,
    0, 0, 0, 1,
  );
  const model = new THREE.Quaternion().setFromRotationMatrix(m);
  const az = THREE.MathUtils.degToRad(p.azimuth);
  const el = THREE.MathUtils.degToRad(p.elevation);
  const eye = new THREE.PerspectiveCamera();
  eye.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  eye.lookAt(0, 0, 0);
  return eye.quaternion.clone().invert().multiply(model);
}

export function createStage(
  container: HTMLElement,
  views: Readonly<Record<string, ViewPreset>> = TANGRAM_VIEWS,
  initialView = 'prism',
): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Neutral tone mapping keeps sticker colours true (ACES washes saturated plastics out).
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.classList.add('stage-canvas');
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.classList.add('stage-labels');
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  // Lights are fixed relative to the viewer, so the puzzle is lit the same way however it is turned.
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-3, 6, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(5, 1, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xdfe8ff, 0.5);
  rim.position.set(2, 3, -6);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  let distance = DEFAULT_DISTANCE;
  const placeCamera = () => {
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    // The CSS halo behind the puzzle scales with the puzzle's apparent size.
    container.style.setProperty('--zoom', String(DEFAULT_DISTANCE / distance));
  };
  placeCamera();

  const root = new THREE.Group();
  scene.add(root);

  const spin = { vx: 0, vy: 0 };
  let lastFrame = performance.now();
  let transition: {
    q0: THREE.Quaternion;
    q1: THREE.Quaternion;
    d0: number;
    start: number;
    duration: number;
  } | null = null;

  const axis = new THREE.Vector3();
  const dq = new THREE.Quaternion();

  const rotateBy = (dx: number, dy: number, radPerPx = ROTATE_PER_PX) => {
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    transition = null;
    // Dragging right turns the front towards +X (about +Y); dragging down turns it towards -Y (about +X).
    axis.set(dy / len, dx / len, 0);
    dq.setFromAxisAngle(axis, len * radPerPx);
    root.quaternion.premultiply(dq).normalize();
  };

  const fling = (vx: number, vy: number) => {
    spin.vx = vx;
    spin.vy = vy;
  };

  const stopMotion = () => {
    spin.vx = 0;
    spin.vy = 0;
    transition = null;
  };

  const zoomBy = (factor: number) => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    distance = THREE.MathUtils.clamp(distance * factor, MIN_DISTANCE, MAX_DISTANCE);
    placeCamera();
  };

  const setView = (name: string, animate = true) => {
    const preset = views[name];
    if (!preset) return;
    const q1 = presetQuaternion(preset);
    spin.vx = 0;
    spin.vy = 0;
    if (!animate) {
      root.quaternion.copy(q1);
      distance = DEFAULT_DISTANCE;
      placeCamera();
      transition = null;
      return;
    }
    transition = { q0: root.quaternion.clone(), q1, d0: distance, start: performance.now(), duration: 650 };
  };

  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    // Keep the whole puzzle in view on narrow screens.
    camera.fov = camera.aspect < 0.85 ? (30 / Math.max(camera.aspect, 0.55)) * 0.85 : 30;
    camera.updateProjectionMatrix();
  };

  const frame = (now: number) => {
    const dt = Math.min(64, Math.max(0, now - lastFrame));
    lastFrame = now;
    if (transition) {
      const t = Math.min(1, (now - transition.start) / transition.duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      root.quaternion.slerpQuaternions(transition.q0, transition.q1, e);
      distance = THREE.MathUtils.lerp(transition.d0, DEFAULT_DISTANCE, e);
      placeCamera();
      if (t >= 1) transition = null;
    } else if (spin.vx !== 0 || spin.vy !== 0) {
      rotateBy(spin.vx * dt, spin.vy * dt);
      const k = Math.exp(-dt / SPIN_DECAY_MS);
      spin.vx *= k;
      spin.vy *= k;
      if (Math.hypot(spin.vx, spin.vy) < 0.003) stopMotion();
    }
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };

  new ResizeObserver(resize).observe(container);
  resize();
  setView(initialView, false);

  return { renderer, labelRenderer, scene, camera, root, setView, rotateBy, fling, stopMotion, zoomBy, frame, resize };
}
