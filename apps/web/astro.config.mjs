// @ts-check
import { defineConfig } from "astro/config";
import { resolve } from "node:path";
import { existsSync, createReadStream, statSync } from "node:fs";

import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

const dataDir = resolve(import.meta.dirname, "../../data");

/** Vite plugin that serves files from the project data/ directory at /data/. */
function serveDataDir() {
  return {
    name: "serve-data-dir",
    configureServer(/** @type {any} */ server) {
      server.middlewares.use(
        "/data",
        (
          /** @type {any} */ req,
          /** @type {any} */ res,
          /** @type {any} */ next,
        ) => {
          const urlPath = decodeURIComponent(req.url?.split("?")[0] ?? "");
          if (urlPath.includes("..")) return next();

          const filePath = resolve(dataDir, urlPath.replace(/^\//, ""));
          if (!filePath.startsWith(dataDir) || !existsSync(filePath)) {
            return next();
          }

          const stat = statSync(filePath);
          if (!stat.isFile()) return next();

          const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
          const mimeTypes = /** @type {Record<string, string>} */ ({
            mp4: "video/mp4",
            mov: "video/quicktime",
            webm: "video/webm",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            json: "application/json",
            md: "text/markdown",
          });
          const contentType = mimeTypes[ext] ?? "application/octet-stream";

          // Handle range requests for video seeking
          const range = req.headers.range;
          if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
            const chunkSize = end - start + 1;

            res.writeHead(206, {
              "Content-Range": `bytes ${start}-${end}/${stat.size}`,
              "Accept-Ranges": "bytes",
              "Content-Length": chunkSize,
              "Content-Type": contentType,
            });
            createReadStream(filePath, { start, end }).pipe(res);
          } else {
            res.writeHead(200, {
              "Content-Length": stat.size,
              "Content-Type": contentType,
              "Accept-Ranges": "bytes",
            });
            createReadStream(filePath).pipe(res);
          }
        },
      );
    },
  };
}

// https://astro.build/config
export default defineConfig({
  integrations: [react()],

  server: { port: 7891 },

  vite: {
    plugins: [tailwindcss(), serveDataDir()],
    server: {
      proxy: {
        "/api": "http://localhost:7892",
      },
    },
  },
});
