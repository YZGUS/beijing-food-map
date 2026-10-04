import {createStorage} from '../server/storage.js';
import {createAuth} from '../server/auth.js';
import {resolve} from 'node:path';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
const storage=await createStorage({dataDir:resolve(process.env.DATA_DIR||'.data'),migrationsDir:resolve('drizzle'),publicDir:resolve('dist/public')});
try{const auth=createAuth({connection:storage.connection,origin:process.env.APP_ORIGIN||'http://127.0.0.1:8790',basePath:process.env.BASE_PATH||'/',registrationCode:process.env.REGISTRATION_CODE||''});const user=await auth.createUser(data);console.log(JSON.stringify({created:true,username:data.username,id:user.id}));}finally{storage.close();}
