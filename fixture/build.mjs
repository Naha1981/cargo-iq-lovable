import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
await build({
  configFile: false,
  root: process.cwd() + "/fixture",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": process.cwd() + "/src" } },
  build: { outDir: "dist", rollupOptions: { input: process.cwd() + "/fixture/admin-health.html" } },
  logLevel: "warn",
});
console.log("built");
