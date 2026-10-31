# 两人账本

两个人共用一本日常账本，每天记录收入、支出与青 / 华 / 共同三类归属。米白与鼠尾草绿界面，支持电脑和手机。

## 已实现

- 收入、支出录入，人民币金额最多两位小数，归属每次手动选择。
- 支出分类：餐饮、交通、购物、居住、日用、娱乐、医疗、人情、旅行、其他；收入分类：工资、生活费、理财、意外所得、其他。
- 日期默认北京时间的今天，可补记历史记录，不接受未来日期。
- 顶部统一显示当前日期、星期和存款，所有页面可见。
- 今天：快捷记收入或支出，查看今日收入、支出和当天明细。
- 账目：月历和按日分组明细，支持月份、归属、收支、分类组合筛选；点击日期看当天汇总，手机用收/支标记，完整金额在当天摘要中显示。
- 分析：“月度收支”按月份和归属看收入、支出、当月盈余、最高支出日及按天趋势，可展开每日数据并跳转到当天账目；底部按分类展示当月收入、支出占比。
- 设置：可为青、华、共同分别上传圆形头像（带归属色描边），头像同步用于记账表单和分析页；共享账本入口。
- 按月份、归属、收支、分类组合筛选，编辑、删除和同步重算。
- 云端 D1 持久化，每 20 秒及重新聚焦页面时刷新。
- 编辑 / 删除具有版本冲突检查。

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
pnpm run dev
```

本地迁移仅首次运行或增加迁移时执行（0000 建表，0001 增加分类字段，0002 增加头像表）；线上 D1 需要执行对应迁移时，去掉 `--local` 并加上 `--remote`。开发地址以命令输出为准。部署到其他平台需要提供兼容的 Cloudflare Workers 运行环境和 D1 绑定，不能仅部署为静态网页。

## 检查

```bash
pnpm exec tsc --noEmit
node scripts/verify-ledger.mjs
pnpm run build
```

验证覆盖金额精度、北京时间跨月、累计余额、归属去重、编辑删除重算、按天汇总、组合筛选、日期排序、分类校验及非法输入。

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

本项目是一份共享账本，所有获准访问者共享同一套记录。API 当前依赖 Sites 的私有访问边界，不提供独立的应用内账号和权限系统。保存真实账目前，必须将 Sites 访问设置限制为自己及明确邀请的人；如迁移到其他托管环境或公开提供页面，必须先实现服务端身份验证与账本授权，再允许读写 API。

仓库包含源代码、迁移结构与托管配置，不包含线上或本地数据库、依赖目录、构建产物及凭据。

`.openai/hosting.json` 保留原 Sites 项目标识；只有维护原站点时才沿用，创建独立部署时请按新环境重新配置。推送代码到 GitHub 本身不会另行部署网站，也不会解除 chatgpt.site 的入口拦截。
