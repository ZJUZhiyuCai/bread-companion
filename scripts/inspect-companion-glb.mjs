// Offline checks for the Blender assets served by the optional 3D companion.
// Usage: node scripts/inspect-companion-glb.mjs path/to/model.glb [...]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';

function inspect(file) {
  const bytes = readFileSync(file);
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2) {
    throw new Error(`${basename(file)}: expected a glTF 2 binary`);
  }
  if (bytes.readUInt32LE(8) !== bytes.length) throw new Error('GLB length mismatch');
  let document;
  let binaryLength = 0;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('Truncated chunk header');
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    if (length % 4 || offset + 8 + length > bytes.length) throw new Error('Invalid chunk length');
    if (type === 0x4e4f534a) {
      if (document || offset !== 12) throw new Error('JSON must be the first and only JSON chunk');
      document = JSON.parse(bytes.toString('utf8', offset + 8, offset + 8 + length));
    }
    if (type === 0x004e4942) binaryLength += length;
    offset += 8 + length;
  }
  if (document?.asset?.version !== '2.0') throw new Error('Missing glTF 2.0 document');
  for (const resource of [...(document.buffers ?? []), ...(document.images ?? [])]) {
    if (resource.uri && !resource.uri.startsWith('data:')) throw new Error('Asset must be self-contained');
  }
  for (const view of document.bufferViews ?? []) {
    const buffer = document.buffers[view.buffer];
    if (!buffer || view.byteLength < 0 || (view.byteOffset ?? 0) < 0 ||
        (view.byteOffset ?? 0) + view.byteLength > buffer.byteLength) throw new Error('Buffer view is out of bounds');
  }
  if ((document.buffers?.[0]?.byteLength ?? 0) > binaryLength) throw new Error('Missing binary buffer data');
  for (const accessor of document.accessors ?? []) {
    if (![...(accessor.min ?? []), ...(accessor.max ?? [])].every(Number.isFinite)) throw new Error('Non-finite geometry bounds');
  }
  let triangles = 0;
  let primitives = 0;
  let vertices = 0;
  for (const node of document.nodes ?? []) {
    if (node.mesh === undefined) continue;
    for (const primitive of document.meshes[node.mesh].primitives) {
      const position = document.accessors[primitive.attributes.POSITION];
      if (!position?.count) throw new Error('Empty mesh geometry');
      const count = primitive.indices === undefined ? position.count : document.accessors[primitive.indices].count;
      const mode = primitive.mode ?? 4;
      triangles += mode === 4 ? count / 3 : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
      vertices += position.count;
      primitives++;
    }
  }
  if (!primitives || !Number.isInteger(triangles)) throw new Error('No valid triangle geometry');
  // The phone is a small progressive enhancement, never the discarded 3D avatar.
  // Catch an accidental full-scene export or a broken animation rig before shipping it.
  if (basename(file) === 'bread-phone.glb') {
    const names = new Set((document.nodes ?? []).map(n => n.name));
    for (const name of ['phone', 'phone_body', 'handset', 'handset_body', 'dial_wheel', 'cord_root', 'cord_tip']) {
      if (!names.has(name)) throw new Error(`Phone animation node is missing: ${name}`);
    }
    if (names.has('companion') || names.has('fuzz')) throw new Error('Phone export contains the 3D avatar');
    if (bytes.length > 1_000_000 || triangles > 40_000) throw new Error('Phone exceeds its asset budget');
  }
  return {
    file: basename(file), bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    nodes: document.nodes?.length ?? 0, meshInstances: (document.nodes ?? []).filter(n => n.mesh !== undefined).length,
    primitives, vertices, triangles,
    materials: (document.materials ?? []).map(m => ({ name: m.name, alphaMode: m.alphaMode ?? 'OPAQUE', extensions: Object.keys(m.extensions ?? {}) })),
    extensions: document.extensionsUsed ?? [], selfContained: true,
  };
}

const files = process.argv.slice(2);
if (!files.length) throw new Error('Pass one or more .glb files to inspect.');
console.log(JSON.stringify(files.map(inspect), null, 2));
