// VIGIL // FOUNDRY — entry program for threejs-fps-02 (Node 22, stdlib only).
//
// What it does, in order:
//   1. Resolves the repository root (this file's directory) and the output
//      directory (MAKEFUN_OUTPUT_DIR, or /output inside the grader).
//   2. Copies game/ and screenshots/ into the output, in sorted order,
//      refusing symlinks so the gate's game_files row can never trip.
//   3. Verifies the vendored three.js 0.187.0 files are byte-exact against
//      the kit manifest hashes before the dossier is built.
//   4. Writes /output/dossier.json with buildDossier from the kit's
//      vendor/makefun-threejs.ts (unchanged), using the scorer's own caps
//      (163,840 dossier text bytes, at most 4 screenshots of 256 KiB,
//      game/ at most 993 entries / 48 MiB).
//   5. Prints a short manifest (file counts, bytes, dossier bytes) so two
//      runs can be compared byte for byte.
//
// Outside the grader:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// Kit manifest hashes for three.js 0.187.0 (kit.json). The gate refuses any
// other version, so a mismatch here fails loudly instead of silently.
const THREE_HASHES: Record<string, string> = {
  'three.module.min.js': 'ef510bae547ab3789d6ed543333a8bf42510a8c70743b766c4e19039b976c26b',
  'three.core.min.js': '613e370f76638fdef83926642bf256dc9615684922de1ce1f63a8583e5d78578',
};

const DOSSIER_TEXT_MAX_BYTES = 163840;
const SCREENSHOT_MAX = 4;
const SCREENSHOT_MAX_BYTES = 262144;
const GAME_MAX_FILES = 993;
const GAME_MAX_BYTES = 50331648;

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

// Walk a directory in sorted order, collecting regular files only and
// refusing symlinks (the gate counts plain files and directories only).
function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const st = statSync(path, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isSymbolicLink()) throw new Error(`symlink refused: ${path}`);
    if (st.isDirectory()) walkFiles(path, out);
    else if (st.isFile()) out.push(path);
  }
  return out;
}

function main(): void {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const out = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  const gameDir = join(here, 'game');
  const shotsDir = join(here, 'screenshots');

  // 1. Verify the vendored three.js files before anything is copied.
  for (const [name, hash] of Object.entries(THREE_HASHES)) {
    const file = join(gameDir, 'vendor', 'three', name);
    if (!existsSync(file)) throw new Error(`missing vendored file: ${file}`);
    if (sha256(file) !== hash) throw new Error(`three.js hash mismatch: ${name}`);
  }

  // 2. Copy game/ and screenshots/ (fresh output directory each run).
  mkdirSync(out, { recursive: true });
  cpSync(gameDir, join(out, 'game'), { recursive: true });
  mkdirSync(join(out, 'screenshots'), { recursive: true });
  if (existsSync(shotsDir)) cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

  // 3. The gate's own caps, checked here so a bad build fails locally.
  const gameFiles = walkFiles(join(out, 'game'));
  let gameBytes = 0;
  for (const f of gameFiles) gameBytes += statSync(f).size;
  if (gameFiles.length > GAME_MAX_FILES) throw new Error(`game/ has ${gameFiles.length} files, cap ${GAME_MAX_FILES}`);
  if (gameBytes > GAME_MAX_BYTES) throw new Error(`game/ is ${gameBytes} bytes, cap ${GAME_MAX_BYTES}`);
  const shotFiles = existsSync(join(out, 'screenshots')) ? walkFiles(join(out, 'screenshots')) : [];
  if (shotFiles.length > SCREENSHOT_MAX) throw new Error(`${shotFiles.length} screenshots, cap ${SCREENSHOT_MAX}`);
  for (const f of shotFiles) {
    if (statSync(f).size > SCREENSHOT_MAX_BYTES) throw new Error(`screenshot over 256 KiB: ${f}`);
  }

  // 4. Dossier: the judge's reading of the game, built by the kit library.
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, {
      text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
      screenshots: { max: SCREENSHOT_MAX, max_bytes: SCREENSHOT_MAX_BYTES },
      game_max_files: GAME_MAX_FILES,
      game_max_bytes: GAME_MAX_BYTES,
    }),
  );

  // 5. Dossier integrity: it must not leak this machine's absolute paths
  // (the grader builds it in a fresh container), and its hash is printed
  // so two runs can be compared byte for byte.
  const dossierPath = join(out, 'dossier.json');
  const dossierText = readFileSync(dossierPath, 'utf8');
  if (dossierText.includes(here) || dossierText.includes('/home/')) {
    throw new Error('dossier.json leaks an absolute local path');
  }
  const dossierBytes = statSync(dossierPath).size;
  const shotBytes = shotFiles.reduce((n, f) => n + statSync(f).size, 0);
  console.log(JSON.stringify({
    entry: 'VIGIL // FOUNDRY',
    game_files: gameFiles.length,
    game_bytes: gameBytes,
    screenshots: shotFiles.length,
    screenshot_bytes: shotBytes,
    dossier_bytes: dossierBytes,
    dossier_sha256: sha256(dossierPath),
  }));
}

main();
