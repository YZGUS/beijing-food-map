import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createStorage} from './storage.js';
import {createAuth} from './auth.js';
import foodApi from '../dist/server/food-api.js';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
export async function createFoodApplication(options={}){
 const origin=new URL(options.origin||process.env.APP_ORIGIN||'http://127.0.0.1:8790').origin;
 const basePath=options.basePath||process.env.BASE_PATH||'/';
 if(!/^\/(?:[a-z0-9-]+\/)*$/.test(basePath))throw new Error('BASE_PATH must be a normalized path ending in /');
 const publicRead=options.publicRead??(process.env.PUBLIC_READ==='true');
 const storage=await createStorage({dataDir:resolve(options.dataDir||process.env.DATA_DIR||resolve(root,'.data')),migrationsDir:options.migrationsDir||resolve(root,'drizzle'),publicDir:options.publicDir||resolve(root,'dist/public')});
 const auth=createAuth({connection:storage.connection,origin,basePath,publicRead,registrationCode:options.registrationCode??process.env.REGISTRATION_CODE??''});
 async function handle(request){
  try{
   const url=new URL(request.url);if(url.origin!==origin)return Response.json({error:'不正确的网站地址'},{status:400});
   if(url.pathname===basePath.slice(0,-1)&&basePath!=='/')return Response.redirect(origin+basePath,308);
   if(!url.pathname.startsWith(basePath))return new Response('Not found',{status:404});
   const internalUrl=new URL(url);internalUrl.pathname='/'+url.pathname.slice(basePath.length);
   const headers=new Headers(request.headers);for(const key of [...headers.keys()])if(key.startsWith('oai-authenticated-user-'))headers.delete(key);
   const internal=new Request(internalUrl,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,duplex:'half'});
   const authResponse=await auth.handle(internal);if(authResponse)return authResponse;
   const path=internalUrl.pathname;
   if(path==='/api/health')return Response.json({ok:true,service:'beijing-food-map'},{headers:{'Cache-Control':'no-store'}});
   const user=await auth.getUser(internal);
   const loginAssets=new Set(['/login','/login.html','/login.css','/login.js','/assets/navi-avatar.png']);
   if(loginAssets.has(path)){
    if(path==='/login'&&user)return Response.redirect(origin+basePath,303);
    const resource=new URL(internalUrl);if(path==='/login')resource.pathname='/login.html';
    return storage.ASSETS.fetch(new Request(resource));
   }
   if(!publicRead&&!user){
    if(path.startsWith('/api/'))return Response.json({error:'登录后即可浏览食单'},{status:401,headers:{'Cache-Control':'no-store'}});
    return Response.redirect(origin+basePath+'login',303);
   }
   if(path==='/api/session')return Response.json({user:user?{name:user.name}:null,publicRead},{headers:{'Cache-Control':'private, no-store'}});
   const response=await foodApi.fetch(internal,{...storage,APP_ORIGIN:origin,AUTH_USER:user});
   if(!publicRead){const protectedHeaders=new Headers(response.headers);protectedHeaders.set('Cache-Control','private, no-store');protectedHeaders.set('Vary','Cookie');return new Response(response.body,{status:response.status,headers:protectedHeaders});}
   return response;
  }catch(error){console.error('Food request failed',error?.message);return Response.json({error:'暂时无法访问，请稍后再试。'},{status:503,headers:{'Cache-Control':'no-store'}});}
 }
 return {handle,storage,auth,origin,basePath,close:storage.close};
}
export async function startServer(options={}){
 const app=await createFoodApplication(options);
 const server=createServer(async(req,res)=>{
  try{
   const host=req.headers.host;
   const allowed=new Set([new URL(app.origin).host,'127.0.0.1:'+String(options.port??process.env.PORT??8790)]);
   if(!host||!allowed.has(host)){res.writeHead(400);res.end('Invalid host');return;}
   if(Number(req.headers['content-length'])>6*1024*1024){res.writeHead(413);res.end('Request too large');return;}
   const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value&&!key.startsWith('oai-authenticated-user-'))headers.set(key,Array.isArray(value)?value.join(','):value);
   const request=new Request(new URL(req.url,app.origin),{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Readable.toWeb(req),duplex:'half'});
   const response=await app.handle(request);
   res.writeHead(response.status,Object.fromEntries(response.headers));
   if(req.method==='HEAD'||!response.body)res.end();else Readable.fromWeb(response.body).pipe(res);
  }catch(error){console.error('HTTP request failed',error?.message);if(!res.headersSent)res.writeHead(500);res.end('Server error');}
 });
 server.requestTimeout=30000;server.headersTimeout=15000;
 const host=options.host||process.env.HOST||'127.0.0.1',port=Number(options.port??process.env.PORT??8790);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 console.log('北京食单已启动：'+app.origin+app.basePath);
 return {...app,server,async stop(){await new Promise(resolve=>server.close(resolve));app.close();}};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const app=await startServer();for(const event of ['SIGINT','SIGTERM'])process.once(event,async()=>{await app.stop();process.exit();});
}
