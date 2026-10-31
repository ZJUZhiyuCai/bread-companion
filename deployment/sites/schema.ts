import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
// Rolling budget metadata only. No conversation, audio, raw IP or model response is stored.
export const requests = sqliteTable('bread_requests', {
  id: text('id').primaryKey(), principal: text('principal').notNull(), lane: text('lane').notNull(),
  createdAt: integer('created_at').notNull(), activeUntil: integer('active_until').notNull(), expiresAt: integer('expires_at').notNull(),
}, t => [index('bread_created').on(t.createdAt), index('bread_principal_created').on(t.principal,t.createdAt), index('bread_active').on(t.activeUntil), index('bread_expiry').on(t.expiresAt)]);
