import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,cp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const dataDir=resolve(process.env.DATA_DIR||'/var/lib/beijing-food-map');
const backupRoot=resolve(process.env.BACKUP_DIR||'/var/backups/beijing-food-map');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');const destination=join(backupRoot,stamp);
await mkdir(destination,{recursive:true,mode:0o700});
const db=new DatabaseSync(join(dataDir,'food-map.sqlite'),{readOnly:true});
try{await backup(db,join(destination,'food-map.sqlite'));}finally{db.close();}
await cp(join(dataDir,'media'),join(destination,'media'),{recursive:true});
await writeFile(join(destination,'backup.json'),JSON.stringify({createdAt:new Date().toISOString(),database:'food-map.sqlite',media:'media'})+'\n',{mode:0o600});
console.log('Backup created: '+destination);
