import { sqliteTable, text, integer, real, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const branches = sqliteTable('branches', {
 id: text('id').primaryKey(), name: text('name').notNull(), city: text('city').notNull().default('北京'),
 address: text('address').notNull(), lat: real('lat'), lng: real('lng'), matchKey: text('match_key').notNull().unique(),
 locationSource: text('location_source').notNull().default('user'),
});
export const media = sqliteTable('media', {
 id: text('id').primaryKey(), owner: text('owner').notNull(), objectKey: text('object_key').notNull().unique(),
 mime: text('mime').notNull(), bytes: integer('bytes').notNull(), createdAt: text('created_at').notNull(),
});
export const entries = sqliteTable('entries', {
 id: text('id').primaryKey(), branchId: text('branch_id').notNull().references(()=>branches.id),
 dishes: text('dishes').notNull(), mediaIds: text('media_ids').notNull().default('[]'),
 experience: text('experience').notNull().default(''), mealDate: text('meal_date'), amount: real('amount'), sourceUrl: text('source_url'),
 provenance: text('provenance').notNull(), creator: text('creator'), displayName: text('display_name').notNull().default('食单用户'),
 requestKey: text('request_key'), payloadHash: text('payload_hash'), createdAt: text('created_at').notNull(),
}, t=>[uniqueIndex('entry_request').on(t.creator,t.requestKey)]);
export const likes = sqliteTable('likes', {
 entryId: text('entry_id').notNull().references(()=>entries.id), userId: text('user_id').notNull(), createdAt: text('created_at').notNull(),
}, t=>[primaryKey({columns:[t.entryId,t.userId]})]);
export const comments = sqliteTable('comments', {
 id: text('id').primaryKey(), entryId: text('entry_id').notNull().references(()=>entries.id), userId: text('user_id').notNull(),
 displayName: text('display_name').notNull(), body: text('body').notNull(), ateClaim: integer('ate_claim').notNull().default(0),
 requestKey: text('request_key').notNull(), payloadHash: text('payload_hash').notNull(), createdAt: text('created_at').notNull(),
}, t=>[uniqueIndex('comment_request').on(t.userId,t.requestKey)]);
export const entryMedia = sqliteTable('entry_media', {
 entryId: text('entry_id').notNull().references(()=>entries.id), mediaId: text('media_id').notNull().references(()=>media.id),
}, t=>[primaryKey({columns:[t.entryId,t.mediaId]})]);
export const queueReports = sqliteTable('queue_reports', {
 id: text('id').primaryKey(), branchId: text('branch_id').notNull().references(()=>branches.id), userId: text('user_id').notNull(),
 displayName: text('display_name').notNull(), observedAt: text('observed_at').notNull(), waitMinutes: integer('wait_minutes').notNull(),
 kind: text('kind').notNull(), partySize: integer('party_size').notNull(), note: text('note').notNull().default(''),
 requestKey: text('request_key').notNull(), payloadHash: text('payload_hash').notNull(), createdAt: text('created_at').notNull(), deletedAt: text('deleted_at'),
}, t=>[uniqueIndex('queue_report_request').on(t.userId,t.requestKey),index('queue_report_branch_time').on(t.branchId,t.observedAt),index('queue_report_user_time').on(t.userId,t.createdAt),check('queue_wait_range',sql`${t.waitMinutes} BETWEEN 0 AND 600`),check('queue_kind',sql`${t.kind} IN ('estimate','elapsed','actual')`),check('queue_party_range',sql`${t.partySize} BETWEEN 1 AND 20`),check('queue_note_length',sql`length(${t.note})<=250`)]);
