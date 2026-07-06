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
