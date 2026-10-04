import { database } from '../db/index.js';
import seed from './seed.json';
import jpeg from 'jpeg-js';
import {decode as decodePng} from 'fast-png';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const initialized=new WeakMap();
class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const now=()=>new Date().toISOString();
const clean=(v,max,required=false)=>{if(typeof v!=='string'||v.trim().length>max||(required&&!v.trim()))throw new HttpError(400,'请检查填写内容');return v.trim();};
const parse=v=>{try{return JSON.parse(v);}catch{return []}};
async function hash(v){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))].map(v=>v.toString(16).padStart(2,'0')).join('');}
function identity(request,env){
 if(new URL(request.url).origin!==env.APP_ORIGIN)return null;
 return env.AUTH_USER||null;
}
function requireWrite(request,env){
 const user=identity(request,env);if(!user)throw new HttpError(401,'登录后即可记录和评价');
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Food-Request')!=='1')throw new HttpError(403,'请从食单页面重试');
 return user;
}
async function boundedBody(request,limit){
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new HttpError(413,'请求内容过大');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
async function bodyJson(request){
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new HttpError(415,'请求格式不正确');
 const bytes=await boundedBody(request,16000);
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(400,'请求内容不正确');}
}
const todayBeijing=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const branchKey=(name,address)=>hash({name:name.replace(/\s/g,''),address:address.replace(/\s/g,'')});
async function seedDatabase(db){
 if(initialized.has(db))return initialized.get(db);
 const pending=(async()=>{
  for(let i=0;i<seed.features.length;i+=15){const ops=[];for(const f of seed.features.slice(i,i+15)){
   const p=f.properties,[lng,lat]=f.geometry?.coordinates||[null,null];
   ops.push(db.prepare('INSERT INTO branches (id,name,address,lat,lng,match_key) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,lat=excluded.lat,lng=excluded.lng,match_key=excluded.match_key').bind(p.id,p.name,p.externalAddress||p.address||'地点待补',lat,lng,await branchKey(p.name,p.externalAddress||p.address||'地点待补')));
   ops.push(db.prepare('INSERT INTO entries (id,branch_id,dishes,provenance,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET dishes=excluded.dishes').bind('seed:'+p.id,p.id,JSON.stringify(p.dishes||[]),'seed','2026-10-04T00:00:00Z'));
  }await db.batch(ops);}
 })();initialized.set(db,pending);try{await pending;}catch(e){initialized.delete(db);throw e;}
}
async function requireEntry(db,id){if(!await db.prepare('SELECT id FROM entries WHERE id=?').bind(id).first())throw new HttpError(404,'这条食单不存在');}
async function rate(db,table,column,user,limit){
 const r=await db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column}=? AND created_at>?`).bind(user,new Date(Date.now()-600000).toISOString()).first();
 if(r.n>=limit)throw new HttpError(429,'操作比较频繁，请稍后再试');
}
async function feedback(db,id,user){
 await requireEntry(db,id);
 const [total,mine,rows]=await Promise.all([
 db.prepare('SELECT count(*) AS n FROM likes WHERE entry_id=?').bind(id).first(),
 user?db.prepare('SELECT 1 AS liked FROM likes WHERE entry_id=? AND user_id=?').bind(id,user.id).first():null,
 db.prepare('SELECT id,display_name,body,ate_claim,created_at,user_id FROM comments WHERE entry_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(id).all()]);
 return {likeCount:total.n,liked:!!mine,comments:rows.results.map(r=>({id:r.id,name:r.display_name,body:r.body,ate:!!r.ate_claim,createdAt:r.created_at,mine:r.user_id===user?.id}))};
}
async function catalogue(db){
 const rows=await db.prepare("SELECT e.*,b.name,b.address,b.lat,b.lng FROM entries e JOIN branches b ON b.id=e.branch_id WHERE e.provenance='user' ORDER BY e.created_at DESC,e.id DESC LIMIT 1000").all();
 return {type:'FeatureCollection',features:[...rows.results.map(r=>({type:'Feature',geometry:r.lat===null?null:{type:'Point',coordinates:[r.lng,r.lat]},properties:{id:r.id,entryId:r.id,branchId:r.branch_id,name:r.name,address:r.address,dishes:parse(r.dishes),photos:parse(r.media_ids).map(id=>({url:'api/media/'+id,caption:parse(r.dishes).join('、'),kind:'dish',width:1200,height:900})),experience:r.experience,mealDate:r.meal_date,amount:r.amount,creatorName:r.display_name,createdAt:r.created_at,sourceUrl:r.source_url,sources:[],locationAccuracy:r.lat===null?'pending':'user',locationCaveat:r.lat===null?'已记录文字地址，地图位置尚未添加。':'位置由分享者在地图上选择。',provenance:'user'}})),...seed.features.map(f=>({...f,properties:{...f.properties,entryId:'seed:'+f.properties.id,branchId:f.properties.id,address:f.properties.externalAddress||f.properties.address,provenance:'seed'}}))]};
}
async function createEntry(request,env,db,user){
 const b=await bodyJson(request),key=clean(b.requestKey,36,true);if(!uuid.test(key))throw new HttpError(400,'请重新提交');
 const name=clean(b.name,120,true),address=clean(b.address,250,true);
 const dishes=Array.isArray(b.dishes)?[...new Set(b.dishes.map(d=>clean(d,60,true)))]:[];
 const mediaIds=Array.isArray(b.mediaIds)?[...new Set(b.mediaIds)]:[];
 if(dishes.length<1||dishes.length>12||mediaIds.length<1||mediaIds.length>3||mediaIds.some(id=>!uuid.test(id)))throw new HttpError(400,'请填写菜品并上传1至3张菜品照片');
 const experience=clean(b.experience||'',1000),mealDate=b.mealDate||null,amount=b.amount??null;
 if(mealDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(mealDate)||mealDate>todayBeijing()))throw new HttpError(400,'请选择已发生的用餐日期');
 if(amount!==null&&(!Number.isFinite(amount)||amount<0||amount>10000))throw new HttpError(400,'请检查人均金额');
 let sourceUrl=null;if(b.sourceUrl){try{const u=new URL(b.sourceUrl);if(u.protocol!=='https:')throw 0;sourceUrl=u.href;}catch{throw new HttpError(400,'来源链接应为 https 地址');}}
 let lat=b.lat??null,lng=b.lng??null;
 if((lat===null)!==(lng===null)||(lat!==null&&(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<39.4||lat>41.1||lng<115.4||lng>117.6)))throw new HttpError(400,'请在北京范围内选择位置');
 const payloadHash=await hash({name,address,dishes,mediaIds,experience,mealDate,amount,sourceUrl,lat,lng,branchId:b.branchId||null});
 const existing=await db.prepare('SELECT id,payload_hash FROM entries WHERE creator=? AND request_key=?').bind(user.id,key).first();
 if(existing){if(existing.payload_hash!==payloadHash)throw new HttpError(409,'这次提交内容已变化，请重新提交');return json({id:existing.id},200);}
 await rate(db,'entries','creator',user.id,20);
 for(const id of mediaIds){const m=await db.prepare('SELECT object_key,owner FROM media WHERE id=?').bind(id).first();if(!m||m.owner!==user.id||!await env.BUCKET.head(m.object_key))throw new HttpError(400,'照片未保存成功，请重新上传');}
 let branchId=b.branchId||null,branch;
 if(branchId){branch=await db.prepare('SELECT * FROM branches WHERE id=?').bind(branchId).first();if(!branch||branch.name!==name||branch.address!==address)throw new HttpError(400,'店铺或地址已修改，请重新选择位置');lat=branch.lat;lng=branch.lng;}
 const matchKey=await branchKey(name,address);
 if(!branch){branch=await db.prepare('SELECT * FROM branches WHERE match_key=?').bind(matchKey).first();if(branch)branchId=branch.id;}
 branchId=branchId||'branch:'+matchKey.slice(0,32);const id='entry:'+crypto.randomUUID();
 const ops=[];if(!branch)ops.push(db.prepare('INSERT INTO branches (id,name,address,lat,lng,match_key) VALUES (?,?,?,?,?,?) ON CONFLICT(match_key) DO NOTHING').bind(branchId,name,address,lat,lng,matchKey));
 ops.push(db.prepare('INSERT INTO entries (id,branch_id,dishes,media_ids,experience,meal_date,amount,source_url,provenance,creator,display_name,request_key,payload_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(creator,request_key) DO NOTHING').bind(id,branchId,JSON.stringify(dishes),JSON.stringify(mediaIds),experience,mealDate,amount,sourceUrl,'user',user.id,user.name,key,payloadHash,now()));
 for(const mediaId of mediaIds)ops.push(db.prepare('INSERT INTO entry_media (entry_id,media_id) SELECT id,? FROM entries WHERE creator=? AND request_key=? AND payload_hash=? ON CONFLICT(entry_id,media_id) DO NOTHING').bind(mediaId,user.id,key,payloadHash));
 await db.batch(ops);const saved=await db.prepare('SELECT id,payload_hash FROM entries WHERE creator=? AND request_key=?').bind(user.id,key).first();
 if(saved.payload_hash!==payloadHash)throw new HttpError(409,'这次提交内容已变化，请重新提交');return json({id:saved.id},201);
}
async function upload(request,env,db,user){
 await rate(db,'media','owner',user.id,30);
 if(Number(request.headers.get('content-length'))>6*1024*1024)throw new HttpError(413,'每张图片请控制在5MB以内');
 if(!request.headers.get('Content-Type')?.startsWith('multipart/form-data;'))throw new HttpError(415,'请选择菜品照片');
 const payload=await boundedBody(request,6*1024*1024);
 let form;try{form=await new Request(request.url,{method:'POST',headers:{'Content-Type':request.headers.get('Content-Type')},body:payload}).formData();}catch{throw new HttpError(400,'照片上传格式不正确');}
 const file=form.get('photo');if(!file||typeof file.arrayBuffer!=='function'||file.size<16||file.size>5*1024*1024)throw new HttpError(400,'请选择5MB以内的菜品照片');
 const bytes=new Uint8Array(await file.arrayBuffer());let mime;
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
 else if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))mime='image/png';
 else throw new HttpError(415,'请在页面中重新选择菜品照片');
 try{
  let image;if(mime==='image/png'){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const width=view.getUint32(16),height=view.getUint32(20);if(!width||!height||width*height>20000000)throw 0;image=decodePng(bytes);}
  else image=jpeg.decode(bytes,{useTArray:true,formatAsRGBA:false,maxResolutionInMP:20,maxMemoryUsageInMB:128,tolerantDecoding:false});
  if(!image.width||!image.height||image.width*image.height>20000000)throw 0;
 }catch{throw new HttpError(400,'照片无法读取或尺寸过大，请重新选择');}
 const id=crypto.randomUUID(),objectKey='food/'+id;
 await env.BUCKET.put(objectKey,bytes,{httpMetadata:{contentType:mime}});
 try{await db.prepare('INSERT INTO media (id,owner,object_key,mime,bytes,created_at) VALUES (?,?,?,?,?,?)').bind(id,user.id,objectKey,mime,file.size,now()).run();}catch(e){await env.BUCKET.delete(objectKey);throw e;}
 return json({id,url:'api/media/'+id},201);
}
export default {async fetch(request,env){
 const url=new URL(request.url),path=url.pathname;
 try{
  if(!path.startsWith('/api/'))return env.ASSETS?env.ASSETS.fetch(request):new Response('Not found',{status:404});
  const db=database(env),user=identity(request,env);await seedDatabase(db);
  if(path==='/api/session'&&request.method==='GET')return json({user:user?{name:user.name}:null});
  if(path==='/api/catalog'&&request.method==='GET')return json(await catalogue(db));
  const mediaMatch=path.match(/^\/api\/media\/([a-f0-9-]{36})$/);
  if(mediaMatch&&['GET','HEAD'].includes(request.method)){
   const m=await db.prepare('SELECT * FROM media WHERE id=?').bind(mediaMatch[1]).first();if(!m)throw new HttpError(404,'照片不存在');
   const published=await db.prepare('SELECT 1 FROM entry_media em JOIN entries e ON e.id=em.entry_id WHERE em.media_id=? LIMIT 1').bind(m.id).first();
   if(!published&&m.owner!==user?.id)throw new HttpError(404,'照片不存在');
   const object=await env.BUCKET[request.method==='HEAD'?'head':'get'](m.object_key);if(!object)throw new HttpError(404,'照片不存在');
   return new Response(request.method==='HEAD'?null:object.body,{headers:{'Content-Type':m.mime,'Content-Length':String(m.bytes),'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}});
  }
  const entryMatch=path.match(/^\/api\/entries\/([^/]+)\/(feedback|like|comments)$/);
  if(entryMatch&&request.method==='GET'&&entryMatch[2]==='feedback')return json(await feedback(db,decodeURIComponent(entryMatch[1]),user));
  const writer=requireWrite(request,env);
  if(path==='/api/uploads'&&request.method==='POST')return await upload(request,env,db,writer);
  if(path==='/api/entries'&&request.method==='POST')return await createEntry(request,env,db,writer);
  if(mediaMatch&&request.method==='DELETE'){
   const deleted=await db.prepare('DELETE FROM media WHERE id=? AND owner=? AND NOT EXISTS (SELECT 1 FROM entry_media WHERE media_id=media.id) RETURNING object_key').bind(mediaMatch[1],writer.id).first();
   if(deleted)await env.BUCKET.delete(deleted.object_key);return json({ok:true});
  }
  if(entryMatch){const id=decodeURIComponent(entryMatch[1]),action=entryMatch[2];await requireEntry(db,id);
   if(action==='like'&&['PUT','DELETE'].includes(request.method)){
    if(request.method==='PUT')await db.prepare('INSERT INTO likes (entry_id,user_id,created_at) VALUES (?,?,?) ON CONFLICT(entry_id,user_id) DO NOTHING').bind(id,writer.id,now()).run();
    else await db.prepare('DELETE FROM likes WHERE entry_id=? AND user_id=?').bind(id,writer.id).run();
    return json(await feedback(db,id,writer));
   }
   if(action==='comments'&&request.method==='POST'){
    const b=await bodyJson(request),text=clean(b.body,1000,true),key=clean(b.requestKey,36,true);if(!uuid.test(key)||typeof b.ate!=='boolean')throw new HttpError(400,'请检查评价内容');
    const payloadHash=await hash({id,text,ate:b.ate}),previous=await db.prepare('SELECT id,payload_hash FROM comments WHERE user_id=? AND request_key=?').bind(writer.id,key).first();
    if(previous){if(previous.payload_hash!==payloadHash)throw new HttpError(409,'评价内容已变化，请重新提交');return json(await feedback(db,id,writer));}
    await rate(db,'comments','user_id',writer.id,60);
    await db.prepare('INSERT INTO comments (id,entry_id,user_id,display_name,body,ate_claim,request_key,payload_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,request_key) DO NOTHING').bind(crypto.randomUUID(),id,writer.id,writer.name,text,b.ate?1:0,key,payloadHash,now()).run();
    const saved=await db.prepare('SELECT payload_hash FROM comments WHERE user_id=? AND request_key=?').bind(writer.id,key).first();if(saved.payload_hash!==payloadHash)throw new HttpError(409,'评价内容已变化，请重新提交');return json(await feedback(db,id,writer),201);
   }
  }
  const commentMatch=path.match(/^\/api\/comments\/([a-f0-9-]{36})$/);
  if(commentMatch&&request.method==='DELETE'){await db.prepare('DELETE FROM comments WHERE id=? AND user_id=?').bind(commentMatch[1],writer.id).run();return json({ok:true});}
  throw new HttpError(404,'页面不存在');
 }catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);console.error('Food API failure',path,e?.message);return json({error:'暂时无法保存或载入，请稍后重试。已填写的内容会保留。'},503);}
}};
