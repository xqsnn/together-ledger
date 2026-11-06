# 两人账本

两个人共用一本日常账本，每天记录收入、支出与青 / 华 / 共同三类归属。米白与鼠尾草绿界面，支持电脑和手机。

## 已实现

- 登录：青、华各自一个密码，登录态存在 HttpOnly Cookie 里，有效期 180 天并在每次访问时滑动续期，常用设备不需要反复登录。「共同」是记账归属而非账号，因此不参与登录。
- 首个账号可在首次访问时直接认领；第二位成员需要已登录的一方在设置页生成一次性邀请码（24 小时有效）。改密码会作废其它设备上的登录态。
- 收入、支出录入，人民币金额最多两位小数。归属默认按当前登录身份预选，仍可手动改成对方或「共同」；每条记录额外保存「谁记的这笔」，代记时会在明细里标出。
- 可记录发生时间（北京时间，默认当前时刻，补记历史日期时默认 12:00）；首页「今天的记录」显示时间和归属头像、按发生时刻倒序，今日卡片下方按归属拆分当天金额。
- 分类可在设置中增删改；默认支出为餐饮、交通、购物、居住、日用、娱乐、医疗、人情、旅行、其他，收入为工资、生活费、理财、意外所得、其他。改名会同步已有记录；删除会提示存量记录数，并将这些记录归入「其他」或剩余的第一个分类。
- 日期默认北京时间的今天，可补记历史记录，不接受未来日期；今天的时间不能晚于当前时刻。
- 顶部统一显示当前日期、星期和存款，所有页面可见。
- 今天：快捷记收入或支出，查看今日收入、支出和当天明细。
- 账目：从首页「查看日历」进入；月历和按日分组明细，支持月份、归属、收支、分类组合筛选；日历页只展示月历，当天汇总和明细在「明细」页展示。
- 分析：“月度收支”按月份和归属看收入、支出、当月盈余、最高支出日及按天趋势，可展开每日数据并跳转到当天账目；底部按分类展示当月收入、支出占比。
- 设置：可为青、华、共同上传圆形头像（带归属色描边）并修改名字，头像和名字同步用于记账表单和分析页；可增删改收支分类；共享账本入口。
- 按月份、归属、收支、分类组合筛选，编辑、删除和同步重算。
- 云端 D1 持久化，每 20 秒及重新聚焦页面时刷新。
- 编辑 / 删除具有版本冲突检查。
- 记一笔时可附图片（每条最多 9 张）：记录先保存，图片随后逐张上传并显示进度。点记录会进入独立的详情页（`/entries/:id`）：图片放在最上方、可左右滑动切换（带 1/3 计数），点开全屏后也能滑动，并可在全屏里删除图片；金额、日期、分类、归属、记录人依次排在图片下面。
- 每条记录可评论，样式参考小红书：头像、名字、时间、作者标识，支持点赞、两级回复、最新/最热排序，评论区底部固定输入条，可带最多 3 张图；双方都能删除评论。记录行会显示图片数和评论数徽标。
- 记录详情页支持编辑（`/entries/:id/edit`）和删除；编辑不再用弹窗。

## 技术栈

React 19、TypeScript、Vinext、Vite、Cloudflare Workers / D1、Drizzle、Lucide。

## 运行

要求 Node.js >= 22.13.0，以及 pnpm（版本见 package.json 的 packageManager）。

```bash
pnpm install
pnpm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_flippant_grey_gargoyle.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_loving_vertigo.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_sudden_pretty_boy.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_yummy_corsair.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_owner_keys.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0005_entry_time.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0005_login.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0006_media_comments.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0007_ordinary_bloodstrike.sql
pnpm run dev
```

本地迁移仅首次运行或增加迁移时执行（0000 建表，0001 增加分类字段，0002 增加头像表，0003 增加动态分类和归属名字表，0004 将账目和头像的归属迁移为稳定的 owner key，0005_entry_time 增加账目发生时间，0005_login 增加登录用的 accounts / sessions / join_codes 表与 entries.created_by，0006 增加图片/评论相关的 comments / media / media_deletions / media_state / media_blobs 表，0007 给评论增加 parent_id / reply_to_owner 并新增 comment_likes 表）；线上 D1 需要执行对应迁移时，去掉 `--local` 并加上 `--remote`。注意 0005_entry_time、0005_login 与 0007 包含 `ALTER TABLE ADD COLUMN`，不是幂等的，只需执行一次；0006 只新增表与索引，可重复执行。开发地址以命令输出为准。部署到其他平台需要提供兼容的 Cloudflare Workers 运行环境和 D1 绑定，不能仅部署为静态网页。

## 图片与评论存储

- 图片对象优先写入 R2 的 `BUCKET` 绑定；没有绑定 BUCKET 时自动存入 D1 的 `media_blobs`，此时单张原图上限 700 KB、缩略图上限 120 KB（R2 模式为 2 MB / 300 KB）。
- 读取和删除按 `media` 行记录的 `storage` 执行，所以「先 D1、后启用 R2」不会影响旧图；不要通过解绑 R2 来回滚，否则旧的 R2 图片会暂时返回 503。
- R2 模式下图片不在 D1 备份里，需要单独备份 bucket。D1 兜底模式的数据库备份会包含图片字节。
- 已知限制：进程中断等极端情况可能残留没有 `media` 行的孤儿对象；删除队列是最终一致的，接口层的 404 会立即生效；HEIC 能否解码取决于浏览器，失败时会提示改用 JPG / PNG / WebP。

## 检查

```bash
pnpm exec tsc --noEmit
node scripts/verify-ledger.mjs
pnpm run build
```

验证覆盖金额精度、北京时间跨月、累计余额、归属去重、编辑删除重算、按天汇总、组合筛选、日期排序、分类校验及非法输入，登录密码派生与校验、会话过期与滑动续期、长期 Cookie 属性、邀请码生成与规范化、Cookie 解析，以及图片魔数识别、缩略图 JPEG 校验、评论正文码点长度、媒体 id 白名单、错误码状态映射与对象 key。

## 计算口径

金额在数据库中以整数分保存。

- 存款 = 全部收入 - 全部支出，不受月份和归属筛选影响。
- 月度收入 / 支出按发生日期的北京时间自然月统计。
- 月度盈余 = 当月收入 - 当月支出。
- 共同类记录仅计入一次。
- 日均支出 = 已录入的当月支出 ÷ 当月自然日数；当前月份仅取截至今天的天数。
- 有记录天数仅统计实际存在账目的日期，不表示这些日期已完整记账；没有记录也不代表没有收支。
- 日历的收支和归属筛选同步影响日期标记、当天摘要及明细。仅筛选收入或支出时，不展示容易误解的完整日结余。
- 分析使用独立的月份和归属筛选，趋势轴保留连续日期；未来日期不能选择或新增记录。

## 访问与数据

本项目是一份共享账本：登录后所有人看到同一套记录，登录只用来区分「谁在记账」，不划分数据可见范围。

- 账号：`accounts` 表，只有青、华两条；密码用 PBKDF2-SHA256（默认 10 万次迭代）加随机盐派生，不存明文。
- 登录态：`sessions` 表只存令牌的 SHA-256，浏览器侧是 `HttpOnly` + `SameSite=Lax` 的 Cookie，HTTPS 下自动加 `Secure`。
- 防爆破：同一身份连续输错 5 次密码锁定 15 分钟；邀请码 24 小时过期，最多尝试 10 次。
- 权限：两个人共享一本账，互相可以编辑和删除对方的记录；`entries.created_by` 记录是谁记的这一笔，用于展示而非限制。
- 邀请码：第二位成员首次设置密码时，需要已登录的一方在设置页生成一次性邀请码，避免任何人打开页面就能认领身份。

`.openai/hosting.json` 保留原 Sites 项目标识；只有维护原站点时才沿用，创建独立部署时请按新环境重新配置。推送代码到 GitHub 本身不会另行部署网站，也不会解除 chatgpt.site 的入口拦截。
