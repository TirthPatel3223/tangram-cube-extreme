import type { ManifoldToplevel } from 'manifold-3d';

/** Load manifold-3d (mesh booleans in WebAssembly). In the browser pass the URL of manifold.wasm. */
export async function loadManifoldKernel(wasmUrl?: string): Promise<ManifoldToplevel> {
  const { default: Module } = await import('manifold-3d');
  const wasm = await Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  wasm.setup();
  return wasm;
}

/** Run `fn` with a `keep` function; every WASM object passed to it is deleted afterwards. */
export function scoped<T>(fn: (keep: <M extends { delete(): void }>(m: M) => M) => T): T {
  const owned: Array<{ delete(): void }> = [];
  try {
    return fn((m) => {
      owned.push(m);
      return m;
    });
  } finally {
    for (const m of owned) m.delete();
  }
}
