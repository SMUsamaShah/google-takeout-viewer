// Folder loading. v1 uses a <input type="file" webkitdirectory> which works across
// browsers, exposes file sizes without reading content, and needs only read access -
// all this viewer requires. See decisions.md for why not the File System Access API yet.
//
// Returns lightweight entries; file content is read lazily via getText() so selecting a
// folder with thousands of files stays cheap (nothing is read until a series is charted).

export function filesFromInput(fileList) {
  const out = [];
  for (const f of fileList) {
    out.push({
      name: f.name,
      path: f.webkitRelativePath || f.name,
      size: f.size,
      getText: () => f.text(),
    });
  }
  return out;
}

let openZipReader = null;

// A ZIP is represented by the same lightweight file entries as a selected folder. The archive
// stays in the browser as a Blob; an entry is decompressed only when a parser calls getText().
// Keeping the reader open is necessary because ZIP entries use the central directory for random
// access. The caller closes it before switching to another Takeout.
export async function filesFromZip(file) {
  const api = globalThis.zip;
  if (!api) throw new Error('ZIP support library did not load');
  await closeArchive();
  openZipReader = new api.ZipReader(new api.BlobReader(file), { useWebWorkers: true });
  const entries = await openZipReader.getEntries();
  return entries.filter((entry) => !entry.directory && !entry.filename.endsWith('/')).map((entry) => {
    const slash = entry.filename.lastIndexOf('/');
    const name = slash >= 0 ? entry.filename.slice(slash + 1) : entry.filename;
    return {
      name,
      path: entry.filename,
      size: entry.uncompressedSize || entry.compressedSize || 0,
      getText: () => entry.getData(new api.TextWriter()),
    };
  });
}

export async function closeArchive() {
  if (openZipReader) {
    const reader = openZipReader;
    openZipReader = null;
    await reader.close();
  }
}
