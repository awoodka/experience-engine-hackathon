// @ts-check
import { defineConfig } from "astro/config";

import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  integrations: [react()],

  server: { port: 7891 },

  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        "/api": "http://localhost:7892",
      },
    },
  },
});
