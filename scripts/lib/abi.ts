import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Abi } from "viem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_ROOT = path.resolve(__dirname, "../../contracts/out");

/// Loads the ABI from a Foundry build artefact by source file + contract name.
export function loadAbi(sourceFile: string, contractName?: string): Abi {
  const name = contractName ?? path.basename(sourceFile, ".sol");
  const file = path.join(ARTIFACT_ROOT, sourceFile, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`ABI artefact missing: ${file}\nRun: cd contracts && forge build`);
  }
  const json = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (!json.abi) throw new Error(`ABI missing in artefact ${file}`);
  return json.abi as Abi;
}
