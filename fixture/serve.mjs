import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const server = await createServer({
  configFile: false,
  root: process.cwd() + "/fixture",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": process.cwd() + "/src" } },
  server: { port: 5199, strictPort: true },
  logLevel: "error",
});
await server.listen();
console.log("listening");
