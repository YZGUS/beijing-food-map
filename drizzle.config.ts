import { defineConfig } from 'drizzle-kit';
export default defineConfig({schema:['./db/schema.ts','./db/auth-schema.ts'],out:'./drizzle',dialect:'sqlite'});
