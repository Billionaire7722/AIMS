import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const distPackageDir = join(root, "dist", "apps", "api");
const distPackageJson = join(distPackageDir, "package.json");
const sharedTypesDistDir = join(root, "dist", "packages", "shared-types");
const sharedTypesDistPackageJson = join(sharedTypesDistDir, "package.json");
const sharedTypesDir = join(root, "node_modules", "@aims", "shared-types");
const sharedTypesPackageJson = join(sharedTypesDir, "package.json");
const sharedTypesIndex = join(sharedTypesDir, "index.js");
const musicDomainDistDir = join(root, "dist", "packages", "music-domain");
const musicDomainDistPackageJson = join(musicDomainDistDir, "package.json");
const musicDomainDir = join(root, "node_modules", "@aims", "music-domain");
const musicDomainPackageJson = join(musicDomainDir, "package.json");
const musicDomainIndex = join(musicDomainDir, "index.js");

await mkdir(distPackageDir, { recursive: true });
await writeFile(distPackageJson, JSON.stringify({ type: "commonjs" }, null, 2));

await mkdir(sharedTypesDistDir, { recursive: true });
await writeFile(sharedTypesDistPackageJson, JSON.stringify({ type: "commonjs" }, null, 2));
await mkdir(musicDomainDistDir, { recursive: true });
await writeFile(musicDomainDistPackageJson, JSON.stringify({ type: "commonjs" }, null, 2));

await mkdir(sharedTypesDir, { recursive: true });
await writeFile(
  sharedTypesPackageJson,
  JSON.stringify(
    {
      name: "@aims/shared-types",
      type: "commonjs",
      main: "./index.js",
    },
    null,
    2,
  ),
);
await writeFile(
  sharedTypesIndex,
  [
    '"use strict";',
    "",
    "module.exports = require(\"../../../dist/packages/shared-types/src/index.js\");",
    "",
  ].join("\n"),
);

await mkdir(musicDomainDir, { recursive: true });
await writeFile(
  musicDomainPackageJson,
  JSON.stringify(
    {
      name: "@aims/music-domain",
      type: "commonjs",
      main: "./index.js",
    },
    null,
    2,
  ),
);
await writeFile(
  musicDomainIndex,
  [
    '"use strict";',
    "",
    "module.exports = require(\"../../../dist/packages/music-domain/src/index.js\");",
    "",
  ].join("\n"),
);
