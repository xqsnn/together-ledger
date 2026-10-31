import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../lib/ledger.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {totals,dailyTotals,toCents,chinaToday,validateEntry}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
assert.equal(toCents('0.01'),1);assert.equal(toCents('1.10'),110);assert.equal(toCents('0',true),0);
for(const n of ['0','-1','1.234','1e2','NaN'])assert.throws(()=>toCents(n));
assert.equal(chinaToday(new Date('2026-10-31T16:00:00Z')),'2026-11-01');
assert.equal(chinaToday(new Date('2026-10-31T15:59:59Z')),'2026-10-31');
const make=(id,type,amount,owner,date,category='其他')=>({id,type,amount,owner,ownerKey:{青:'qing',华:'hua',共同:'together'}[owner],date,category,note:'',revision:1,createdAt:''});
const entries=[make('1','income',10000,'青','2026-10-01'),make('2','income',20000,'华','2026-10-02'),make('3','expense',6000,'共同','2026-10-03'),make('4','expense',1000,'青','2026-09-30')];
const s=totals(entries,'2026-10',50000);assert.equal(s.balance,73000);assert.equal(s.income,30000);assert.equal(s.expense,6000);assert.equal(s.surplus,24000);assert.equal(s.byOwner.reduce((n,o)=>n+o.expense,0),6000);
assert.equal(totals(entries,'2026-11',50000).balance,s.balance);assert.equal(totals(entries,'2026-11',50000).surplus,0);
assert.equal(totals(entries.filter(e=>e.id!=='3'),'2026-10',50000).balance,79000);
assert.equal(totals(entries.map(e=>e.id==='3'?{...e,amount:7000}:e),'2026-10',50000).expense,7000);
assert.equal(totals([],'2026-10',50000).income,0);
const dailyEntries=[
 make('d1','income',10001,'青','2026-10-31'),
 make('d2','expense',1,'共同','2026-10-01'),
 make('d3','expense',10,'华','2026-10-31'),
 make('d4','income',2,'华','2026-10-31'),
 make('d5','expense',1,'华','2026-10-31'),
 make('d6','expense',999,'华','2026-09-30'),
 make('d7','income',999,'华','2026-11-01'),
];
const snapshot=JSON.stringify(dailyEntries);
assert.deepEqual(dailyTotals(dailyEntries,'2026-10'),[
 {date:'2026-10-01',income:0,expense:1,surplus:-1,count:1},
 {date:'2026-10-31',income:10003,expense:11,surplus:9992,count:4},
]);
assert.deepEqual(dailyTotals(dailyEntries,'2026-10',{owner:'华',type:'expense'}),[
 {date:'2026-10-31',income:0,expense:11,surplus:-11,count:2},
]);
assert.deepEqual(dailyTotals(dailyEntries,'2026-10',{owner:'华'}),[
 {date:'2026-10-31',income:2,expense:11,surplus:-9,count:3},
]);
assert.deepEqual(dailyTotals(dailyEntries,'2026-10',{ownerKey:'hua'}),dailyTotals(dailyEntries,'2026-10',{owner:'华'}));
assert.deepEqual(dailyTotals(dailyEntries,'2026-10',{ownerKey:'together'}),dailyTotals(dailyEntries,'2026-10',{owner:'共同'}));
assert.deepEqual(dailyTotals(dailyEntries,'2026-10',{type:'income'}),[
 {date:'2026-10-31',income:10003,expense:0,surplus:10003,count:2},
]);
assert.deepEqual(dailyTotals(dailyEntries,'2026-10',{type:'all',owner:'全部'}),dailyTotals(dailyEntries,'2026-10'));
assert.deepEqual(dailyTotals(dailyEntries,'2026-10',{type:'income',owner:'共同'}),[]);
assert.deepEqual(dailyTotals(dailyEntries,'2026-12'),[]);
assert.deepEqual(dailyTotals([],'2026-10'),[]);
assert.equal(JSON.stringify(dailyEntries),snapshot);
const catEntries=[make('c1','expense',100,'青','2026-10-05','餐饮'),make('c2','expense',200,'青','2026-10-05','交通'),make('c3','income',300,'青','2026-10-05','工资')];
assert.deepEqual(dailyTotals(catEntries,'2026-10',{category:'餐饮'}),[{date:'2026-10-05',income:0,expense:100,surplus:-100,count:1}]);
assert.deepEqual(dailyTotals(catEntries,'2026-10',{type:'income',category:'工资'}),[{date:'2026-10-05',income:300,expense:0,surplus:300,count:1}]);
assert.equal(validateEntry({...entries[0],category:'工资'},'2026-10-31').category,'工资');
assert.throws(()=>validateEntry({...entries[0],category:'餐饮'},'2026-10-31'));
assert.throws(()=>validateEntry({...entries[0],category:''},'2026-10-31'));
assert.throws(()=>validateEntry({...entries[0],date:'2026-02-30'},'2026-10-31'));
assert.throws(()=>validateEntry({...entries[0],date:'2026-11-01'},'2026-10-31'));
assert.throws(()=>validateEntry({...entries[0],ownerKey:''},'2026-10-31'));
assert.throws(()=>validateEntry({...entries[0],ownerKey:'other'},'2026-10-31'));
assert.throws(()=>validateEntry({...entries[0],amount:1.5},'2026-10-31'));
assert.equal(validateEntry({...entries[0],date:'2024-02-29'},'2026-10-31').date,'2024-02-29');
console.log('PASS: 金额精度、北京时间跨月、累计余额、归属去重、编辑删除重算、期初存款隔离、按天汇总/组合筛选/排序、收支分类校验/筛选、整数分精度、非法输入验证');
