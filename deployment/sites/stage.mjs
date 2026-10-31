import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const plugin = process.argv[process.argv.indexOf('--plugin-root') + 1];
if (!process.argv.includes('--plugin-root') || !path.isAbsolute(plugin)) throw new Error('Pass --plugin-root with the installed Sites plugin directory.');
const target = path.join(repo, 'output/sites/bread-companion');
await fs.mkdir(target, { recursive: true });
const exists = p => fs.access(p).then(() => true, () => false);
if (!await exists(path.join(target, 'package.json'))) {
  const result = spawnSync(process.execPath, [path.join(plugin, 'scripts/project-setup.mjs')], { cwd: target, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Sites setup failed');
}
const template = path.join(plugin, 'skills/sites/templates/vinext-starter');
const manifest = {};
async function copyTree(relative) {
  const source = path.join(repo, relative), destination = path.join(target, relative);
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Refusing a symlink in application source: ' + name);
    if (entry.isDirectory()) { await fs.mkdir(path.join(target, name), { recursive: true }); await copyTree(name); }
    else if (entry.isFile()) {
      const data = await fs.readFile(path.join(repo, name));
      await fs.mkdir(path.dirname(path.join(target, name)), { recursive: true });
      await fs.writeFile(path.join(target, name), data);
      manifest[name] = createHash('sha256').update(data).digest('hex');
    }
  }
}
// Dedicated generated checkout only; never traverse the user's workspace or other projects.
for (const folder of ['app','components','domain','services','server','lib','prompts','public']) {
  await fs.rm(path.join(target, folder), { recursive: true, force: true });
  await fs.mkdir(path.join(target, folder), { recursive: true });
  if (folder === 'lib') await fs.cp(path.join(template, 'lib'), path.join(target, folder), { recursive: true });
  await copyTree(folder);
}
// The starter's unused UI helper depends on its optional UI kit; Bread uses its own components.
await fs.rm(path.join(target, 'lib/utils.ts'), { force: true });
for (const [from, to] of [['worker.ts','worker/index.ts'],['schema.ts','db/schema.ts'],['drizzle','drizzle'],['package-lock.json','package-lock.json']]) {
  await fs.cp(path.join(repo, 'deployment/sites', from), path.join(target, to), { recursive: true, force: true });
}
const pkg = JSON.parse(await fs.readFile(path.join(repo, 'deployment/sites/package.json'), 'utf8'));
const app = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
pkg.version = app.version;
await fs.writeFile(path.join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
await fs.copyFile(path.join(repo, '.openai/hosting.json'), path.join(target, '.openai/hosting.json'));
await fs.copyFile(path.join(repo, 'next.config.ts'), path.join(target, 'next.config.ts'));
await fs.copyFile(path.join(repo, 'LICENSE'), path.join(target, 'LICENSE'));
await fs.copyFile(path.join(repo, 'deployment/sites/README.md'), path.join(target, 'README.md'));
await fs.copyFile(path.join(repo, 'THIRD_PARTY_NOTICES.md'), path.join(target, 'THIRD_PARTY_NOTICES.md'));
await fs.writeFile(path.join(target, 'bread-source-manifest.json'), JSON.stringify({ applicationVersion: app.version, sha256: manifest }, null, 2) + '\n');
console.log(JSON.stringify({ checkout: target, applicationFiles: Object.keys(manifest).length, secretsCopied: false }));
