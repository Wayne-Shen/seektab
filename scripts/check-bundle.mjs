import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['storage']);
assert.deepEqual(manifest.host_permissions, ['https://api.deepseek.com/*']);
assert.equal(manifest.chrome_url_overrides.newtab, 'index.html');
assert(!manifest.background && !manifest.content_scripts && !manifest.externally_connectable);
assert(!manifest.web_accessible_resources);
const html = await readFile(path.join(root, 'index.html'), 'utf8');
assert(!/<script\b[^>]*>\s*[^<\s]/i.test(html), 'No inline scripts');
assert(!/https?:\/\//.test(html), 'No external page resources');
for (const icon of Object.values(manifest.icons))
  assert((await stat(path.join(root, icon))).size > 0);
async function walk(dir) {
  const items = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      items.map((i) => (i.isDirectory() ? walk(path.join(dir, i.name)) : [path.join(dir, i.name)])),
    )
  ).flat();
}
const files = await walk(root);
assert(!files.some((f) => f.endsWith('.map')), 'Do not ship source maps');
for (const file of files.filter((f) => /\.(js|css)$/.test(f))) {
  const source = await readFile(file, 'utf8');
  assert(!source.includes('chrome.storage.sync'), 'No cloud key sync');
  assert(!/\beval\(/.test(source), 'No eval');
  assert(!/sk-[a-zA-Z0-9]{20,}/.test(source), 'No embedded API key');
}
for (const file of (await walk(path.resolve('src'))).filter((f) => /\.(ts|tsx)$/.test(f))) {
  const source = await readFile(file, 'utf8');
  assert(
    !source.includes('dangerouslySetInnerHTML') && !source.includes('.innerHTML'),
    'App must render untrusted text safely',
  );
}
console.log(`Bundle verified: Manifest V3, narrow permissions, CSP, ${files.length} local files.`);
