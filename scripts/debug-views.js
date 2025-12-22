const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query("SELECT table_name FROM information_schema.views WHERE table_schema = 'public'", (err, res) => {
    if (err) {
        console.error(err);
    } else {
        console.log('Views found:', res.rows.map(r => r.table_name));
    }
    pool.end();
});
