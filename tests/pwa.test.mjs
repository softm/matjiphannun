import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, statSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const read=name=>readFileSync(resolve(root,name),'utf8');

test('installable PWA metadata and UI are present',()=>{
  const manifest=JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.id,'./');
  assert.equal(manifest.display,'standalone');
  for(const size of ['192x192','512x512'])assert.ok(manifest.icons.some(icon=>icon.sizes===size&&icon.type==='image/png'));
  assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'));
  assert.match(read('index.html'),/id="app-install"/);
  assert.match(read('app.js'),/beforeinstallprompt/);
  for(const icon of ['assets/icon-192.png','assets/icon-512.png','assets/icon-maskable-512.png'])assert.ok(statSync(resolve(root,icon)).size>1000);
});

test('service worker keeps data and API responses out of the app shell',()=>{
  const sw=read('sw.js');
  assert.match(sw,/event\.request\.mode==='navigate'/);
  const files=[...sw.match(/const FILES=(\[[^;]+\]);/s)[1].matchAll(/['"]([^'"]+)['"]/g)].map(match=>match[1]);
  assert.ok(files.includes('./index.html'));
  assert.ok(files.every(path=>!path.startsWith('./data/')));
});

test('shared map type toggle follows the Hannun icon standard',()=>{
  const html=read('index.html'),css=read('styles.css');
  assert.match(html,/m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5/);
  assert.match(css,/\.map-type-toggle\{[^}]*width:48px;height:48px/);
  assert.match(css,/\.map-type-toggle\.is-satellite\{background:#245888;color:#fff/);
});
