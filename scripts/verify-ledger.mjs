import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../lib/ledger.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {totals,dailyTotals,dayOwnerTotals,byWhenDesc,toCents,chinaToday,chinaTime,chinaStamp,isValidTime,validateEntry}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
assert.equal(toCents('0.01'),1);assert.equal(toCents('1.10'),110);assert.equal(toCents('0',true),0);
for(const n of ['0','-1','1.234','1e2','NaN'])assert.throws(()=>toCents(n));
assert.equal(chinaToday(new Date('2026-10-31T16:00:00Z')),'2026-11-01');
assert.equal(chinaToday(new Date('2026-10-31T15:59:59Z')),'2026-10-31');
const make=(id,type,amount,owner,date,category='其他',time='')=>({id,type,amount,owner,ownerKey:{青:'qing',华:'hua',共同:'together'}[owner],date,time,category,note:'',revision:1,createdAt:''});
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
const ownerName=key=>({qing:'青',hua:'华',together:'共同'}[key]);
assert.deepEqual(dayOwnerTotals(dailyEntries,'2026-10-31',ownerName),[
 {key:'qing',owner:'青',income:10001,expense:0,count:1},
 {key:'hua',owner:'华',income:2,expense:11,count:3},
 {key:'together',owner:'共同',income:0,expense:0,count:0},
]);
assert.deepEqual(dayOwnerTotals(dailyEntries,'2026-10-01',ownerName).map(o=>o.expense),[0,0,1]);
assert.deepEqual(dayOwnerTotals(dailyEntries,'2026-09-30',ownerName).map(o=>o.expense),[0,999,0]);
assert.deepEqual(dayOwnerTotals(dailyEntries,'2026-10-31',ownerName).reduce((n,o)=>n+o.income+o.expense,0),10014);
assert.deepEqual(dayOwnerTotals([],'2026-10-31',ownerName).map(o=>o.count),[0,0,0]);
assert.equal(JSON.stringify(dailyEntries),snapshot);
// 发生时间：北京时间 HH:mm
assert.equal(chinaTime(new Date('2026-10-31T15:59:00Z')),'23:59');
assert.equal(chinaTime(new Date('2026-10-31T16:00:00Z')),'00:00');
assert.deepEqual(chinaStamp('2026-11-03T15:30:00Z'),{date:'2026-11-03',time:'23:30'});
assert.deepEqual(chinaStamp('2026-11-03T16:05:00Z'),{date:'2026-11-04',time:'00:05'});
assert.equal(chinaStamp('not-a-date'),null);
for(const ok of ['00:00','09:05','23:59'])assert.equal(isValidTime(ok),true);
for(const bad of ['24:00','9:05','12:60','12','',null,undefined,1205])assert.equal(isValidTime(bad),false);
assert.equal(validateEntry({...entries[0],date:'2026-10-31',time:'08:30'},'2026-10-31').time,'08:30');
assert.equal(validateEntry({...entries[0],date:'2026-10-31',time:''},'2026-10-31').time,'');
assert.equal(validateEntry({...entries[0],date:'2026-10-31'},'2026-10-31').time,'');
assert.throws(()=>validateEntry({...entries[0],date:'2026-10-31',time:'25:00'},'2026-10-31'));
const whenEntries=[
 make('w1','expense',1,'青','2026-10-05','其他','09:10'),
 make('w2','expense',2,'华','2026-10-05','其他','20:30'),
 make('w3','expense',3,'共同','2026-10-05','其他',''),
 make('w4','expense',4,'青','2026-10-06','其他','07:00'),
];
assert.deepEqual(whenEntries.sort(byWhenDesc).map(e=>e.id),['w4','w2','w1','w3']);
assert.equal(JSON.stringify(whenEntries),JSON.stringify(whenEntries.sort(byWhenDesc)));
assert.equal(validateEntry({...entries[0],category:'工资'},'2026-10-31').category,'工资');
assert.throws(()=>validateEntry({...entries[0],category:'餐饮'},'2026-10-31'));
assert.throws(()=>validateEntry({...entries[0],category:''},'2026-10-31'));
assert.throws(()=>validateEntry({...entries[0],date:'2026-02-30'},'2026-10-31'));
assert.throws(()=>validateEntry({...entries[0],date:'2026-11-01'},'2026-10-31'));
assert.throws(()=>validateEntry({...entries[0],ownerKey:''},'2026-10-31'));
assert.throws(()=>validateEntry({...entries[0],ownerKey:'other'},'2026-10-31'));
assert.throws(()=>validateEntry({...entries[0],amount:1.5},'2026-10-31'));
assert.equal(validateEntry({...entries[0],date:'2024-02-29'},'2026-10-31').date,'2024-02-29');
// ---- 登录：密码派生、会话令牌、Cookie（与账本逻辑同一套断言脚本） ----
const authSource = await readFile(new URL('../lib/auth.ts', import.meta.url), 'utf8');
const authJs = ts.transpileModule(authSource, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const auth = await import('data:text/javascript;base64,' + Buffer.from(authJs).toString('base64'));

assert.deepEqual([...auth.hexToBytes('00ff0a')], [0, 255, 10]);
assert.equal(auth.bytesToHex(auth.hexToBytes('deadbeef')), 'deadbeef');
assert.throws(() => auth.hexToBytes('abc'));
assert.equal(auth.randomHex(8).length, 16);

// 迭代次数用低值加速测试，真实登录仍用默认 100000。
const record = await auth.createPasswordRecord('secret123', 1000);
assert.equal(record.iterations, 1000);
assert.equal(record.salt.length, 32);
assert.equal(record.hash.length, 64);
assert.equal(await auth.verifyPassword('secret123', record), true);
assert.equal(await auth.verifyPassword('secret124', record), false);
assert.equal(await auth.verifyPassword('', record), false);
// 同一密码两次派生应得到不同哈希（盐随机）。
const other = await auth.createPasswordRecord('secret123', 1000);
assert.notEqual(other.hash, record.hash);
assert.notEqual(other.salt, record.salt);

assert.equal(auth.passwordProblem('12345'), '密码至少 6 位');
assert.equal(auth.passwordProblem('123456'), null);
assert.equal(auth.passwordProblem('x'.repeat(65)), '密码最多 64 位');
assert.equal(auth.passwordProblem(123456), '请输入密码');
assert.equal(auth.passwordProblem(''), '请输入密码');

const now = new Date('2026-11-06T00:00:00Z');
const expiry = auth.sessionExpiry(now);
assert.equal(expiry, '2027-05-05T00:00:00.000Z');
assert.equal(auth.isSessionExpired(expiry, now), false);
assert.equal(auth.isSessionExpired(expiry, new Date('2027-05-05T00:00:00Z')), true);
assert.equal(auth.isSessionExpired('not-a-date', now), true);
// 刚登录时不需要续期；剩余 149 天时开始续期。
assert.equal(auth.sessionNeedsRenewal(expiry, now), false);
assert.equal(auth.sessionNeedsRenewal(expiry, new Date('2026-12-07T00:00:01Z')), true);
// 续期必须同时重发 Cookie：浏览器按自己那份 Max-Age 丢弃，只续数据库是没用的。
assert.equal(auth.renewalCookie(expiry, 'tok', true, now), null);
const renewedCookie = auth.renewalCookie(expiry, 'tok', true, new Date('2026-12-07T00:00:01Z'));
assert.match(renewedCookie, /^tl_session=tok/);
assert.match(renewedCookie, /Max-Age=15552000/);
assert.match(renewedCookie, /Secure/);
assert.doesNotMatch(auth.renewalCookie(expiry, 'tok', false, new Date('2026-12-07T00:00:01Z')), /Secure/);

const cookie = auth.sessionCookie('abc123', {secure: true});
assert.match(cookie, /^tl_session=abc123/);
assert.match(cookie, /HttpOnly/);
assert.match(cookie, /SameSite=Lax/);
assert.match(cookie, /Max-Age=15552000/); // 180 天
assert.match(cookie, /Secure/);
assert.doesNotMatch(auth.sessionCookie('abc123', {secure: false}), /Secure/);
assert.match(auth.clearSessionCookie(true), /Max-Age=0/);
assert.equal(auth.readCookie('a=1; tl_session=xyz; b=2', 'tl_session'), 'xyz');
assert.equal(auth.readCookie('a=1', 'tl_session'), null);
assert.equal(auth.readCookie(null, 'tl_session'), null);

assert.equal(auth.normalizeInviteCode(' ab-12 cd '), 'AB12CD');
assert.equal(auth.normalizeInviteCode(undefined), '');
const invite = auth.createInviteCode();
assert.equal(invite.length, 6);
assert.match(invite, /^[2-9A-HJ-NP-Z]{6}$/);
assert.equal(await auth.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
assert.equal(auth.isSecureRequest(new Request('https://example.com/api/auth')), true);
assert.equal(auth.isSecureRequest(new Request('http://127.0.0.1:3000/api/auth')), false);

// ---- 图片与评论：魔数、正文、id、错误码、对象 key（纯函数） ----
const mediaSource = await readFile(new URL('../lib/media.ts', import.meta.url), 'utf8');
const mediaJs = ts.transpileModule(mediaSource, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const media = await import('data:text/javascript;base64,' + Buffer.from(mediaJs).toString('base64'));

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
assert.equal(media.sniffImageMime(jpeg), 'image/jpeg');
assert.equal(media.sniffImageMime(png), 'image/png');
assert.equal(media.sniffImageMime(webp), 'image/webp');
assert.equal(media.sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38])), null);
assert.equal(media.sniffImageMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
assert.equal(media.sniffImageMime(new Uint8Array()), null);
assert.equal(media.sniffImageMime(new Uint8Array([0xff, 0xd8])), null);
assert.equal(media.isThumbJpeg(jpeg), true);
assert.equal(media.isThumbJpeg(png), false);

assert.equal(media.isValidId('123e4567-e89b-42d3-a456-426614174000'), true);
assert.equal(media.isValidId('0123456789abcdef0123456789abcdef'), true);
assert.equal(media.isValidId(''), false);
assert.equal(media.isValidId('a'.repeat(65)), false);
assert.equal(media.isValidId('../etc/passwd'), false);
assert.equal(media.isValidId('abc$def'), false);
assert.equal(media.isValidId(42), false);

assert.equal(media.normalizeCommentBody(' 你好 '), '你好');
assert.equal(media.normalizeCommentBody('a'.repeat(300)), 'a'.repeat(300));
assert.equal([...media.normalizeCommentBody('😀'.repeat(300))].length, 300);
assert.throws(() => media.normalizeCommentBody(''), (error) => error instanceof media.MediaError && error.code === 'COMMENT_INVALID');
assert.throws(() => media.normalizeCommentBody('   '), (error) => error.code === 'COMMENT_INVALID');
assert.throws(() => media.normalizeCommentBody('a'.repeat(301)), (error) => error.code === 'COMMENT_INVALID');
assert.throws(() => media.normalizeCommentBody('😀'.repeat(301)), (error) => error.code === 'COMMENT_INVALID');
assert.throws(() => media.normalizeCommentBody(42), (error) => error.code === 'COMMENT_INVALID');

const statuses = {
 IMAGE_LIMIT:400, IMAGE_INVALID:400, IMAGE_TOO_LARGE:413, IMAGE_UNSUPPORTED:415, IMAGE_CONFLICT:409,
 TARGET_NOT_FOUND:404, ENTRY_NOT_FOUND:404, REVISION_CONFLICT:409, ENTRY_CONFLICT:409,
 COMMENT_INVALID:400, MEDIA_UNAVAILABLE:503,
};
for (const [code, status] of Object.entries(statuses)) assert.equal(media.mediaErrorStatus(code), status, code);
const conflict = media.mediaError('IMAGE_CONFLICT', '重复');
assert.equal(conflict.code, 'IMAGE_CONFLICT');
assert.equal(conflict.status, 409);
assert.equal(conflict.message, '重复');
assert.equal(media.mediaObjectKey('abc', 'full'), 'media/abc/original');
assert.equal(media.mediaObjectKey('abc', 'thumb'), 'media/abc/thumb');
assert.equal(media.MAX_ENTRY_IMAGES, 9);
assert.equal(media.MAX_COMMENT_IMAGES, 3);
assert.equal(media.MAX_COMMENT_LENGTH, 300);
assert.deepEqual(media.MIME_TYPES, ['image/jpeg', 'image/png', 'image/webp']);
assert.deepEqual(media.IMAGE_LIMITS.r2, {maxBytes:2000000, maxThumbBytes:300000});
assert.deepEqual(media.IMAGE_LIMITS.d1, {maxBytes:700000, maxThumbBytes:120000});

console.log('PASS: 金额精度、北京时间跨月、累计余额、归属去重、编辑删除重算、期初存款隔离、北京时间时间戳与时间校验、按发生时刻排序、按天汇总/当天归属拆分(含零值补齐)/组合筛选/排序、收支分类校验/筛选、整数分精度、非法输入验证');
console.log('PASS: 登录密码派生/校验、会话过期与滑动续期、长期 Cookie 属性、邀请码生成与规范化、Cookie 解析、HTTPS 判定');
console.log('PASS: 图片魔数识别、缩略图 JPEG 校验、评论正文码点长度、媒体 id 白名单、错误码状态映射、对象 key');

