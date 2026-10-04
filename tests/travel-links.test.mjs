import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const sandbox={window:{},URL,URLSearchParams};vm.runInNewContext(await readFile('public/travel-links.js','utf8'),sandbox);
const {buildAmapSearch}=sandbox.window.FOOD_TRAVEL;
const {buildAmapAppSearch,getAmapEntry}=sandbox.window.FOOD_TRAVEL;
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
test('Android Chrome goes directly to AMap app with an official browser fallback',()=>{
 const p={name:'阿秋牛排（中骏世界城店）'},entry=getAmapEntry(p,{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'});
 assert.equal(entry.mode,'android-intent');assert.ok(entry.href.startsWith('intent://poi?'));assert.ok(entry.href.includes('scheme=androidamap;package=com.autonavi.minimap;'));
 const fallback=entry.href.match(/S\.browser_fallback_url=([^;]+);end$/)[1];assert.equal(decodeURIComponent(fallback),entry.webHref);assert.equal(new URL(entry.webHref).searchParams.get('callnative'),'0');
 const q=new URLSearchParams(entry.href.split('?')[1].split('#Intent')[0]);assert.equal(q.get('keywords'),'北京 '+p.name);assert.equal(q.has('lat1'),false);
});
test('iPhone and iPad desktop mode use the native search scheme without a web redirect',()=>{
 const p={name:'山海食堂（东四北大街）'};
 for(const device of [{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'},{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',platform:'MacIntel',maxTouchPoints:5}]){
  const entry=getAmapEntry(p,device);assert.equal(entry.mode,'ios');assert.ok(entry.href.startsWith('iosamap://poi?'));assert.equal(new URL(entry.href).searchParams.get('name'),'北京 '+p.name);assert.ok(!entry.href.includes('+'));assert.ok(entry.webHref.startsWith('https://uri.amap.com/'));
 }
});
test('desktop and embedded Android browsers retain an explicit safe web option',()=>{
 const p={name:'餐馆'};assert.equal(getAmapEntry(p,{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:0}).mode,'web');
 for(const ua of ['Android Chrome/130 Mobile MicroMessenger/8.0','Android; wv Chrome/130 Version/4.0','Android Chrome/130 SamsungBrowser/24']){const entry=getAmapEntry(p,{userAgent:ua});assert.equal(entry.mode,'android');assert.ok(entry.href.startsWith('androidamap://'));assert.equal(new URL(entry.webHref).searchParams.get('callnative'),'0');}
});
test('native query values cannot inject intent options and empty destinations are omitted',()=>{
 const p={name:'测试 &店#Intent;scheme=evil;end?'};const url=new URL(buildAmapAppSearch(p));assert.equal(url.searchParams.get('keywords'),'北京 '+p.name);assert.equal(url.hash,'');assert.equal(getAmapEntry({}),null);assert.equal(buildAmapAppSearch({name:'店'},{platform:'unknown'}),null);
});
