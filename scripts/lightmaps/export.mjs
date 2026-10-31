// Runs scripts/lightmaps/export.html in headless Chrome against a Vite dev server and writes
// what it exports: the surfaces to bake (assets-src/lightmaps/night-market.glb), the lamps
// and the sun (night-market-scene.json beside it), and the atlas coordinates the game reads
// (public/lightmaps/night-market.json; bake.py fills in its bounce scale).
// Set CHROME to the Chrome or Chromium executable if it is not in the default macOS place.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9300 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await createServer({ root, logLevel: "error", server: { port: 0 } });
await server.listen();
const base = server.resolvedUrls.local[0];
const profile = await mkdtemp(join(tmpdir(), "hereafter-lightmap-"));
const browser = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
try {
  let page = null;
  for (let i = 0; i < 60 && !page; i += 1) {
    await sleep(500);
    page = await fetch(`http://127.0.0.1:${port}/json/new?${base}scripts/lightmaps/export.html`, { method: "PUT" }).then((r) => r.json()).catch(() => null);
  }
  if (!page) throw new Error("Chrome did not start");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", ({ data }) => { const m = JSON.parse(data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
  const evaluate = (expression) => new Promise((resolveCall) => { const id = ++seq; pending.set(id, resolveCall); ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
  // Vite may reload the page once while it optimises dependencies, so wait until the
  // export function has been there for a couple of seconds.
  let since = 0;
  for (let i = 0; i < 240 && since < 4; i += 1) {
    await sleep(500);
    since = (await evaluate("typeof window.__lightmapExport === 'function'")).result?.result?.value ? since + 1 : 0;
  }
  let reply = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    reply = await evaluate("window.__lightmapExport()");
    if (!reply.result?.exceptionDetails && reply.result?.result?.value) break;
    await sleep(3000);
  }
  if (!reply.result?.result?.value) throw new Error(JSON.stringify(reply.result?.exceptionDetails ?? reply).slice(0, 2000));
  const { glb, data, scene } = reply.result.result.value;
  await mkdir(join(root, "assets-src/lightmaps"), { recursive: true });
  await mkdir(join(root, "public/lightmaps"), { recursive: true });
  await writeFile(join(root, "assets-src/lightmaps/night-market.glb"), Buffer.from(glb, "base64"));
  await writeFile(join(root, "assets-src/lightmaps/night-market-scene.json"), JSON.stringify(scene, null, 1));
  await writeFile(join(root, "public/lightmaps/night-market.json"), JSON.stringify(data));
  console.log(`exported ${data.looks.length} surfaces in ${scene.charts} charts at ${scene.density.toFixed(1)} texels per metre`);
  ws.close();
} finally {
  const exited = new Promise((resolveExit) => browser.once("exit", resolveExit));
  browser.kill();
  await Promise.race([exited, sleep(5000)]);
  await server.close();
  // Chrome may still be writing its profile as it quits; a leftover temp folder is harmless.
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => undefined);
}
