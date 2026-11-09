import { env } from 'cloudflare:workers';
import { chinaStamp, chinaTime, chinaToday, expenseCategories, incomeCategories, ownerKeys, validateEntry, type OwnerKey } from '@/lib/ledger';
import {
  IMAGE_LIMITS,
  MAX_ENTRY_IMAGES,
  MediaError,
  isValidId,
  type MediaLimits,
  type MediaMeta,
} from '@/lib/media';
import { drainDeletionsThrottled, storageMode } from '@/lib/media-store';
import { readSession } from '@/lib/auth-server';
export const dynamic='force-dynamic';
// 一本共享账本：所有登录成员看到同一份数据，登录只用来区分「谁在记账」。

type EntryRow={id:string;type:string;amount:number;owner:string;created_by?:string|null;date:string;time?:string;note:string;category?:string;revision:number;created_at:string};
type AvatarRow={owner:string;data:string};
type CategoryRow={type:string;name:string;position:number};
type OwnerRow={key:string;name:string;position:number};
type MediaRow={id:string;entry_id:string|null;comment_id:string|null;width:number;height:number;bytes:number;thumb_bytes:number;created_at:string};

const DEFAULT_OWNERS:{key:OwnerKey;name:string}[]=[
 {key:'qing',name:'青'},
 {key:'hua',name:'华'},
 {key:'together',name:'共同'},
];

// 兼容迁移前仍是显示名的存量数据；迁移完成后 owner 列里已经是 key。
function resolveOwnerKey(value:string, ownerList:{key:OwnerKey;name:string}[]):OwnerKey{
 if((ownerKeys as readonly string[]).includes(value))return value as OwnerKey;
 const byName=ownerList.find((owner)=>owner.name===value);
 if(byName)return byName.key;
 if(value==='男生'||value==='青')return 'qing';
 if(value==='女生'||value==='伊'||value==='华')return 'hua';
 return 'together';
}

function db(){if(!env.DB)throw new Error('账本暂时无法连接，请稍后重试');return env.DB;}
function reply(data:unknown,status=200,cookie?:string|null){
 const headers:Record<string,string>={'Cache-Control':'no-store'};
 if(cookie)headers['Set-Cookie']=cookie;
 return Response.json(data,{status,headers});
}
function fail(code:string,message:string,status:number){return reply({error:message,code},status);}

async function ensureCategories(database:D1Database){
 const row=await database.prepare('SELECT COUNT(*) AS count FROM categories').first<{count:number}>();
 if(Number(row?.count??0)>0)return;
 await database.batch([
  ...expenseCategories.map((name,index)=>database.prepare('INSERT OR IGNORE INTO categories (type,name,position) VALUES (?,?,?)').bind('expense',name,index+1)),
  ...incomeCategories.map((name,index)=>database.prepare('INSERT OR IGNORE INTO categories (type,name,position) VALUES (?,?,?)').bind('income',name,index+1)),
 ]);
}

async function readCategories(database:D1Database):Promise<{expense:string[];income:string[]}>{
 try{
  await ensureCategories(database);
  const rows=await database.prepare('SELECT type, name, position FROM categories ORDER BY type, position, name').all();
  const categories:{expense:string[];income:string[]}={expense:[],income:[]};
  (rows.results as CategoryRow[]).forEach((row)=>{
   if(row.type==='expense')categories.expense.push(row.name);
   else if(row.type==='income')categories.income.push(row.name);
  });
  if(!categories.expense.length)categories.expense=[...expenseCategories];
  if(!categories.income.length)categories.income=[...incomeCategories];
  return categories;
 }catch{
  return {expense:[...expenseCategories],income:[...incomeCategories]};
 }
}

async function ensureOwners(database:D1Database){
 const row=await database.prepare('SELECT COUNT(*) AS count FROM owners').first<{count:number}>();
 if(Number(row?.count??0)>0)return;
 await database.batch(DEFAULT_OWNERS.map((owner,index)=>database.prepare('INSERT OR IGNORE INTO owners (key,name,position) VALUES (?,?,?)').bind(owner.key,owner.name,index+1)));
}

async function readOwners(database:D1Database):Promise<{key:OwnerKey;name:string}[]>{
 try{
  await ensureOwners(database);
  const rows=await database.prepare('SELECT key, name, position FROM owners ORDER BY position').all();
  const owners=(rows.results as OwnerRow[]).map((row)=>({key:row.key as OwnerKey,name:row.name}));
  return owners.length?owners:DEFAULT_OWNERS;
 }catch{
  return DEFAULT_OWNERS;
 }
}

function mediaLimits():MediaLimits{
 const mode=storageMode();
 return {...IMAGE_LIMITS[mode],mode,maxPerEntry:MAX_ENTRY_IMAGES};
}

async function read(){
 const database=db();
 const [rows,categories,ownerList]=await Promise.all([
  database.prepare('SELECT * FROM entries ORDER BY date DESC, created_at DESC, id DESC').all(),
  readCategories(database),
  readOwners(database),
 ]);
 const avatars:Record<string,string>={};
 try{
  const avatarRows=await database.prepare('SELECT owner, data FROM avatars').all();
  (avatarRows.results as AvatarRow[]).forEach((a)=>{if(a.owner&&a.data)avatars[resolveOwnerKey(a.owner,ownerList)]=a.data;});
 }catch{}
 // 评论已下线：只读记录图片。历史评论图（entry_id 为空）不再返回给前端。
 let mediaRows:MediaRow[]=[];
 try{
  const media=await database.prepare('SELECT id, entry_id, comment_id, width, height, bytes, thumb_bytes, created_at FROM media ORDER BY created_at, id').all<MediaRow>();
  mediaRows=media.results;
 }catch{}
 const mediaByEntry=new Map<string,MediaMeta[]>();
 mediaRows.forEach((row)=>{
  if(!row.entry_id)return;
  const meta:MediaMeta={id:row.id,width:Number(row.width),height:Number(row.height),bytes:Number(row.bytes),thumbBytes:Number(row.thumb_bytes)};
  mediaByEntry.set(row.entry_id,[...(mediaByEntry.get(row.entry_id)??[]),meta]);
 });
 const ownerNameByKey=new Map(ownerList.map((owner)=>[owner.key,owner.name]));
 return {
  entries:(rows.results as EntryRow[]).map((r)=>{
   const ownerKey=resolveOwnerKey(r.owner,ownerList);
   // 存量记录没有 created_by：归属是具体某人就当作本人记的，「共同」无法判断，留空。
   const createdBy=r.created_by?resolveOwnerKey(r.created_by,ownerList):(ownerKey==='together'?null:ownerKey);
   // 没有 time 的旧库/旧记录：用写入时刻回填北京时间，界面不会因为缺列而报错。
   const stamp=r.time?null:chinaStamp(r.created_at);
   return {...r,owner:ownerNameByKey.get(ownerKey)??r.owner,ownerKey,createdBy,category:r.category||'其他',time:r.time||stamp?.time||'',createdAt:r.created_at,images:mediaByEntry.get(r.id)??[]};
  }),
  mediaLimits:mediaLimits(),
  today:chinaToday(),
  avatars,
  categories,
  owners:ownerList,
 };
}

/**
 * 删除 media 行时按行内 storage 收尾：D1 字节同批删除，R2 对象进重试队列。
 * 每条都带 `NOT EXISTS media` 守卫：只有 media 行确实已经删掉才动对象，
 * 避免「条目 revision 冲突、没删成」却把图片字节/对象清掉。
 */
function mediaCleanupStatements(database:D1Database, rows:{id:string;storage:string}[]){
 const statements:D1PreparedStatement[]=[];
 const now=new Date().toISOString();
 for(const row of rows){
  for(const variant of ['full','thumb'] as const){
   if(row.storage==='d1'){
    statements.push(database.prepare('DELETE FROM media_blobs WHERE media_id=? AND variant=? AND NOT EXISTS (SELECT 1 FROM media WHERE id=?)').bind(row.id,variant,row.id));
   }else{
    statements.push(database.prepare('INSERT OR IGNORE INTO media_deletions (media_id,variant,storage,created_at,attempts,next_attempt_at) SELECT ?,?,?,?,0,? WHERE NOT EXISTS (SELECT 1 FROM media WHERE id=?)').bind(row.id,variant,row.storage,now,now,row.id));
   }
  }
 }
 return statements;
}

export async function GET(request:Request){
 const session=await readSession(request);
 if(!session)return fail('UNAUTHORIZED','请先登录',401);
 try{
  const result=await read();
  try{await drainDeletionsThrottled(db());}catch{}
  return reply(result,200,session.cookie);
 }
 catch(e){console.error(e);return fail('SERVER_ERROR','账本暂时无法连接，请重试',503);}
}

export async function POST(request:Request){
 if(!request.headers.get('content-type')?.includes('application/json'))return fail('REQUEST_INVALID','请求格式无效',415);
 const session=await readSession(request);
 if(!session)return fail('UNAUTHORIZED','请先登录',401);
 try{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b=await request.json() as any;
  const database=db();

  if(b.action==='save'){
   const [categories,ownerList]=await Promise.all([readCategories(database),readOwners(database)]);
   const type=b.entry?.type==='income'?'income':'expense';
   const v=validateEntry(b.entry,chinaToday(),{categories:categories[type],ownerKeys:ownerList.map((owner)=>owner.key)});
   const id=b.entry?.id;
   const revision=b.entry?.revision;
   const mode=b.mode;
   if(mode!==undefined&&mode!=='create'&&mode!=='update')return fail('ENTRY_INVALID','记录无效',400);
   if(mode==='create'||(!mode&&!id)){
    const entryId=mode==='create'?id:(id??crypto.randomUUID());
    if(!isValidId(entryId))return fail('ENTRY_INVALID','记录无效',400);
    const readExisting=()=>database.prepare('SELECT id, revision, type, amount, owner, date, time, note, category FROM entries WHERE id=?').bind(entryId).first<{id:string;revision:number;type:string;amount:number;owner:string;date:string;time:string;note:string;category:string|null}>();
    const same=(row:{type:string;amount:number;owner:string;date:string;time:string;note:string;category:string|null}|null)=>Boolean(row)&&row!.type===v.type&&Number(row!.amount)===v.amount&&row!.owner===v.ownerKey&&row!.date===v.date&&(row!.time||'')===(v.time||'')&&row!.note===v.note&&(row!.category||'其他')===v.category;
    // 幂等新建：同一个客户端 id 重试只会落一条；并发撞 id 时用 OR IGNORE 兜住主键。
    const inserted=await database.prepare('INSERT OR IGNORE INTO entries (id,type,amount,owner,created_by,date,time,note,category,revision,created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)').bind(entryId,v.type,v.amount,v.ownerKey,session.ownerKey,v.date,v.time||chinaTime(),v.note,v.category,new Date().toISOString()).run();
    if(!inserted.meta.changes&&!same(await readExisting()))return fail('ENTRY_CONFLICT','记录已存在且内容不同，请刷新后重试',409);
   }else{
    if(!isValidId(id)||!Number.isInteger(revision))return fail('ENTRY_INVALID','记录无效',400);
    // 编辑时不带 time 表示保留原时间，避免改备注把发生时刻冲掉。
    const keepTime=typeof b.entry?.time!=='string';
    const r=await database.prepare('UPDATE entries SET type=?,amount=?,owner=?,date=?,time=CASE WHEN ? THEN time ELSE ? END,note=?,category=?,revision=revision+1 WHERE id=? AND revision=?').bind(v.type,v.amount,v.ownerKey,v.date,keepTime?1:0,v.time,v.note,v.category,id,revision).run();
    if(!r.meta.changes)return fail('REVISION_CONFLICT','记录已被更新或删除，请刷新后重试',409);
   }
  }else if(b.action==='delete'){
   if(!isValidId(b.id)||!Number.isInteger(b.revision))return fail('ENTRY_INVALID','记录无效',400);
   const current=await database.prepare('SELECT revision FROM entries WHERE id=?').bind(b.id).first<{revision:number}>();
   if(!current||Number(current.revision)!==b.revision)return fail('REVISION_CONFLICT','记录已被更新或删除，请刷新后重试',409);
   const media=await database.prepare('SELECT m.id, m.storage FROM media m LEFT JOIN comments c ON m.comment_id=c.id WHERE m.entry_id=? OR c.entry_id=?').bind(b.id,b.id).all<{id:string;storage:string}>();
   // 单条记录删除 = 一次 batch：删条目（级联评论/media）+ 兜底显式删 media + 对象收尾。
   // media 删除与对象收尾都以「条目已不存在」/「media 行已不存在」为守卫，
   // revision 在这中间被改掉时整批都不会动图片。
   const statements:D1PreparedStatement[]=[
    database.prepare('DELETE FROM entries WHERE id=? AND revision=?').bind(b.id,b.revision),
    database.prepare('DELETE FROM media WHERE entry_id=? AND NOT EXISTS (SELECT 1 FROM entries WHERE id=?)').bind(b.id,b.id),
    database.prepare('DELETE FROM media WHERE comment_id IN (SELECT id FROM comments WHERE entry_id=?) AND NOT EXISTS (SELECT 1 FROM entries WHERE id=?)').bind(b.id,b.id),
    ...mediaCleanupStatements(database,media.results),
   ];
   const results=await database.batch(statements);
   const deleted=results[0]?.meta?.changes??0;
   if(!deleted)return fail('REVISION_CONFLICT','记录已被更新或删除，请刷新后重试',409);
  }else if(b.action==='avatar'){
   const ownerList=await readOwners(database);
   const matched=typeof b.ownerKey==='string'
    ? ownerList.find((owner)=>owner.key===b.ownerKey)
    : typeof b.owner==='string'
     ? ownerList.find((owner)=>owner.name===b.owner)
     : undefined;
   if(!matched||typeof b.data!=='string')return fail('AVATAR_INVALID','头像无效',400);
   if(b.data===''){
    await database.prepare('DELETE FROM avatars WHERE owner=?').bind(matched.key).run();
   }else{
    if(!b.data.startsWith('data:image/')||b.data.length>300000)return fail('AVATAR_INVALID','头像过大或格式不支持',400);
    await database.prepare('INSERT INTO avatars (owner,data,updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at').bind(matched.key,b.data,new Date().toISOString()).run();
   }
  }else if(b.action==='category'){
   const type=b.type==='income'?'income':b.type==='expense'?'expense':null;
   if(!type||typeof b.name!=='string')return fail('CATEGORY_INVALID','分类无效',400);
   const name=b.name.trim();
   if(!name||name.length>12||name==='全部')return fail('CATEGORY_INVALID','分类名称需为 1-12 个字，且不能为「全部」',400);
   const categories=await readCategories(database);
   const list=categories[type];
   if(b.op==='add'){
    if(list.includes(name))return fail('CATEGORY_CONFLICT','该分类已存在',409);
    if(list.length>=30)return fail('CATEGORY_INVALID','分类数量已达上限',400);
    await database.prepare('INSERT INTO categories (type,name,position) VALUES (?,?,?)').bind(type,name,list.length+1).run();
   }else if(b.op==='rename'){
    if(!list.includes(name))return fail('CATEGORY_NOT_FOUND','分类不存在',404);
    const newName=typeof b.newName==='string'?b.newName.trim():'';
    if(!newName||newName.length>12||newName==='全部')return fail('CATEGORY_INVALID','分类名称需为 1-12 个字，且不能为「全部」',400);
    if(newName!==name&&list.includes(newName))return fail('CATEGORY_CONFLICT','该分类已存在',409);
    if(newName!==name){
     await database.batch([
      database.prepare('UPDATE entries SET category=?, revision=revision+1 WHERE type=? AND category=?').bind(newName,type,name),
      database.prepare('UPDATE categories SET name=? WHERE type=? AND name=?').bind(newName,type,name),
     ]);
    }
   }else if(b.op==='delete'){
    if(!list.includes(name))return fail('CATEGORY_NOT_FOUND','分类不存在',404);
    if(list.length<=1)return fail('CATEGORY_INVALID','至少保留一个分类',400);
    const remaining=list.filter((item)=>item!==name);
    const fallback=remaining.includes('其他')?'其他':remaining[0];
    await database.batch([
     database.prepare('UPDATE entries SET category=?, revision=revision+1 WHERE type=? AND category=?').bind(fallback,type,name),
     database.prepare('DELETE FROM categories WHERE type=? AND name=?').bind(type,name),
    ]);
   }else return fail('UNSUPPORTED','不支持的操作',400);
  }else if(b.action==='owner'){
   if(!ownerKeys.includes(b.key)||typeof b.name!=='string')return fail('OWNER_INVALID','归属无效',400);
   const ownerList=await readOwners(database);
   const current=ownerList.find((owner)=>owner.key===b.key);
   if(!current)return fail('OWNER_NOT_FOUND','归属不存在',404);
   const name=b.name.trim();
   if(!name||name.length>8||name==='全部')return fail('OWNER_INVALID','名字需为 1-8 个字，且不能为「全部」',400);
   if(ownerList.some((owner)=>owner.key!==b.key&&owner.name===name))return fail('OWNER_CONFLICT','该名字已被使用',409);
   if(name!==current.name){
    await database.batch([
     database.prepare('UPDATE owners SET name=? WHERE key=?').bind(name,b.key),
     // 兼容尚未迁移的数据：如果仍存着旧显示名，顺手改成稳定的 key；已迁移的记录不会匹配。
     database.prepare('UPDATE entries SET owner=? WHERE owner=?').bind(b.key,current.name),
     database.prepare('UPDATE OR REPLACE avatars SET owner=? WHERE owner=?').bind(b.key,current.name),
    ]);
   }
  }else return fail('UNSUPPORTED','不支持的操作',400);

  const result=await read();
  try{await drainDeletionsThrottled(database);}catch{}
  return reply(result,200,session.cookie);
 }catch(e){
  if(e instanceof MediaError)return fail(e.code,e.message,e.status);
  if(e instanceof SyntaxError)return fail('REQUEST_INVALID','请求格式无效',400);
  const message=e instanceof Error?e.message:'保存失败，请重试';
  console.error(e);
  return fail('ENTRY_INVALID',message,400);
 }
}
