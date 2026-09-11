/// <reference types="vitest/config" />
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const runtimePath = resolve(process.cwd(), ".runtime/firmdepth.json");

function runtimeArtifact() {
  return {
    name: "firmdepth-runtime-artifact",
    configureServer(server: { middlewares: { use: (path: string, handler: (request: unknown, response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use("/runtime/firmdepth.json", async (_request, response, next) => {
        try {
          const body = await readFile(runtimePath, "utf8");
          response.statusCode = 200;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.setHeader("cache-control", "no-store");
          response.end(body);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") next();
          else {
            response.statusCode = 500;
            response.end("Runtime artifact unavailable");
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), runtimeArtifact()],
  server: { port: 4173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: "es2022", sourcemap: true },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], css: true, include: ["src/**/*.test.{ts,tsx}"] },
});
