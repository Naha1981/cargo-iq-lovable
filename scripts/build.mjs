// Keep the app and final Cloudflare rebundle in separate processes.
// Nitro otherwise retains the client/SSR compiler graphs (~900 MB) in its final pass.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
if (!process.env.CARGO_BUILD_STAGE) {
  for (const stage of ["app", "worker"]) {
    const r = spawnSync(
      process.execPath,
      [
        "--max-old-space-size=1100",
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
    await builder.buildApp();
  }
}
