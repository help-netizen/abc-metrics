/**
 * Delete all records from fact_jobs table
 * WARNING: This is a destructive operation!
 */

import pool from '../src/db/pool';

async function deleteAllJobs() {
    const client = await pool.connect();

    try {
        console.log('Starting deletion of all records from fact_jobs...');

        // Delete all records
        const result = await client.query('DELETE FROM fact_jobs');

        console.log(`✅ Successfully deleted ${result.rowCount} records from fact_jobs`);

        // Reset the sequence if needed (optional)
        // await client.query('ALTER SEQUENCE fact_jobs_id_seq RESTART WITH 1');

    } catch (error) {
        console.error('❌ Error deleting records:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the deletion
deleteAllJobs()
    .then(() => {
        console.log('Deletion completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Deletion failed:', error);
        process.exit(1);
    });
