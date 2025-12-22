const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query("SELECT current_user, session_user, version()", (err, res) => {
    if (err) console.error(err);
    else console.log('User info:', res.rows[0]);

    pool.query("SELECT table_name, table_owner FROM pg_views WHERE table_name = 'mart_profit_mtd_v2'", (err2, res2) => {
        if (err2) console.error(err2);
        else console.log('View owner:', res2.rows[0]);
        pool.end();
    });
});
