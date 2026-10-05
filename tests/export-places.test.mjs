import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const script=await readFile('public/export-places.js','utf8');
const baseUrl='https://49.233.153.141/food/';
const exportedAt='2026-10-05T03:04:05.000Z';
function load(extra={}){const context={window:{},URL,URLSearchParams,Blob,...extra};vm.runInNewContext(script,context);return context;}
const feature=(properties,coordinates=[116.4,39.9])=>({type:'Feature',geometry:coordinates?{type:'Point',coordinates}:null,properties});

test('Markdown exports planning fields and absolute public dish images, without private identity or review metadata',()=>{
 const {window}=load();
 window.FOOD_PHOTOS={shop:[{url:'photos/source-a123.webp',caption:'牛肉面实拍',originalUrl:'https://www.xiaohongshu.com/explore/note?xsec_token=IMAGE_SECRET',review:'PHOTO_REVIEW_SECRET'}]};
 const record=feature({id:'shop',name:'北京食堂（东四店）',address:'北京市东城区东四九条63号',dishes:['牛肉面','米饭'],category:'中餐',amount:35,experience:'份量够，面条有嚼劲。',mealDate:'2026-10-04',locationAccuracy:'streetApprox',accuracyMeters:500,sources:[{title:'一人食记录',url:'https://www.xiaohongshu.com/explore/69abc?xsec_token=SOURCE_SECRET&xsec_source=feed',authorName:'PRIVATE_ACCOUNT_NAME'}],creator:'PRIVATE_USER_ID',creatorName:'PRIVATE_ACCOUNT_NAME',requestKey:'PRIVATE_REQUEST_KEY',reviewStatus:'PRIVATE_REVIEW',locationCaveat:'INTERNAL_REVIEW_NOTES',draftPhotos:['blob:PRIVATE_DRAFT']});
 const output=window.FOOD_EXPORT.buildMarkdown([record],{baseUrl,exportedAt});
 assert.match(output,/地点记录：1 条/);assert.match(output,/北京食堂（东四店）/);assert.match(output,/北京市东城区东四九条63号/);assert.match(output,/牛肉面、米饭/);assert.match(output,/人均：35 元/);assert.match(output,/份量够，面条有嚼劲。/);assert.match(output,/用餐日期：2026-10-04/);assert.match(output,/WGS84 坐标：116.4, 39.9/);assert.match(output,/街道参考点，未核实门店入口/);assert.match(output,/非实测误差/);
 assert.ok(output.includes(baseUrl+'photos/source-a123.webp'));assert.ok(output.includes('https://www.xiaohongshu.com/explore/69abc)'));
 const amap=new URL(output.match(/\[按店名查找分店\]\(([^)]+)\)/)[1]);assert.equal(amap.searchParams.get('keyword'),'北京食堂（东四店）');assert.equal(amap.searchParams.get('callnative'),'0');
 for(const secret of ['PRIVATE_','SOURCE_SECRET','IMAGE_SECRET','INTERNAL_REVIEW_NOTES','xsec_token','xsec_source','creatorName','requestKey'])assert.equal(output.includes(secret),false,secret);
});

test('records without coordinates remain useful and support zero amount, media links and a source outside Xiaohongshu',()=>{
 const {window}=load();
 const id='01234567-89ab-4cde-8fab-0123456789ab';
 const record=feature({name:'新发现的小摊',address:'东四路口北侧',dishes:['煎饼'],amount:0,photos:[{url:'api/media/'+id,caption:'煎饼'}],sourceUrl:'https://example.org/reviews?id=123&token=TOKEN_SECRET#private',sources:[]},null);
 const before=JSON.stringify(record);
 const output=window.FOOD_EXPORT.buildMarkdown([record],{baseUrl,exportedAt});
 assert.match(output,/WGS84 坐标：未提供/);assert.match(output,/可按文字地址搜索/);assert.match(output,/人均：0 元/);assert.ok(output.includes(baseUrl+'api/media/'+id));assert.ok(output.includes('https://example.org/reviews?id=123'));assert.equal(output.includes('TOKEN_SECRET'),false);assert.equal(output.includes('#private'),false);assert.equal(JSON.stringify(record),before,'export must not mutate source arrays or features');
});

test('Markdown treats names and experiences as text, rejects draft URLs, and validates coordinate ranges',()=>{
 const {window}=load();
 const record=feature({name:'店铺\n# 新标题 [跳转](javascript:alert(1))',address:'<script>alert(1)</script>',dishes:['饭 | 面','`代码`'],experience:'**加粗**\n![坏图](https://evil.example/a)',photos:[{url:'blob:private-draft'},{url:'data:image/png;base64,private'},{url:'javascript:alert(1)'},{url:'../private.png'},{url:'https://user:password@example.org/dish.jpg'},{url:'https://49.233.153.141/food/api/uploads/secret'},{url:'https://example.org/dish).jpg',caption:'[菜品]'}],sourceUrl:'javascript:alert(1)'},[200,95]);
 const output=window.FOOD_EXPORT.buildMarkdown([record],{baseUrl,exportedAt});
 assert.ok(output.includes('\\# 新标题 \\[跳转\\]'));assert.ok(output.includes('&lt;script&gt;'));assert.equal(output.includes('<script>'),false);assert.ok(output.includes('饭 \\| 面'));assert.ok(output.includes('\\*\\*加粗\\*\\*'));assert.ok(output.includes('https://example.org/dish%29.jpg'));assert.match(output,/WGS84 坐标：未提供/);
 for(const hidden of ['blob:private-draft','data:image','../private.png','user:password','/api/uploads/secret'])assert.equal(output.includes(hidden),false,hidden);
 assert.equal(output.includes('- 公开来源：'),false);
});

test('GeoJSON selects a small public schema and preserves nullable geometry and UTF-8 text',()=>{
 const {window}=load();
 const output=JSON.parse(JSON.stringify(window.FOOD_EXPORT.buildGeoJSON([feature({name:'小店 A&B',address:'北京',dishes:['牛肉饭'],locationAccuracy:'user',creatorName:'DO_NOT_EXPORT',creator:'DO_NOT_EXPORT',internalAudit:'DO_NOT_EXPORT'}),feature({name:'未标点的小店',address:'商场一层',dishes:['咖啡']},null)],{baseUrl,exportedAt})));
 assert.equal(output.type,'FeatureCollection');assert.equal(output.coordinateSystem,'WGS84');assert.equal(output.exportedAt,exportedAt);assert.deepEqual(output.features[0].geometry,{type:'Point',coordinates:[116.4,39.9]});assert.equal(output.features[1].geometry,null);assert.equal(output.features[0].properties.name,'小店 A&B');assert.match(output.features[0].properties.location,/分享者在地图上手选的位置/);assert.equal(JSON.stringify(output).includes('DO_NOT_EXPORT'),false);
 assert.deepEqual(Object.keys(output.features[0].properties).sort(),['name','address','dishes','category','amount','experience','mealDate','location','photos','sources','amapUrl'].sort());
});

test('local preview image URLs are allowed only under their local base and unsafe sources are omitted',()=>{
 const {window}=load();
 const record=feature({name:'本地预览',address:'北京',photos:[{url:'photos/source-test.webp'},{url:'http://localhost:8799/photo.jpg'},{url:'http://127.0.0.1:8793/photo.jpg'},{url:'http://example.org/photo.jpg'}],sources:[{url:'https://user:password@example.org/review'},{url:'file:///private/source'}]});
 const result=window.FOOD_EXPORT.buildGeoJSON([record],{baseUrl:'http://127.0.0.1:8793/',exportedAt});
 assert.equal(result.features[0].properties.photos.length,2);assert.equal(result.features[0].properties.photos[0].url,'http://127.0.0.1:8793/photos/source-test.webp');assert.equal(result.features[0].properties.sources.length,0);
});

test('one click downloads UTF-8 Markdown with a predictable filename and releases the temporary URL',async()=>{
 let blob,clicked=false,removed=false,revoked=false,scheduled;
 const anchor={remove(){removed=true;},click(){clicked=true;}};
 class BrowserURL extends URL{static createObjectURL(value){blob=value;return 'blob:test-export';}static revokeObjectURL(value){revoked=value==='blob:test-export';}}
 const {window}=load({URL:BrowserURL,document:{baseURI:baseUrl,createElement(tag){assert.equal(tag,'a');return anchor;},body:{append(element){assert.equal(element,anchor);}}},setTimeout(callback){scheduled=callback;}});
 const result=window.FOOD_EXPORT.download([feature({name:'测试店',address:'北京',dishes:['牛肉面']})],{exportedAt:'2026-10-04T18:51:06.970Z'});
 assert.equal(clicked,true);assert.equal(removed,true);assert.equal(anchor.download,'beijing-food-places-2026-10-05.md');assert.equal(anchor.href,'blob:test-export');assert.equal(result.count,1);assert.equal(blob.type,'text/markdown;charset=utf-8');assert.match(await blob.text(),/牛肉面/);assert.equal(revoked,false);scheduled();assert.equal(revoked,true);
});

test('the complete shipped collection exports all 67 public records and all available original images',async()=>{
 const context=load();
 vm.runInNewContext(await readFile('public/shops.js','utf8'),context);vm.runInNewContext(await readFile('public/photos.js','utf8'),context);
 const features=context.window.FOOD_COLLECTION.features;
 const exportData=context.window.FOOD_EXPORT.buildGeoJSON(features,{baseUrl,exportedAt});
 assert.equal(exportData.features.length,67);assert.equal(exportData.features.filter(feature=>feature.geometry).length,38);assert.equal(exportData.features.reduce((count,feature)=>count+feature.properties.photos.length,0),76);assert.equal(exportData.features[0].properties.name,'阿光鲜烫牛肉（朝外THE BOX附近店）');
 const markdown=context.window.FOOD_EXPORT.buildMarkdown(features,{baseUrl,exportedAt});assert.equal((markdown.match(/^## \d+\./gm)||[]).length,67);assert.equal(markdown.includes('xsec_token'),false);assert.equal(markdown.includes('noteIndex'),false);assert.equal(markdown.includes('locationCaveat'),false);
});
