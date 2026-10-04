import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const sandbox={window:{},URL,URLSearchParams};vm.runInNewContext(await readFile('public/travel-links.js','utf8'),sandbox);
const {buildAmapSearch}=sandbox.window.FOOD_TRAVEL;
test('AMap entry preserves branch names and asks the official URI to launch mobile app',()=>{
 const name='阿光鲜烫牛肉（朝外THE BOX附近店）',url=new URL(buildAmapSearch({name,address:'芳草地西街11号',lat:39.9,lng:116.4}));
 assert.equal(url.origin,'https://uri.amap.com');assert.equal(url.pathname,'/search');assert.equal(url.searchParams.get('keyword'),name);assert.equal(url.searchParams.get('city'),'北京');assert.equal(url.searchParams.get('callnative'),'1');assert.equal(url.searchParams.has('center'),false);assert.equal(url.searchParams.has('position'),false);
});
test('web fallback does not request app launch and query text cannot change destination',()=>{
 const name='餐厅 A&B #? / "<店>"',url=new URL(buildAmapSearch({name},{callNative:false}));assert.equal(url.searchParams.get('keyword'),name);assert.equal(url.searchParams.get('callnative'),'0');assert.equal(url.hostname,'uri.amap.com');
});
test('shops without coordinates still have a search entry and missing details are rejected',()=>{
 assert.equal(new URL(buildAmapSearch({name:'清华东门鸡公煲'})).searchParams.get('keyword'),'清华东门鸡公煲');assert.equal(new URL(buildAmapSearch({address:'北京市东四九条63号'})).searchParams.get('keyword'),'北京市东四九条63号');assert.equal(buildAmapSearch({}),null);
});
