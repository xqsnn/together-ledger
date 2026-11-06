import { sql } from 'drizzle-orm';
import { blob, check, index, integer, primaryKey, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
export const entries = sqliteTable('entries', {
 id: text('id').primaryKey(), type: text('type').notNull(), amount: integer('amount').notNull(),
 // 数据库列名沿用 owner，但存储稳定的归属 key（qing/hua/together），显示名从 owners 解析。
 ownerKey: text('owner').notNull(),
 // created_by 记录「谁登录着记的这笔」，与归属解耦：可以替对方代记，也可以两人一起记。
 createdBy: text('created_by'),
 date: text('date').notNull(), note: text('note').notNull().default(''), category: text('category').notNull().default('其他'),
 revision: integer('revision').notNull().default(1), createdAt: text('created_at').notNull(),
});
export const owners = sqliteTable('owners', {
 key: text('key').primaryKey(), name: text('name').notNull().unique(), position: integer('position').notNull().default(0),
});
export const categories = sqliteTable('categories', {
 type: text('type').notNull(), name: text('name').notNull(), position: integer('position').notNull().default(0),
}, (table) => [primaryKey({ columns: [table.type, table.name] })]);
export const avatars = sqliteTable('avatars', {
 // 同样沿用 owner 列名，存归属 key。
 ownerKey: text('owner').primaryKey(), data: text('data').notNull(), updatedAt: text('updated_at').notNull(),
});
export const settings = sqliteTable('settings', {
 id: text('id').primaryKey(), opening: integer('opening').notNull().default(0), revision: integer('revision').notNull().default(1),
});
// 每个可登录身份一条；「共同」没有账号，它只是归属标签。
export const accounts = sqliteTable('accounts', {
 ownerKey: text('owner_key').primaryKey(), passwordHash: text('password_hash').notNull(), passwordSalt: text('password_salt').notNull(),
 iterations: integer('iterations').notNull().default(100000), failedAttempts: integer('failed_attempts').notNull().default(0),
 lockedUntil: text('locked_until'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
// 只存令牌的 SHA-256，库里拿不到可用 Cookie。
export const sessions = sqliteTable('sessions', {
 id: text('id').primaryKey(), ownerKey: text('owner_key').notNull(), createdAt: text('created_at').notNull(),
 lastSeenAt: text('last_seen_at').notNull(), expiresAt: text('expires_at').notNull(),
});
// 已登录的一方给另一方生成的一次性认领码。
export const joinCodes = sqliteTable('join_codes', {
 ownerKey: text('owner_key').primaryKey(), codeHash: text('code_hash').notNull(), attempts: integer('attempts').notNull().default(0),
 expiresAt: text('expires_at').notNull(), createdAt: text('created_at').notNull(),
});
// 每条记录可评论；评论图片与记录图片共用 media 表，上传时即绑定目标。
export const comments = sqliteTable('comments', {
 id: text('id').primaryKey(), entryId: text('entry_id').notNull().references(() => entries.id, { onDelete: 'cascade' }),
 // 只允许两级：回复统一挂到根评论上，reply_to_owner 记住「回复的是谁」，用来显示「回复 @某某」。
 parentId: text('parent_id').references((): AnySQLiteColumn => comments.id, { onDelete: 'cascade' }),
 replyToOwner: text('reply_to_owner'),
 body: text('body').notNull().default(''), createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull(),
}, (table) => [index('comments_entry_idx').on(table.entryId, table.createdAt), index('comments_parent_idx').on(table.parentId)]);
// 评论点赞：两个人各算一票，同一评论同一人只记一次。
export const commentLikes = sqliteTable('comment_likes', {
 commentId: text('comment_id').notNull().references(() => comments.id, { onDelete: 'cascade' }),
 ownerKey: text('owner_key').notNull(),
 createdAt: text('created_at').notNull(),
}, (table) => [primaryKey({ columns: [table.commentId, table.ownerKey] })]);
export const media = sqliteTable('media', {
 id: text('id').primaryKey(),
 entryId: text('entry_id').references(() => entries.id, { onDelete: 'cascade' }),
 commentId: text('comment_id').references(() => comments.id, { onDelete: 'cascade' }),
 storage: text('storage').notNull(), mime: text('mime').notNull(), width: integer('width').notNull(), height: integer('height').notNull(),
 bytes: integer('bytes').notNull(), thumbMime: text('thumb_mime'), thumbBytes: integer('thumb_bytes').notNull().default(0),
 createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull(),
}, (table) => [
 index('media_entry_idx').on(table.entryId),
 index('media_comment_idx').on(table.commentId),
 index('media_created_idx').on(table.createdAt),
 check('media_target_check', sql`(${table.entryId} is not null) <> (${table.commentId} is not null)`),
 check('media_storage_check', sql`${table.storage} in ('r2','d1')`),
 check('media_thumb_check', sql`${table.thumbMime} is null or ${table.thumbMime} = 'image/jpeg'`),
]);
// R2 对象的异步删除队列；D1 兜底模式的字节和 media 行在同一个 batch 里删除，不进队列。
export const mediaDeletions = sqliteTable('media_deletions', {
 mediaId: text('media_id').notNull(), variant: text('variant').notNull(), storage: text('storage').notNull(),
 createdAt: text('created_at').notNull(), attempts: integer('attempts').notNull().default(0), nextAttemptAt: text('next_attempt_at').notNull(),
}, (table) => [primaryKey({ columns: [table.mediaId, table.variant] })]);
export const mediaState = sqliteTable('media_state', {
 id: text('id').primaryKey(), lastDrainAt: text('last_drain_at').notNull(),
});
export const mediaBlobs = sqliteTable('media_blobs', {
 mediaId: text('media_id').notNull(), variant: text('variant').notNull(), data: blob('data').notNull(),
}, (table) => [primaryKey({ columns: [table.mediaId, table.variant] })]);
