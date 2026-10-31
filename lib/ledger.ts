export type OwnerKey = 'qing' | 'hua' | 'together';
export type Owner = string;
export const ownerKeys:OwnerKey[] = ['qing','hua','together'];
export type Entry = { id:string; type:'income'|'expense'; amount:number; owner:Owner; ownerKey:OwnerKey; date:string; note:string; category:string; revision:number; createdAt:string };
export type LedgerFilter = { type?: Entry['type']|'all'; owner?: Owner|'全部'; ownerKey?: OwnerKey|'全部'; category?: string|'全部' };
export type DailyTotal = { date:string; income:number; expense:number; surplus:number; count:number };
export const owners:Owner[] = ['青','华','共同'];
export const expenseCategories = ['餐饮','交通','购物','居住','日用','娱乐','医疗','人情','旅行','其他'] as const;
export const incomeCategories = ['工资','生活费','理财','意外所得','其他'] as const;
export function categoriesFor(type:Entry['type']|'all'):string[] {
 if(type==='income')return [...incomeCategories];
 if(type==='expense')return [...expenseCategories];
 return [...new Set([...expenseCategories,...incomeCategories])];
}
export const MAX_CENTS = 99999999999;
export function chinaToday(now = new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function toCents(value:string, allowZero=false) {
 if(!/^\d{1,9}(\.\d{1,2})?$/.test(value)) throw new Error('请输入有效金额，最多两位小数');
 const [whole,decimal=''] = value.split('.'); const amount = Number(whole)*100+Number(decimal.padEnd(2,'0'));
 if(amount>(MAX_CENTS) || amount<(allowZero?0:1)) throw new Error(allowZero?'期初存款不能为负数':'金额必须大于 0');
 return amount;
}
export function validateEntry(value:unknown,today=chinaToday(),options:{categories?:readonly string[];ownerKeys?:readonly OwnerKey[]}={}) {
 const b=value as Record<string,unknown>;
 const allowedOwners=options.ownerKeys??ownerKeys;
 if(!b || !['income','expense'].includes(String(b.type)) || !allowedOwners.includes(b.ownerKey as OwnerKey)) throw new Error('请选择收支类型和归属');
 if(typeof b.amount!=='number'||!Number.isSafeInteger(b.amount)||b.amount<1||b.amount>MAX_CENTS) throw new Error('金额无效');
 if(typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||b.date<'1900-01-01'||b.date>today) throw new Error('请选择今天或过去的日期');
 const parsed=new Date(b.date+'T00:00:00Z'); if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==b.date)throw new Error('日期无效');
 if(typeof b.note!=='string'||b.note.length>100)throw new Error('备注不能超过 100 字');
 if(typeof b.category!=='string'||!(options.categories??categoriesFor(b.type as Entry['type'])).includes(b.category))throw new Error('请选择分类');
 return {type:b.type as Entry['type'],ownerKey:b.ownerKey as OwnerKey,amount:b.amount,date:b.date,note:b.note.trim(),category:b.category};
}
export function totals(entries:Entry[],month:string,opening=0,ownerNames:readonly string[]=owners) {
 const monthly=entries.filter(e=>e.date.startsWith(month));
 const sum=(a:Entry[],type:string)=>a.filter(e=>e.type===type).reduce((n,e)=>n+e.amount,0);
 const income=sum(monthly,'income'),expense=sum(monthly,'expense');
 return {balance:opening+sum(entries,'income')-sum(entries,'expense'),income,expense,surplus:income-expense,byOwner:ownerNames.map(owner=>({owner,income:sum(monthly.filter(e=>e.owner===owner),'income'),expense:sum(monthly.filter(e=>e.owner===owner),'expense')}))};
}
export function dailyTotals(entries:Entry[],month:string,filter:LedgerFilter={}) {
 const grouped=new Map<string,DailyTotal>();
 entries.filter(e=>e.date.startsWith(month)&&(filter.type===undefined||filter.type==='all'||e.type===filter.type)&&(filter.owner===undefined||filter.owner==='全部'||e.owner===filter.owner)&&(filter.ownerKey===undefined||filter.ownerKey==='全部'||e.ownerKey===filter.ownerKey)&&(filter.category===undefined||filter.category==='全部'||e.category===filter.category)).forEach(e=>{
  const current=grouped.get(e.date)??{date:e.date,income:0,expense:0,surplus:0,count:0};
  current[e.type]+=e.amount;
  current.surplus=current.income-current.expense;
  current.count+=1;
  grouped.set(e.date,current);
 });
 return Array.from(grouped.values()).sort((a,b)=>a.date.localeCompare(b.date));
}
