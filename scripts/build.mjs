import {mkdir,readFile,writeFile,cp,rm} from 'node:fs/promises';
import {build} from 'esbuild';
const source=await readFile('public/shops.js','utf8');
await writeFile('worker/seed.json',JSON.stringify(JSON.parse(source.slice(source.indexOf('=')+1).trim().replace(/;$/,''))));
await rm('dist',{recursive:true,force:true});await mkdir('dist/server',{recursive:true});
await build({entryPoints:['worker/index.js'],bundle:true,format:'esm',platform:'node',target:'node22',outfile:'dist/server/food-api.js'});
await cp('public','dist/public',{recursive:true});await cp('drizzle','dist/drizzle',{recursive:true});
console.log('Built portable food API, public assets and migrations.');
