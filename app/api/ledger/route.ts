import { env } from 'cloudflare:workers';
import { chinaToday, MAX_CENTS, validateEntry } from '@/lib/ledger';
export const dynamic='force-dynamic';
// This is one shared ledger. Sites' private access boundary authorizes all admitted visitors.
function db(){if(!env.DB)throw new Error('账本暂时无法连接，请稍后重试');return env.DB;}
function reply(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});}
async function read(){const database=db();const [rows,setting]=await Promise.all([database.prepare('SELECT * FROM entries ORDER BY date DESC, created_at DESC, id DESC').all(),database.prepare("SELECT opening, revision FROM settings WHERE id = 'ledger'").first()]);return {entries:rows.results.map((r:any)=>({...r,createdAt:r.created_at})),opening:setting?.opening??0,settingsRevision:setting?.revision??0,today:chinaToday()};}
export async function GET(){try{return reply(await read());}catch(e){console.error(e);return reply({error:'账本暂时无法连接，请重试'},503);}}
export async function POST(request:Request){if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'请求格式无效'},415);try{
 const b=await request.json() as any;const database=db();
 if(b.action==='save'){
 const v=validateEntry(b.entry);const id=b.entry.id;const revision=b.entry.revision;
 if(id){if(typeof id!=='string'||!Number.isInteger(revision))return reply({error:'记录无效'},400);
 const r=await database.prepare('UPDATE entries SET type=?,amount=?,owner=?,date=?,note=?,revision=revision+1 WHERE id=? AND revision=?').bind(v.type,v.amount,v.owner,v.date,v.note,id,revision).run();
 if(!r.meta.changes)return reply({error:'记录已被更新或删除，请刷新后重试'},409);
 }else{await database.prepare('INSERT INTO entries (id,type,amount,owner,date,note,revision,created_at) VALUES (?,?,?,?,?,?,1,?)').bind(crypto.randomUUID(),v.type,v.amount,v.owner,v.date,v.note,new Date().toISOString()).run();}
 }else if(b.action==='delete'){
 if(typeof b.id!=='string'||!Number.isInteger(b.revision))return reply({error:'记录无效'},400);
 const r=await database.prepare('DELETE FROM entries WHERE id=? AND revision=?').bind(b.id,b.revision).run();if(!r.meta.changes)return reply({error:'记录已被更新或删除，请刷新后重试'},409);
 }else if(b.action==='opening'){
 if(!Number.isSafeInteger(b.opening)||b.opening<0||b.opening>MAX_CENTS||!Number.isInteger(b.revision))return reply({error:'期初存款无效'},400);
 if(b.revision===0){const r=await database.prepare("INSERT OR IGNORE INTO settings (id,opening,revision) VALUES ('ledger',?,1)").bind(b.opening).run();if(!r.meta.changes)return reply({error:'期初存款已变更，请刷新后重试'},409);}
 else{const r=await database.prepare("UPDATE settings SET opening=?,revision=revision+1 WHERE id='ledger' AND revision=?").bind(b.opening,b.revision).run();if(!r.meta.changes)return reply({error:'期初存款已变更，请刷新后重试'},409);}
 }else return reply({error:'不支持的操作'},400);
 return reply(await read());
 }catch(e){if(e instanceof SyntaxError)return reply({error:'请求格式无效'},400);const message=e instanceof Error?e.message:'保存失败，请重试';console.error(e);return reply({error:message},400);}}
