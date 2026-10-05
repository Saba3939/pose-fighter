import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: new URL("./index.html", import.meta.url).pathname,
        camera: new URL("./diagnostics.html", import.meta.url).pathname,
        game: new URL("./game.html", import.meta.url).pathname,
      },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@mediapipe/tasks-vision/wasm/*",
          dest: "mediapipe/wasm",
          rename: { stripBase: true },
        },
      ],
    }),
  ],
});
