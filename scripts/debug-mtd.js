const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const queries = [
    "SELECT COUNT(*) FROM mart_profit_mtd WHERE d <= CURRENT_DATE AND d >= date_trunc('month', CURRENT_DATE)",
    "SELECT * FROM mart_profit_mtd_v2"
];

async function run() {
    for (const q of queries) {
        try {
            const res = await pool.query(q);
            console.log(`Query: ${q}`);
            console.log('Result:', res.rows);
        } catch (e) {
            console.error(`Error for ${q}:`, e.message);
        }
    }
    pool.end();
}

run();
