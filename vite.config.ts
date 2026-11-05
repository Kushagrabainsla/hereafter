import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";

// Every file in public/ with its size in bytes, as the module "virtual:public-files". The game
// downloads a map's files while the player sets up a match and counts the bytes against these
// sizes, and loads only the voice and meme clips that exist.
function publicFiles(): Plugin {
  const id = "virtual:public-files", resolved = `\0${id}`, root = join(process.cwd(), "public");
  const walk = (dir: string, out: Record<string, number>): Record<string, number> => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const path = join(dir, name), stats = statSync(path);
      if (stats.isDirectory()) walk(path, out);
      else out[relative(root, path).split(sep).join("/")] = stats.size;
    }
    return out;
  };
  return {
    name: "public-files",
    resolveId: (source) => source === id ? resolved : undefined,
    load: (source) => source === resolved ? `export default ${JSON.stringify(walk(root, {}))};` : undefined,
    // A clip built while the dev server runs is listed on the next reload.
    configureServer(server) {
      const refresh = (path: string): void => {
        if (!path.startsWith(root)) return;
        const module = server.moduleGraph.getModuleById(resolved);
        if (module) server.moduleGraph.invalidateModule(module);
      };
      server.watcher.on("add", refresh);
      server.watcher.on("unlink", refresh);
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? "/hereafter/" : "/",
  plugins: [publicFiles()],
  // Keep Rapier's WASM glue in one module graph during local development.
  optimizeDeps: { exclude: ["@dimforge/rapier3d"] },
}));
