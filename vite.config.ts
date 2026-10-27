import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumDirectory = "cesiumStatic";

export default defineConfig(({ mode }) => {
  const base = mode === "pages" ? "/hereafter/" : "/";

  return {
    base,
    define: {
      CESIUM_BASE_URL: JSON.stringify(`${base}${cesiumDirectory}/`),
    },
    plugins: [
      viteStaticCopy({
        targets: ["ThirdParty", "Workers", "Assets", "Widgets"].map((name) => ({
          src: `${cesiumSource}/${name}/**/*`,
          dest: `${cesiumDirectory}/${name}`,
          rename: { stripBase: 5 },
        })),
      }),
    ],
  };
});
