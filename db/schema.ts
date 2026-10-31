import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const entries = sqliteTable('entries', {
 id: text('id').primaryKey(), type: text('type').notNull(), amount: integer('amount').notNull(),
 owner: text('owner').notNull(), date: text('date').notNull(), note: text('note').notNull().default(''), category: text('category').notNull().default('其他'),
 revision: integer('revision').notNull().default(1), createdAt: text('created_at').notNull(),
});
export const settings = sqliteTable('settings', {
 id: text('id').primaryKey(), opening: integer('opening').notNull().default(0), revision: integer('revision').notNull().default(1),
});
