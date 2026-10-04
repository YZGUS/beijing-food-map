import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const authUsers = sqliteTable('auth_users', {
 id: text('id').primaryKey(),
 username: text('username').notNull().unique(),
 displayName: text('display_name').notNull(),
 passwordSalt: text('password_salt').notNull(),
 passwordHash: text('password_hash').notNull(),
 createdAt: integer('created_at').notNull(),
});

export const authSessions = sqliteTable('auth_sessions', {
 tokenHash: text('token_hash').primaryKey(),
 userId: text('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
 createdAt: integer('created_at').notNull(),
 expiresAt: integer('expires_at').notNull(),
}, table => [index('auth_sessions_user').on(table.userId), index('auth_sessions_expiry').on(table.expiresAt)]);

export const authLoginAttempts = sqliteTable('auth_login_attempts', {
 accountKey: text('account_key').primaryKey(),
 failedCount: integer('failed_count').notNull(),
 windowStart: integer('window_start').notNull(),
 blockedUntil: integer('blocked_until').notNull().default(0),
});
