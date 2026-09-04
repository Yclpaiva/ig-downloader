import { cp, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["src/content.ts", "src/background.ts"],
  outdir: "dist",
  target: "browser",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await cp("manifest.json", "dist/manifest.json");
console.log("dist/ pronto");
