export type Owner = '男生' | '女生' | '共同';
export type Entry = { id:string; type:'income'|'expense'; amount:number; owner:Owner; date:string; note:string; revision:number; createdAt:string };
export const owners:Owner[] = ['男生','女生','共同'];
export const MAX_CENTS = 99999999999;
export function chinaToday(now = new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function toCents(value:string, allowZero=false) {
 if(!/^\d{1,9}(\.\d{1,2})?$/.test(value)) throw new Error('请输入有效金额，最多两位小数');
 const [whole,decimal=''] = value.split('.'); const amount = Number(whole)*100+Number(decimal.padEnd(2,'0'));
 if(amount>(MAX_CENTS) || amount<(allowZero?0:1)) throw new Error(allowZero?'期初存款不能为负数':'金额必须大于 0');
 return amount;
}
export function validateEntry(value:unknown,today=chinaToday()) {
 const b=value as Record<string,unknown>;
 if(!b || !['income','expense'].includes(String(b.type)) || !owners.includes(b.owner as Owner)) throw new Error('请选择收支类型和归属');
 if(typeof b.amount!=='number'||!Number.isSafeInteger(b.amount)||b.amount<1||b.amount>MAX_CENTS) throw new Error('金额无效');
 if(typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||b.date<'1900-01-01'||b.date>today) throw new Error('请选择今天或过去的日期');
 const parsed=new Date(b.date+'T00:00:00Z'); if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==b.date)throw new Error('日期无效');
 if(typeof b.note!=='string'||b.note.length>100)throw new Error('备注不能超过 100 字');
 return {type:b.type as Entry['type'],owner:b.owner as Owner,amount:b.amount,date:b.date,note:b.note.trim()};
}
export function totals(entries:Entry[],month:string,opening=0) {
 const monthly=entries.filter(e=>e.date.startsWith(month));
 const sum=(a:Entry[],type:string)=>a.filter(e=>e.type===type).reduce((n,e)=>n+e.amount,0);
 const income=sum(monthly,'income'),expense=sum(monthly,'expense');
 return {balance:opening+sum(entries,'income')-sum(entries,'expense'),income,expense,surplus:income-expense,byOwner:owners.map(owner=>({owner,income:sum(monthly.filter(e=>e.owner===owner),'income'),expense:sum(monthly.filter(e=>e.owner===owner),'expense')}))};
}
