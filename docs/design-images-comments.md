# 收支记录图片与评论 — 设计方案 v3

> 状态：第三版（两轮评审后的方向调整），待用户确认
> 项目：两人账本 together-ledger

## 0. 为什么从 v2 改成 v3

两轮评审都判 `revise`。v2 的「图片 id 写进记录行 JSON」确实解决了「先改记录再挂图」的中间态，但评审又指出：
图片引用是跨行条件，校验与写入之间仍有竞态（两个请求可同时占用同一草稿；GC 可在校验后、写入前删行），
要补齐就得引入 claim/独占引用/原子校验等机制，复杂度和收益不成比例。

**v3 换掉「草稿 + 挂载」这个前提**：图片是独立附件，**上传时就绑定到记录/评论**。
这样没有草稿、没有挂载、没有跨行引用条件，评审指出的那几类竞态在结构上不存在。

| v2 的问题 | v3 的处理 |
|---|---|
| 草稿校验与挂载之间的竞态 | 不存在草稿：INSERT 时 `entry_id`/`comment_id` 已确定，单条语句原子 |
| 挂载失败导致记录已改、图没对齐 | 图片不进记录行；记录写入与图片写入互不依赖 |
| 删除时先删行后读图片清单（顺序错误） | 先读图片清单 → 再删除 → 再入队，见 §4.3 |
| 带图重试幂等 | 图片独立上传，客户端生成 media id，`ON CONFLICT DO NOTHING` |
| 草稿 24h GC 的边界条件 | 不需要草稿 GC，只剩「删除队列」与「孤儿对象」 |
| entries 加 JSON 列、迁移非幂等 | 旧表完全不动，迁移只有 `CREATE TABLE IF NOT EXISTS`，可重复执行 |

代价：新建记录时，图片在**记录保存成功之后**才上传（几秒内完成，有进度条）。这是 v3 最重要的产品取舍，见 §10.2。

## 1. 目标与非目标

### 目标

1. 记收入 / 支出时（新建或编辑）可附图片，图片随记录删除。
2. 每条记录可评论，评论支持文字 + 图片。
3. 今天页 / 日历 / 明细能看出记录有图、有几条评论。
4. 点开记录能看大图和评论，并继续评论。
5. 移动端可用：相册 / 相机选图、压缩上传、左右翻看大图。

### 非目标

- 实时推送（沿用 20s 轮询 + 聚焦刷新）、未读提醒。
- AI 识图、OCR、导出、公开分享链接、保留原图。
- 评论编辑（只支持发表与删除）、富文本。
- 图片重排（按上传时间排序，第一张为封面）。

## 2. 数据模型

旧表一律不改。

```sql
-- 一张图一行；entry_id / comment_id 恰好一个非空（上传时即确定）
CREATE TABLE media (
  id          TEXT PRIMARY KEY,                 -- 客户端生成 UUID，上传幂等键
  entry_id    TEXT REFERENCES entries(id)  ON DELETE CASCADE,
  comment_id  TEXT REFERENCES comments(id) ON DELETE CASCADE,
  storage     TEXT NOT NULL,                    -- 'r2' | 'd1'（逐行记录）
  mime        TEXT NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  bytes       INTEGER NOT NULL,
  thumb_mime  TEXT,                             -- 缩略图恒为 image/jpeg，没有则 NULL
  thumb_bytes INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  CHECK ((entry_id IS NOT NULL) <> (comment_id IS NOT NULL)),
  CHECK (storage IN ('r2','d1')),
  CHECK (thumb_mime IS NULL OR thumb_mime = 'image/jpeg')
);
CREATE INDEX media_entry_idx   ON media(entry_id);
CREATE INDEX media_comment_idx ON media(comment_id);
CREATE INDEX media_created_idx ON media(created_at);

CREATE TABLE comments (
  id         TEXT PRIMARY KEY,                  -- 客户端生成 UUID，发送幂等键
  entry_id   TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  body       TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX comments_entry_idx ON comments(entry_id, created_at);

-- 对象删除队列（持久重试）；重复入队用 INSERT OR IGNORE
CREATE TABLE media_deletions (
  media_id        TEXT NOT NULL,
  variant         TEXT NOT NULL,                -- full | thumb
  storage         TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  PRIMARY KEY (media_id, variant)
);

-- 低频维护用的状态行（现有 settings 表没有时间列，不动它）
CREATE TABLE media_state (
  id            TEXT PRIMARY KEY,               -- 固定 'drain'
  last_drain_at TEXT NOT NULL
);

-- 仅 D1 兜底模式使用
CREATE TABLE media_blobs (
  media_id TEXT NOT NULL,
  variant  TEXT NOT NULL,
  data     BLOB NOT NULL,
  PRIMARY KEY (media_id, variant)
);
```

约束与配额：

| 项 | 值 |
|---|---|
| 每条记录图片 | 9（上传时校验该 entry 现有数量） |
| 每条评论图片 | 3 |
| 评论正文 | 300 字（按码点） |
| 原图 | R2 ≤ 2 MB；D1 兜底 ≤ 700 KB |
| 缩略图 | R2 ≤ 300 KB；D1 兜底 ≤ 120 KB |

D1 单行上限 1 MB（v1 写错，已修正）。

## 3. 上传：一次请求一张图

`POST /api/media`（multipart）：

| 字段 | 说明 |
|---|---|
| `id` | 客户端生成的 UUID；重试复用同一个 id |
| `target` | `entry` 或 `comment` |
| `targetId` | 记录 id 或评论 id，必须存在 |
| `width` / `height` | 图片尺寸（服务端以实际解码前校验为准） |
| `file` | 原图（压缩后） |
| `thumb` | 缩略图（可选） |

处理顺序（写序固定）：

1. 鉴权、校验字节数/魔数/尺寸（宽高 1–10000 的整数）、校验 target 存在。
2. **先查幂等**：`SELECT id, entry_id, comment_id, bytes FROM media WHERE id=?`
   - 已存在且 target 与字节数一致 → 直接返回 201（重试不重复写对象）；
   - 已存在但 target 或内容不一致 → `409 IMAGE_CONFLICT`，**不覆盖对象**。
3. `put` 对象（key 由 media id 决定）→ `media/{id}/original`、`media/{id}/thumb`。
4. 插入时**在同一条语句里判断数量上限**，避免并发各自通过计数检查：
   ```sql
   INSERT INTO media (id, entry_id, comment_id, ...)
   SELECT ?, ?, NULL, ...
   WHERE (SELECT COUNT(*) FROM media WHERE entry_id = ?) < 9
   ON CONFLICT(id) DO NOTHING
   ```
   - 插入 1 行 → 201；
   - 插入 0 行 → 再按 id 查一次：
     - 行已存在（并发同 id）→ 按第 2 步比较，一致返回 201、不一致 409；
     - 行不存在 → 到达上限 → 400 `IMAGE_LIMIT`；
     - 两种情况都尽力删除本次刚写的对象（避免覆盖别人的对象）。
   - 外键不满足（target 刚被删）→ 404 `TARGET_NOT_FOUND`，同样删对象。
   评论目标把 `entry_id` 换成 `comment_id`、上限换成 3。

失败窗口：对象已写、进程在 INSERT 前退出 → 遗留孤儿对象。影响仅是存储占用，不产生脏引用。
处理：异常路径尽力删除；另有低频清扫（见 §6）。

## 4. 写入与删除的原子边界

### 4.1 记录保存（单条语句）

- 新建：客户端生成 entry id 并随请求提交，`mode: 'create'`；`INSERT INTO entries (...) ON CONFLICT(id) DO NOTHING`，重试幂等。id 已存在且内容不同则 `409 ENTRY_CONFLICT`。
- 编辑：`mode: 'update'` + `revision`；`UPDATE ... WHERE id=? AND revision=?`，`changes=0` → `409 REVISION_CONFLICT`，什么都没写。
- 图片不在这个请求里，因此不存在「记录改了、图没对上」。

服务端据 `mode` 分支（现有代码用「有没有 id」判断，新协议显式区分；无 `mode` 的旧请求仍按「有 id 即更新」处理，向后兼容）。

### 4.2 评论（单条语句）

- 客户端在点「发送」时生成一次 id，重试/双击复用；`INSERT ... ON CONFLICT(id) DO NOTHING`。
- 先校验 entry 存在；不存在 → 404 `ENTRY_NOT_FOUND`（外键也会兜底）。
- 评论图片在上传时绑定 `comment_id`，与评论行互不依赖；上传失败只影响那几张图，评论本身已发出。

### 4.3 删除

- **删图片** `DELETE /api/media?id=`：读行（拿 storage）→ `batch([DELETE media, INSERT OR IGNORE media_deletions(2 行: full/thumb)])`。任何人可删（共享账本）。
- **删评论**：先读该评论的 media（`SELECT id, storage FROM media WHERE comment_id=?`）→ `batch([DELETE comments, INSERT OR IGNORE media_deletions...])`（media 行由外键级联）。
- **删记录**：先读该记录及其所有评论的 media 清单 → `batch([DELETE entries WHERE id=? AND revision=?, INSERT OR IGNORE media_deletions...])`。
  - `changes=0`（revision 不匹配）→ 整个 batch 里没有可入队的对象（清单是在确认 revision 后才写），返回 409；实现上先确认 revision，再组 batch。
  - 读清单后、删除前若有并发上传：该 media 行会被级联删除但不在清单里 → 遗留孤儿对象；由清扫兜底（见 §6.3），不产生可见错误。

> 说明：列表/详情删除后，`GET /api/media` 因 media 行已删而立刻 404；对象删除是队列里的后续动作。

### 4.4 并发

- 记录编辑：revision 乐观锁（现有机制）。
- 评论：按 id 幂等，重复发送只有一条。
- 图片：media id 幂等；每个目标有数量上限，超限在上传时拒绝。
- 两个成员可同时给同一条记录加图：各自独立的 media 行，互不影响。

## 5. 存储：R2 为主，D1 兜底

- 绑定 `BUCKET`（`.openai/hosting.json` 改 `"r2": "BUCKET"`）。
- Key：`media/{id}/original`、`media/{id}/thumb`。
- **新上传写哪 = 当前有没有 `BUCKET` 绑定**（有 → r2，没有 → d1），并逐行记进 `media.storage`。
  - 不引入自定义环境变量（`hosting.json` 只认 `d1`/`r2`，注入方式未经验证，避免伪造一个不存在的回滚开关）。
  - 回滚：**不要解绑 R2**。要停用图片存储时，保留绑定、用 D1 兜底并无必要；旧 R2 行继续可读。
  - 万不得已解绑：旧 `storage='r2'` 行返回 `503 MEDIA_UNAVAILABLE`，对象仍在 bucket 里，恢复绑定即恢复。数据不丢，只是暂时读不到。
- 读取/删除**永远按行内 `storage`**，所以「先用 D1、后来开 R2」也安全：旧行走 D1，新行走 R2，无需迁移脚本。
- 上限按写入时的后端：r2 → 2 MB / 300 KB；d1 → 700 KB / 120 KB；随 `GET /api/ledger` 的 `mediaLimits` 返回。

## 6. 读取、缓存与清理

### 6.1 `GET /api/media?id=&v=thumb|full`

1. `readSession()`，未登录 401。
2. 查 media 行，没有 → 404（记录/评论删除后立刻 404）。
3. 按行内 `storage` 读字节；`r2` 但无绑定 → 503 `MEDIA_UNAVAILABLE`；对象不存在 → 404。
4. 响应头：
   - `Content-Type`：full 用 `mime`，thumb 用 `thumb_mime`（缺省回退原图与 `mime`）；
   - `ETag: "{id}-{variant}-{bytes}"`；
   - `Cache-Control: private, max-age=0, must-revalidate`（每次访问先鉴权 + 查行，命中才 304）；
   - `X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'`、`Content-Disposition: inline`。

### 6.2 删除队列

- 删除 media 行与写 `media_deletions` 放在**同一个 `db.batch()`**（D1 batch 有事务语义），避免「行删了、队列没写」。
- `storage='d1'` 的行不需要队列：同一个 batch 里直接删 `media_blobs`，DB 与字节一起走。
- 读清单（给记录/评论级联删除用）发生在 batch 之前；这毫秒级窗口内并发上传的新图会随级联删除但不在队列里，遗留孤儿对象，由 §6.3 兜底，不产生可见错误。
- `INSERT OR IGNORE INTO media_deletions`，重复删除不会撞主键。
- drain 单条前再查一次 `SELECT 1 FROM media WHERE id=?`：行已重新出现（同 id 被重新上传）就跳过并出队，避免把新对象删掉。
- drain 时机：任何写请求（上传 / 保存 / 评论）之后，以及 `GET /api/ledger` 的**每小时最多一次**（用 `media_state.last_drain_at` 记录，不动现有 `settings` 表）。
- 每次最多处理 20 条：成功或对象已不存在 → 出队；失败 → `attempts+1`，按 1min / 5min / 30min / 2h 退避。
- 文档写明：队列是「最终一致」；接口层面的 404 由 media 行删除保证，立即可见。

### 6.3 孤儿对象清扫

- 上传异常路径尽力删除；进程中断会留下无 DB 行的对象。
- README 提供手动核对/清理命令；不承诺「对象永不残留」，也不做定时任务。
- 记录删除时「读清单后、删除前」的并发上传同理。

### 6.4 草稿

不存在草稿。取消表单、放弃上传都不会产生任何 media 行。

## 7. API

### 7.1 `GET /api/ledger`（扩展）

```ts
type MediaMeta = { id: string; width: number; height: number; bytes: number; thumbBytes: number };
type Comment = { id: string; entryId: string; body: string; createdBy: OwnerKey; createdAt: string; images: MediaMeta[] };
type Entry = { ...现有字段; images: MediaMeta[]; comments: Comment[] };

mediaLimits: { mode: 'r2' | 'd1'; maxBytes: number; maxThumbBytes: number; maxPerEntry: number; maxPerComment: number };
```

- 一次读 entries、comments、media（仅元数据列），内存按 `entry_id` / `comment_id` 分组，图片按 `created_at, id` 排序。
- 引用不到的 media 行不会出现（直接按外键查）。
- 评论按 `created_at` 升序。

### 7.2 `POST /api/ledger`

| action | body | 说明 |
|---|---|---|
| `save` | 现有字段 + `mode: 'create'|'update'` + 新建时的 `id` | §4.1 |
| `delete` | 现有字段 | §4.3 |
| `comment-add` | `{ comment: { id, entryId, body } }` | §4.2（图片另走上传） |
| `comment-delete` | `{ id }` | §4.3 |

### 7.3 `POST /api/media` / `DELETE /api/media` / `GET /api/media`

见 §3、§4.3、§6.1。

### 7.4 错误码（前后端共用一份常量）

| HTTP | code | 场景 |
|---|---|---|
| 400 | `IMAGE_LIMIT` | 目标图片数超上限 |
| 400 | `COMMENT_INVALID` | 空评论 / 正文超长 |
| 400 | `ENTRY_INVALID` | 金额、日期等字段非法 |
| 404 | `TARGET_NOT_FOUND` | 上传/删除时目标记录或评论不存在 |
| 404 | `ENTRY_NOT_FOUND` | 评论的目标记录不存在 |
| 409 | `REVISION_CONFLICT` | 记录被别人改过 |
| 409 | `ENTRY_CONFLICT` | 新建的 id 已存在且内容不同 |
| 413 | `IMAGE_TOO_LARGE` | 超过当前模式上限 |
| 415 | `IMAGE_UNSUPPORTED` | 非 JPEG/PNG/WebP 或魔数不符 |
| 503 | `MEDIA_UNAVAILABLE` | 行内 storage=r2 但当前没有绑定 |

错误响应统一 `{ error, code }`。

## 8. 客户端图片处理

- 解码：`createImageBitmap(file, { imageOrientation: 'from-image' })`，失败回退 `new Image()`（覆盖 iOS HEIC），都失败给「这张图片无法处理，请改用 JPG / PNG / WebP」。
- 原图：最长边 1600，JPEG q0.82 起步；按 `mediaLimits.maxBytes` 迭代（质量 0.82/0.74/0.66/0.6，再缩尺寸 ×0.8，最多 4 轮），仍超 → 提示换图。
- 缩略图：最长边 480，JPEG q0.75（恒 JPEG，服务端只接受 JPEG 缩略图）。
- canvas 重绘去 EXIF（含 GPS）；PNG 透明填白底。
- 源文件 > 25 MB 直接拒绝（避免手机内存问题）。
- 上传并发 2；每张显示进度 / 失败重试。

## 9. 前端交互

### 9.1 记录详情（新弹层）

点明细 / 日历 / 今天里的记录 → 详情：

- 顶部：类型图标 + 金额、备注、日期 / 归属 / 分类 / 谁记的；
- 图片：3 列方形网格，点开大图；「添加照片」入口；
- 评论：头像 + 名字 + 相对时间 + 正文 + 图片缩略图；输入框 + 选图（≤3）+ 发送；
- 底部：编辑、删除、关闭；
- 复用原生 `<dialog>` + `useSheetDrag` 与现有动效。

> 交互改动：现在是点行直接编辑。**待确认**。

### 9.2 新建 / 编辑表单

- **新建**：备注下方「照片（选填，最多 9 张）」，选图后仅本地预览；**保存成功后才开始上传**。
  - 保存 → 关闭表单 → 打开该记录详情 → 逐张上传（进度 / 失败重试 / 可删除）。
  - 上传失败不影响记录本身；关掉详情会中止该批上传，需要重新添加（已写好的行保留）。
- **编辑**：表单里不再放图片区；**图片只在详情里管理**，增删即时生效，不参与「保存修改」。
  - 避免「表单里选图，取消保存后到底生不生效」的歧义。
- 上传队列挂在页面级（`app/page.tsx` 的 state），关闭详情不取消已在进行的上传。

这是 v3 的核心取舍：**记录先落库，图片后传**。好处是记录与图片互不阻塞、没有草稿与挂载竞态；代价是「保存后几秒内图片才齐」。

### 9.3 列表标识

行副标题追加 `📷 n`、`💬 n`；无则不显示。

### 9.4 大图查看器

- 全屏 `<dialog>`，深色底，`object-fit: contain`；
- 横向 `overflow-x` + `scroll-snap`，容器 `touch-action: auto`（允许横向平移，也保留纵向滚动与双指缩放）；
- 右上关闭、Esc、底部「2 / 5」。

### 9.5 组件

`components/photo-picker.tsx`、`photo-grid.tsx`、`photo-viewer.tsx`、`entry-detail.tsx`、`comment-thread.tsx`、`lib/image-client.ts`。

## 10. 安全与隐私

- 媒体接口全部要求登录；对象 key 用 UUID；无公开链接。
- 魔数白名单 + `nosniff` + CSP，拒绝 SVG/GIF；缩略图只收 JPEG。
- 重绘去 EXIF。
- 删除 media 行后接口立刻 404；对象由队列最终删除。

## 11. 兼容、迁移与回滚

- 迁移 `0006_media_comments.sql`：**只有 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`**，可重复执行，不动旧表。
- 上线前 `wrangler d1 export` 备份。
- 旧代码回滚：旧代码不读新表，功能回到「无图无评论」，数据完整保留；重新部署新代码即恢复。
  - 旧代码删除记录时不会读 media 清单，级联删掉 media 行后对象会残留 → 回滚期间尽量不删记录，残留对象按 README 手动清理。
  - 旧后端不认识 `mode:'create'`，会按「有 id 即更新」处理并 409 → 回滚窗口内可能无法新建记录；回滚应短时进行，或同时要求客户端刷新。
- 不做 down migration。
- README 写明：R2 模式图片不在 D1 备份里，bucket 需单独备份；D1 兜底模式备份会变大。

## 12. 验收

### 功能

1. 新建记录选 3 张图 → 保存 → 详情里图片陆续出现；今天/日历/明细徽标正确。
2. 上传中关掉页面再打开 → 已上传的图在，未上传的需要重新添加（不产生脏数据）。
3. 编辑记录加图、删图：即时生效，刷新后一致。
4. 删除记录：评论区、图片接口立刻 404；对象队列在后续写入中清空。
5. 评论：文字 / 文字+图；空评论拒绝；>3 张拒绝；双击只产生一条。
6. 未登录访问 `/api/media`、`/api/ledger` → 401。
7. 非法文件（SVG、文本改后缀、超大）→ 415 / 413，提示可读。
8. 移动端 iOS Safari / Android Chrome：相册、HEIC、上传、横滑、双指缩放。

### 故障与并发

9. 上传响应丢失后重试同一 media id → 仍只有一张图。
10. 评论响应丢失后重试同一 comment id → 仍只有一条。
11. 两个请求同时上传第 10 张图 → 至多一张成功（数量校验 + 后写者 400）。
12. 删记录与并发上传：不产生可见错误，最多遗留孤儿对象（由清扫/README 说明）。
13. 对象删除失败（模拟）→ 队列保留，后续写入重试成功。
14. 存储后端混用：先用 D1（不绑 BUCKET）传图，再启用 R2 传新图 → 旧图仍从 D1 正常读取；全程不解绑 R2。
15. D1 模式：跑通上传 / 读取 / 删除 / 重启持久化，含接近 700 KB 的图。

### 自动化

- `pnpm exec tsc --noEmit`
- `node scripts/verify-ledger.mjs`：魔数、图片数量与格式校验、评论校验、错误码映射、排序
- `pnpm run build`
- 本地 wrangler 全流程 + 重启持久化

## 13. 风险与已知限制

| 风险 | 说明 | 对策 |
|---|---|---|
| 生产是否自动开通 R2 | 未确证 | 无 BUCKET 自动落 D1；上线前实测 |
| 保存后图片才上传 | 用户可能马上关页面 | 详情页显示上传进度；失败可重试；不做跨会话续传 |
| 孤儿对象 | 进程中断导致 | 尽力删除 + 文档说明 + 后续可加定时清扫 |
| 删除队列最终一致 | 非立即清空 | 接口 404 立即可见；队列带退避重试 |
| 20s 轮询 | 对方评论最多 20s 后出现 | 写操作返回全量；本人立即看到 |
| 全量评论体积 | 轮询变大 | 验收时测 200 条记录 / 1000 条评论的体积与耗时，超阈值再分页 |
| EXIF 只在客户端去除 | 直接调 API 上传可保留 EXIF | 明确为「官方客户端保证」；不宣称服务端隐私保证 |
| HEIC 依赖浏览器解码 | iOS Safari 可能仍失败 | 双重解码尝试 + 明确错误提示；真机验收 |
| 旧代码回滚 | 旧代码删除记录不走队列，R2 对象可能残留 | 回滚前先停用图片功能；残留对象按 README 手动清理；不做 down migration |

## 14. 实施拆分与文件清单

### 阶段一：数据与接口

- `db/schema.ts`：`media` / `comments` / `media_deletions` / `media_state` / `media_blobs`
- `drizzle/0006_media_comments.sql`
- `lib/media.ts`：常量、错误码、魔数嗅探、校验（纯函数，可测）
- `lib/media-store.ts`：按行 storage 读写 + 删除队列 drain
- `app/api/media/route.ts`：POST / GET / DELETE
- `app/api/ledger/route.ts`：GET 拼装；save 增加 mode；comment-add / comment-delete；delete 级联清理
- `scripts/verify-ledger.mjs`

### 阶段二：前端

- `lib/image-client.ts`、`components/photo-*.tsx`、`components/entry-detail.tsx`、`components/comment-thread.tsx`
- `app/page.tsx`、`app/globals.css`

### 阶段三：配置与文档

- `.openai/hosting.json`（`"r2": "BUCKET"`）
- `README.md`

### 只读，不得改动

- `lib/auth.ts`、`lib/auth-server.ts`、`app/api/auth/route.ts`、`components/login-screen.tsx`
- `components/ui/**`

## 15. 已确认决策（2026-11-06）

1. **交互**：点记录先看详情（图片 + 评论），详情里再编辑。
2. **上传时机**：记录先保存、图片随后自动上传（v3 方案，无草稿、无挂载竞态）。
3. **存储**：R2 为主，无 BUCKET 绑定时自动落 D1。
4. **评论删除**：双方都能删。
5. **上限**：记录 9 张 / 评论 3 张 / 压缩后上传。

以上为实施依据；后续实现如与本方案冲突，以本方案为准。
