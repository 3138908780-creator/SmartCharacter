import { build as viteBuild } from "vite";
import { build } from "esbuild";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
const root = resolve(import.meta.dirname, "..");
await viteBuild({ configFile: resolve(root, "vite.local.config.ts") });
await rm(resolve(root, "dist-local-service"), { recursive: true, force: true });
await build({
  entryPoints: Object.fromEntries(["local-web-service", "export_canvas", "validate_project", "compose_project", "render_paragraph_background"].map(name => [name, resolve(root, `scripts/${name}.mjs`)])),
  outdir: resolve(root, "dist-local-service"), outExtension: { ".js": ".mjs" },
  bundle: true, platform: "node", format: "esm", target: "node22", packages: "external",
});
console.log("本地网页与处理服务已构建。");
