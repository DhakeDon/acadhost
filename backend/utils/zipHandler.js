'use strict';

const fsp = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');

/**
 * Extracts a ZIP archive into destDir, stripping a single wrapping root
 * folder if every entry lives under one common prefix.
 *
 * @param {string|Buffer} zipFilePathOrBuffer
 *   Either a filesystem path string (multer diskStorage → file.path) or a
 *   Buffer containing the raw zip bytes (multer memoryStorage → file.buffer).
 *
 *   ROOT-CAUSE FIX: Previously this parameter was always called with
 *   `uploadedFile.path`. When multer is configured with memoryStorage, the
 *   file object has no `.path` property — only a `.buffer` — so the argument
 *   silently became `undefined`.  `new AdmZip(undefined)` does NOT throw; it
 *   returns an empty archive with zero entries, so the loop extracted nothing,
 *   `source/backend/` and `source/frontend/` stayed empty, and the Docker
 *   `COPY source/backend/package*.json ./` found no files to copy. The
 *   subsequent `RUN npm install` then failed with:
 *     ENOENT: no such file or directory, open '/app/package.json'
 *
 *   The fix has two parts:
 *     1. Guard: throw immediately if the argument is falsy so the failure is
 *        loud and logged instead of silently producing an empty extraction.
 *     2. Accept a Buffer directly so callers can pass `file.buffer` when
 *        multer memoryStorage is in use, without any changes in the caller
 *        (buildService already passes `uploadedFiles.frontend.path ||
 *        uploadedFiles.frontend.buffer` — see buildService fix comment).
 *
 * @param {string} destDir  Absolute path to the extraction target directory.
 */
async function extractZip(zipFilePathOrBuffer, destDir) {
  await fsp.mkdir(destDir, { recursive: true });

  // ── FIX: guard against undefined / null / empty-string ────────────────
  // AdmZip(undefined), AdmZip(null) and AdmZip('') all return an empty
  // archive object without throwing.  This caused silent extraction failures
  // when multer was using memoryStorage (file.path === undefined).
  if (!zipFilePathOrBuffer) {
    throw new Error(
        'extractZip: zip source is missing (received ' +
        JSON.stringify(zipFilePathOrBuffer) +
        '). ' +
        'If multer is configured with memoryStorage, pass file.buffer instead of file.path.'
    );
  }
  // ── End fix ───────────────────────────────────────────────────────────

  const zip = new AdmZip(zipFilePathOrBuffer);
  const entries = zip.getEntries();

  // Detect single root folder wrapping everything.
  // Do NOT require entries.some(e => e.isDirectory) — many zip tools
  // (Windows Explorer, zip -r, etc.) omit explicit directory entries
  // and only include file entries with path prefixes such as
  // "my-react-app/package.json". Checking rootFolders.size === 1
  // alone correctly handles both cases (with and without dir entries).
  const rootFolders = new Set(
      entries.map(e => e.entryName.split('/')[0]).filter(Boolean)
  );
  const allUnderOneRoot = rootFolders.size === 1;
  const singleRoot = allUnderOneRoot ? [...rootFolders][0] + '/' : null;

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const relativePath = singleRoot && entry.entryName.startsWith(singleRoot)
        ? entry.entryName.slice(singleRoot.length)
        : entry.entryName;

    if (!relativePath) continue;

    const outPath = path.join(destDir, relativePath);
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    await fsp.writeFile(outPath, entry.getData());
  }
}

module.exports = { extractZip };