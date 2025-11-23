import { pgTable, serial, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
});

export const collections = pgTable(
  'collections',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('collections_user_id_idx').on(table.userId),
    nameUniq: uniqueIndex('collections_user_name_key').on(table.userId, table.name),
  }),
);

export const collectionItems = pgTable(
  'collection_items',
  {
    id: serial('id').primaryKey(),
    collectionId: integer('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (table) => ({
    collectionIdx: index('collection_items_collection_id_idx').on(table.collectionId),
    uniq: uniqueIndex('collection_items_collection_item_key').on(table.collectionId, table.itemId),
  }),
);
