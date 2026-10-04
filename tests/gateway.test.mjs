import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import {join} from 'node:path';
import {createFoodApplication} from '../server/index.js';
const origin='https://food-map.example.test';
test('/food/ routing and private reads require a server session, with private cache headers',async()=>{
 const dataDir=await mkdtemp(join(os.tmpdir(),'food-gateway-'));
 const app=await createFoodApplication({origin,basePath:'/food/',dataDir,publicRead:false});
 const request=(path,options={})=>app.handle(new Request(origin+path,options));
 try{
 assert.equal((await request('/food/')).status,303);assert.equal((await request('/food/')).headers.get('Location'),origin+'/food/login');
 assert.equal((await request('/food/api/catalog',{headers:{'oai-authenticated-user-id':'forged'}})).status,401);
 assert.equal((await request('/food/shops.js')).status,303);assert.equal((await request('/food/login')).status,200);
 assert.equal((await request('/food/login.js')).headers.get('Content-Type'),'text/javascript; charset=utf-8');
 assert.equal((await request('/food/auth/me')).status,200);assert.equal((await request('/other')).status,404);
 await app.auth.createUser({username:'test-owner',password:'test-only-password-2026',displayName:'测试'});
 const login=await request('/food/auth/login',{method:'POST',headers:{Origin:origin,'X-Food-Request':'1','Content-Type':'application/json'},body:JSON.stringify({username:'test-owner',password:'test-only-password-2026'})});
 assert.equal(login.status,200);assert.match(login.headers.get('Set-Cookie'),/Path=\/food\//);
 const cookie=login.headers.get('Set-Cookie').split(';')[0];
 for(const path of ['/food/','/food/shops.js','/food/photos.js','/food/api/catalog']){const response=await request(path,{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Vary'),'Cookie');}
 const data=await (await request('/food/api/catalog',{headers:{Cookie:cookie}})).json();assert.equal(data.features.length,65);
 assert.equal((await request('/food/api/session',{headers:{Cookie:cookie}})).status,200);
 }finally{app.close();await rm(dataDir,{recursive:true,force:true});}
});
