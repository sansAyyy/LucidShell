import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packagePath = resolve(root, "package.json");
const tauriConfigPath = resolve(root, "src-tauri/tauri.conf.json");
const cargoTomlPath = resolve(root, "src-tauri/Cargo.toml");

const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
const packageVersion = packageJson.version;

if (!packageVersion) {
  throw new Error("package.json version is missing.");
}

if (tauriConfig.version !== packageVersion) {
  tauriConfig.version = packageVersion;
  writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);
  console.log(`Synced Tauri version to ${packageVersion}`);
} else {
  console.log(`Tauri version already synced: ${packageVersion}`);
}

const cargoToml = readFileSync(cargoTomlPath, "utf8");
const syncedCargoToml = cargoToml.replace(
  /(^\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m,
  `$1"${packageVersion}"`,
);

if (syncedCargoToml !== cargoToml) {
  writeFileSync(cargoTomlPath, syncedCargoToml);
  console.log(`Synced Cargo package version to ${packageVersion}`);
} else if (cargoToml.includes(`version = "${packageVersion}"`)) {
  console.log(`Cargo package version already synced: ${packageVersion}`);
} else {
  throw new Error("Unable to locate Cargo package version.");
}
