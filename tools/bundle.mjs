// Bundles the game (src/) and three.js into one self-contained page: dist/index.html, which the exe serves.
import { build } from 'esbuild';
import fs from 'node:fs';

const res = await build({ entryPoints: ['src/ui.js'], bundle: true, format: 'esm', minify: true, target: 'es2020', write: false, logLevel: 'warning' });
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
let page = fs.readFileSync('src/index.html', 'utf8');
const tags = /<script type="importmap">[\s\S]*?<\/script>\s*<script type="module" src="ui\.js"><\/script>/;
if (!tags.test(page)) throw new Error('src/index.html: script tags not found');
page = page.replace(tags, () => `<script type="module">${js}</script>`);
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0}</style></head><body>
${page}
</body></html>
`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log('dist/index.html', Math.round(html.length / 1024), 'KB');
