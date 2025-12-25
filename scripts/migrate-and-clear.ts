import pool from '../src/db/connection';

async function migrateAndClear() {
    const client = await pool.connect();
    try {
        console.log('--- Database Migration & Cleanup ---');

        // 1. Add import_source column if it doesn't exist
        console.log('Checking for import_source column...');
        await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='fact_jobs' AND column_name='import_source') THEN
          ALTER TABLE fact_jobs ADD COLUMN import_source VARCHAR(50);
          RAISE NOTICE 'Added import_source column to fact_jobs';
        ELSE
          RAISE NOTICE 'import_source column already exists';
        END IF;
      END $$;
    `);

        // 2. Truncate table
        console.log('Clearing fact_jobs table...');
        await client.query('TRUNCATE TABLE fact_jobs CASCADE');
        console.log('Successfully cleared fact_jobs table.');

        console.log('--- Migration & Cleanup Complete ---');
    } catch (error) {
        console.error('Error during migration/cleanup:', error);
        process.exit(1);
    } finally {
        client.release();
        process.exit(0);
    }
}

migrateAndClear();
