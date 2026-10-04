import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFoodApplication} from '../server/index.js';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const origin='https://food-map.example.test';
async function create(root){const app=await createFoodApplication({origin,basePath:'/',dataDir:root,publicRead:true,registrationCode:''});return app;}
const cookies=new Map();
async function request(mf,url,method='GET',user=null,body=null,extra={}){
 const headers={...extra};if(user)headers.Cookie=cookies.get(user);if(method!=='GET'){headers.Origin=origin;headers['X-Food-Request']='1';}if(body&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
 return mf.handle(new Request(origin+'/'+url.replace(/^\//,''),{method,headers,body:body||undefined}));
}
async function upload(mf,user){const form=new FormData();form.append('photo',new File([await readFile('public/assets/navi-avatar.png')],'test.png',{type:'image/png'}));const response=await request(mf,'/api/uploads','POST',user,form);assert.equal(response.status,201);return response.json();}
test('shared state, authentication, idempotency, media ownership and restart persistence',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'food-map-test-'));let mf=await create(root);
 try{
 for(const user of ['u1','u2']){await mf.auth.createUser({username:'test-'+user,password:'test-only-password-2026',displayName:user});const response=await mf.auth.handle(new Request(origin+'/auth/login',{method:'POST',headers:{Origin:origin,'X-Food-Request':'1','Content-Type':'application/json'},body:JSON.stringify({username:'test-'+user,password:'test-only-password-2026'})}));cookies.set(user,response.headers.get('set-cookie').split(';')[0]);}
 const catalogue=await (await request(mf,'/api/catalog')).json();assert.equal(catalogue.features.length,65);
 const id=catalogue.features[0].properties.entryId,feedback='/api/entries/'+encodeURIComponent(id)+'/feedback',like='/api/entries/'+encodeURIComponent(id)+'/like';
 assert.equal((await request(mf,like,'PUT')).status,401);
 assert.equal((await mf.handle(new Request(origin+like,{method:'PUT',headers:{'oai-authenticated-user-id':'u1','Origin':'https://evil.test','X-Food-Request':'1',Cookie:cookies.get('u1')}}))).status,403);
 assert.equal((await mf.handle(new Request('https://direct-worker.test'+like,{method:'PUT',headers:{'oai-authenticated-user-id':'u1','Origin':'https://direct-worker.test','X-Food-Request':'1'}}))).status,400);
 await Promise.all([request(mf,like,'PUT','u1'),request(mf,like,'PUT','u1'),request(mf,like,'PUT','u2')]);
 let state=await (await request(mf,feedback,'GET','u1')).json();assert.equal(state.likeCount,2);assert.equal(state.liked,true);
 await request(mf,like,'DELETE','u1');state=await (await request(mf,feedback,'GET','u1')).json();assert.equal(state.likeCount,1);assert.equal(state.liked,false);
 const comment={requestKey:crypto.randomUUID(),body:'份量体验测试',ate:true};const commentUrl='/api/entries/'+encodeURIComponent(id)+'/comments';
 assert.equal((await request(mf,commentUrl,'POST','u1',comment)).status,201);assert.equal((await request(mf,commentUrl,'POST','u1',comment)).status,200);assert.equal((await request(mf,commentUrl,'POST','u1',{...comment,body:'变化'})).status,409);
 state=await (await request(mf,feedback,'GET','u2')).json();assert.equal(state.comments.length,1);assert.equal(state.comments[0].ate,true);assert.equal(state.comments[0].mine,false);assert.equal(JSON.stringify(state).includes('user_id'),false);
 await request(mf,'/api/comments/'+state.comments[0].id,'DELETE','u2');assert.equal((await (await request(mf,feedback)).json()).comments.length,1);
 const media=await upload(mf,'u1');assert.equal((await request(mf,media.url)).headers.get('Content-Type'),'image/png');
 const b={requestKey:crypto.randomUUID(),name:'测试食堂（东四店）',address:'北京市东城区东四九条63号',dishes:['牛肉面'],mediaIds:[media.id],lat:39.936,lng:116.42,experience:'纯测试',mealDate:null,amount:35,sourceUrl:''};
 assert.equal((await request(mf,'/api/entries','POST','u2',b)).status,400);
 const [a,c]=await Promise.all([request(mf,'/api/entries','POST','u1',b),request(mf,'/api/entries','POST','u1',b)]);assert.equal(a.status,201);assert.ok([200,201].includes(c.status));const entry=(await a.json()).id;assert.equal((await c.json()).id,entry);
 assert.equal((await request(mf,'/api/entries','POST','u1',{...b,name:'修改名称'})).status,409);
 const sameBranch=await request(mf,'/api/entries','POST','u1',{...b,requestKey:crypto.randomUUID(),dishes:['饺子']});assert.equal(sameBranch.status,201);
 const cat=await (await request(mf,'/api/catalog')).json();assert.equal(cat.features.length,67);const submitted=cat.features.filter(f=>f.properties.provenance==='user');assert.equal(submitted[0].properties.branchId,submitted[1].properties.branchId);assert.equal(submitted[0].properties.sources.length,0);
 await request(mf,media.url,'DELETE','u1');assert.equal((await request(mf,media.url)).status,200);
 const fakeJpeg=new FormData();fakeJpeg.append('photo',new File([new Uint8Array([255,216,255,...Array(13).fill(0)])],'fake.jpg',{type:'image/jpeg'}));assert.equal((await request(mf,'/api/uploads','POST','u1',fakeJpeg)).status,400);
 const tooLarge=await request(mf,'/api/entries','POST','u1',{filler:'x'.repeat(20000)});assert.equal(tooLarge.status,413);
 const seedBranch=catalogue.features.find(f=>f.properties.externalAddress&&f.properties.externalAddress!==f.properties.address)||catalogue.features[0];
 const reused=await request(mf,'/api/entries','POST','u1',{...b,requestKey:crypto.randomUUID(),name:seedBranch.properties.name,address:seedBranch.properties.externalAddress||seedBranch.properties.address,branchId:seedBranch.properties.branchId});assert.equal(reused.status,201);
 const invalid=new FormData();invalid.append('photo',new File(['<svg>fake</svg>stuff'],'fake.png',{type:'image/png'}));assert.equal((await request(mf,'/api/uploads','POST','u1',invalid)).status,415);
 await mf.close();mf=await create(root);
 assert.equal((await (await request(mf,'/api/catalog')).json()).features.length,68);assert.equal((await (await request(mf,feedback,'GET','u2')).json()).likeCount,1);assert.equal((await request(mf,media.url)).status,200);
 }finally{await mf.close();await rm(root,{recursive:true,force:true});}
});
