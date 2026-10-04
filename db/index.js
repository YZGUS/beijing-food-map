export function database(env) {
 if(!env.DB) throw new Error('Database binding unavailable');
 return env.DB;
}
