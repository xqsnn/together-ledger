import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const entries = sqliteTable('entries', {
 id: text('id').primaryKey(), type: text('type').notNull(), amount: integer('amount').notNull(),
 // 数据库列名沿用 owner，但存储稳定的归属 key（qing/hua/together），显示名从 owners 解析。
 ownerKey: text('owner').notNull(), date: text('date').notNull(), note: text('note').notNull().default(''), category: text('category').notNull().default('其他'),
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
