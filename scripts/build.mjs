// Keep the app and final Cloudflare rebundle in separate processes.
// Nitro otherwise retains the client/SSR compiler graphs (~900 MB) in its final pass.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cp, mkdtemp, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const args = process.argv.slice(2);
if (!process.env.CARGO_BUILD_STAGE) {
  for (const stage of ["app", "worker"]) {
    const r = spawnSync(
      process.execPath,
      [
        "--max-old-space-size=1600",
        "--max-semi-space-size=8",
        fileURLToPath(import.meta.url),
        ...args,
      ],
      { stdio: "inherit", env: { ...process.env, CARGO_BUILD_STAGE: stage } },
    );
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
} else {
  const { createBuilder } = await import("vite");
  const modeIndex = args.indexOf("--mode");
  const builder = await createBuilder(modeIndex >= 0 ? { mode: args[modeIndex + 1] } : {});
  if (process.env.CARGO_BUILD_STAGE === "app") {
    await builder.build(builder.environments.client);
    await builder.build(builder.environments.ssr);
  } else {
    builder.environments.client.isBuilt = true;
    builder.environments.ssr.isBuilt = true;
    // Nitro prepares (clears) its output before final bundling. Since this is a
    // fresh process, preserve the client build and restore it after that clear.
    const clientDir = builder.environments.client.config.build.outDir;
    const saved = await mkdtemp(join(tmpdir(), "cargo-client-"));
    await cp(clientDir, saved, { recursive: true });
    const prepare = builder.config.plugins.find((p) => p.name === "nitro:prepare");
    if (!prepare || typeof prepare.buildApp !== "object")
      throw new Error("Expected Nitro prepare hook; refusing incomplete release");
    const original = prepare.buildApp.handler;
    prepare.buildApp.handler = async function (...hookArgs) {
      await original.apply(this, hookArgs);
      await cp(saved, clientDir, { recursive: true });
    };
    try {
      await builder.buildApp();
      const assets = await readdir(join(clientDir, "assets"));
      if (!assets.some((f) => f.endsWith(".js")) || !assets.some((f) => f.endsWith(".css")))
        throw new Error("Client JS/CSS missing from release output");
      for (const file of assets) {
        if (!(await stat(join(clientDir, "assets", file))).size)
          throw new Error(`Empty client release asset: ${file}`);
      }
      console.log(`Verified ${assets.length} client release assets survive final worker build`);
    } finally {
      await rm(saved, { recursive: true, force: true });
    }
  }
}
