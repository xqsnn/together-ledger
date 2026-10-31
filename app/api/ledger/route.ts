import { env } from 'cloudflare:workers';
import { chinaToday, expenseCategories, incomeCategories, ownerKeys, validateEntry, type OwnerKey } from '@/lib/ledger';
export const dynamic='force-dynamic';
// This is one shared ledger. Sites' private access boundary authorizes all admitted visitors.

type EntryRow={id:string;type:string;amount:number;owner:string;date:string;note:string;category?:string;revision:number;created_at:string};
type AvatarRow={owner:string;data:string};
type CategoryRow={type:string;name:string;position:number};
type OwnerRow={key:string;name:string;position:number};

const DEFAULT_OWNERS:{key:OwnerKey;name:string}[]=[
 {key:'qing',name:'青'},
 {key:'hua',name:'华'},
 {key:'together',name:'共同'},
];

function db(){if(!env.DB)throw new Error('账本暂时无法连接，请稍后重试');return env.DB;}
function reply(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});}

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
  (avatarRows.results as AvatarRow[]).forEach((a)=>{if(a.owner&&a.data)avatars[a.owner]=a.data;});
 }catch{}
 const qingName=ownerList.find((owner)=>owner.key==='qing')?.name??'青';
 const huaName=ownerList.find((owner)=>owner.key==='hua')?.name??'华';
 const aliases:Record<string,string>={'男生':qingName,'女生':huaName,'伊':huaName};
 return {
  entries:(rows.results as EntryRow[]).map((r)=>({...r,owner:aliases[r.owner]??r.owner,category:r.category||'其他',createdAt:r.created_at})),
  today:chinaToday(),
  avatars,
  categories,
  owners:ownerList,
 };
}

export async function GET(){
 try{return reply(await read());}
 catch(e){console.error(e);return reply({error:'账本暂时无法连接，请重试'},503);}
}

export async function POST(request:Request){
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'请求格式无效'},415);
 try{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b=await request.json() as any;
  const database=db();

  if(b.action==='save'){
   const [categories,ownerList]=await Promise.all([readCategories(database),readOwners(database)]);
   const type=b.entry?.type==='income'?'income':'expense';
   const v=validateEntry(b.entry,chinaToday(),{categories:categories[type],owners:ownerList.map((owner)=>owner.name)});
   const id=b.entry.id;const revision=b.entry.revision;
   if(id){
    if(typeof id!=='string'||!Number.isInteger(revision))return reply({error:'记录无效'},400);
    const r=await database.prepare('UPDATE entries SET type=?,amount=?,owner=?,date=?,note=?,category=?,revision=revision+1 WHERE id=? AND revision=?').bind(v.type,v.amount,v.owner,v.date,v.note,v.category,id,revision).run();
    if(!r.meta.changes)return reply({error:'记录已被更新或删除，请刷新后重试'},409);
   }else{
    await database.prepare('INSERT INTO entries (id,type,amount,owner,date,note,category,revision,created_at) VALUES (?,?,?,?,?,?,?,1,?)').bind(crypto.randomUUID(),v.type,v.amount,v.owner,v.date,v.note,v.category,new Date().toISOString()).run();
   }
  }else if(b.action==='delete'){
   if(typeof b.id!=='string'||!Number.isInteger(b.revision))return reply({error:'记录无效'},400);
   const r=await database.prepare('DELETE FROM entries WHERE id=? AND revision=?').bind(b.id,b.revision).run();
   if(!r.meta.changes)return reply({error:'记录已被更新或删除，请刷新后重试'},409);
  }else if(b.action==='avatar'){
   const ownerList=await readOwners(database);
   if(!ownerList.some((owner)=>owner.name===b.owner)||typeof b.data!=='string')return reply({error:'头像无效'},400);
   if(b.data===''){
    await database.prepare('DELETE FROM avatars WHERE owner=?').bind(b.owner).run();
   }else{
    if(!b.data.startsWith('data:image/')||b.data.length>300000)return reply({error:'头像过大或格式不支持'},400);
    await database.prepare('INSERT INTO avatars (owner,data,updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at').bind(b.owner,b.data,new Date().toISOString()).run();
   }
  }else if(b.action==='category'){
   const type=b.type==='income'?'income':b.type==='expense'?'expense':null;
   if(!type||typeof b.name!=='string')return reply({error:'分类无效'},400);
   const name=b.name.trim();
   if(!name||name.length>12||name==='全部')return reply({error:'分类名称需为 1-12 个字，且不能为「全部」'},400);
   const categories=await readCategories(database);
   const list=categories[type];
   if(b.op==='add'){
    if(list.includes(name))return reply({error:'该分类已存在'},409);
    if(list.length>=30)return reply({error:'分类数量已达上限'},400);
    await database.prepare('INSERT INTO categories (type,name,position) VALUES (?,?,?)').bind(type,name,list.length+1).run();
   }else if(b.op==='rename'){
    if(!list.includes(name))return reply({error:'分类不存在'},404);
    const newName=typeof b.newName==='string'?b.newName.trim():'';
    if(!newName||newName.length>12||newName==='全部')return reply({error:'分类名称需为 1-12 个字，且不能为「全部」'},400);
    if(newName!==name&&list.includes(newName))return reply({error:'该分类已存在'},409);
    if(newName!==name){
     await database.batch([
      database.prepare('UPDATE entries SET category=?, revision=revision+1 WHERE type=? AND category=?').bind(newName,type,name),
      database.prepare('UPDATE categories SET name=? WHERE type=? AND name=?').bind(newName,type,name),
     ]);
    }
   }else if(b.op==='delete'){
    if(!list.includes(name))return reply({error:'分类不存在'},404);
    if(list.length<=1)return reply({error:'至少保留一个分类'},400);
    const remaining=list.filter((item)=>item!==name);
    const fallback=remaining.includes('其他')?'其他':remaining[0];
    await database.batch([
     database.prepare('UPDATE entries SET category=?, revision=revision+1 WHERE type=? AND category=?').bind(fallback,type,name),
     database.prepare('DELETE FROM categories WHERE type=? AND name=?').bind(type,name),
    ]);
   }else return reply({error:'不支持的操作'},400);
  }else if(b.action==='owner'){
   if(!ownerKeys.includes(b.key)||typeof b.name!=='string')return reply({error:'归属无效'},400);
   const ownerList=await readOwners(database);
   const current=ownerList.find((owner)=>owner.key===b.key);
   if(!current)return reply({error:'归属不存在'},404);
   const name=b.name.trim();
   if(!name||name.length>8||name==='全部')return reply({error:'名字需为 1-8 个字，且不能为「全部」'},400);
   if(ownerList.some((owner)=>owner.key!==b.key&&owner.name===name))return reply({error:'该名字已被使用'},409);
   if(name!==current.name){
    await database.batch([
     database.prepare('UPDATE entries SET owner=?, revision=revision+1 WHERE owner=?').bind(name,current.name),
     database.prepare('UPDATE avatars SET owner=? WHERE owner=?').bind(name,current.name),
     database.prepare('UPDATE owners SET name=? WHERE key=?').bind(name,b.key),
    ]);
   }
  }else return reply({error:'不支持的操作'},400);

  return reply(await read());
 }catch(e){
  if(e instanceof SyntaxError)return reply({error:'请求格式无效'},400);
  const message=e instanceof Error?e.message:'保存失败，请重试';
  console.error(e);
  return reply({error:message},400);
 }
}
