import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    // In `npm run dev` there is no Pages Functions runtime, so /api/* is proxied
    // to `wrangler pages dev`. Run `npm run pages:dev` for the full stack.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8788",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
