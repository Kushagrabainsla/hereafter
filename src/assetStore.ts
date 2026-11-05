import files from "virtual:public-files";

// Files downloaded ahead of use. While the player sets up a match the chosen map's files are
// fetched here and kept as blobs; when the world is built, Three.js loaders (through the
// default loading manager's URL modifier) and fetch calls (through assetFetch) read them from
// here instead of the network. Once the world is built the blobs are released.

const BASE = import.meta.env.BASE_URL;
const blobs = new Map<string, string>();
const pending = new Map<string, Promise<void>>();

// The size of a public file in bytes, or undefined if there is no such file.
export const publicSize = (path: string): number | undefined => files[path];
export const publicExists = (path: string): boolean => path in files;

// Every public file under any of these path prefixes, but none under the excluded ones.
export function filesUnder(prefixes: string[], exclude: string[] = []): string[] {
  return Object.keys(files).filter((path) => prefixes.some((prefix) => path.startsWith(prefix)) && !exclude.some((prefix) => path.startsWith(prefix)));
}

export const bytesOf = (paths: string[]): number => paths.reduce((sum, path) => sum + (files[path] ?? 0), 0);

// The public path a URL points at ("models/street.glb"), or null for anything else.
function publicPath(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith(BASE)) return null;
    return decodeURIComponent(parsed.pathname.slice(BASE.length));
  } catch {
    return null;
  }
}

// Downloads these public files, a few at a time, reporting every chunk of bytes as it arrives.
// Files already downloaded or on their way are not fetched again. A file that fails is left to
// load from the network later as usual.
export async function prefetch(paths: string[], onBytes: (bytes: number) => void, lanes = 6): Promise<void> {
  const queue = [...paths];
  const fetchOne = async (path: string): Promise<void> => {
    try {
      const response = await fetch(`${BASE}${path}`);
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onBytes(value.byteLength);
      }
      // The listed size counts whole; a compressed or short response makes up the difference.
      const listed = files[path] ?? received;
      if (listed > received) onBytes(listed - received);
      blobs.set(path, URL.createObjectURL(new Blob(chunks, { type: response.headers.get("content-type") ?? "" })));
    } catch {
      // Left to the network.
    }
  };
  await Promise.all(Array.from({ length: lanes }, async () => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      if (blobs.has(path)) { onBytes(files[path] ?? 0); continue; }
      let job = pending.get(path);
      if (!job) { job = fetchOne(path); pending.set(path, job); }
      await job;
    }
  }));
}

// The downloaded copy of a URL if there is one, or the URL itself.
export function assetUrl(url: string): string {
  const path = publicPath(url);
  return (path !== null && blobs.get(path)) || url;
}

// fetch, reading a downloaded copy when there is one.
export const assetFetch = (url: string): Promise<Response> => fetch(assetUrl(url));

// Frees the downloaded copies once everything that needed them has loaded.
export function releaseAssets(): void {
  for (const url of blobs.values()) URL.revokeObjectURL(url);
  blobs.clear();
  pending.clear();
}
