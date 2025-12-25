import pool from '../src/db/connection';
import { NormalizationService } from '../src/services/normalization.service';

/**
 * Script to normalize existing phone numbers across all tables.
 * This includes separate columns and JSONB fields (raw_data, meta, etc.).
 */
async function normalizeExistingData() {
    const client = await pool.connect();

    try {
        console.log('🚀 Starting database-wide phone number normalization...');
        await client.query('BEGIN');

        // 1. elocals_leads
        console.log('📦 Normalizing elocals_leads...');
        const elocals = await client.query('SELECT id, caller_id, forwarding_number, contact_phone, contact_cell_phone, raw_data FROM elocals_leads');
        for (const row of elocals.rows) {
            const normalizedCallerId = NormalizationService.phone(row.caller_id);
            const normalizedForwarding = NormalizationService.phone(row.forwarding_number);
            const normalizedContactPhone = NormalizationService.phone(row.contact_phone);
            const normalizedContactCell = NormalizationService.phone(row.contact_cell_phone);
            const normalizedRawData = NormalizationService.normalizeObjectPhoneFields({ ...row.raw_data });

            await client.query(
                `UPDATE elocals_leads SET 
                    caller_id = $1, 
                    forwarding_number = $2, 
                    contact_phone = $3, 
                    contact_cell_phone = $4, 
                    raw_data = $5 
                WHERE id = $6`,
                [normalizedCallerId, normalizedForwarding, normalizedContactPhone, normalizedContactCell, normalizedRawData, row.id]
            );
        }

        // 2. servicedirect_leads
        console.log('📦 Normalizing servicedirect_leads...');
        const sdLeads = await client.query('SELECT lead_id, lead_phone, raw_data FROM servicedirect_leads');
        for (const row of sdLeads.rows) {
            const normalizedPhone = NormalizationService.phone(row.lead_phone);
            const normalizedRawData = NormalizationService.normalizeObjectPhoneFields({ ...row.raw_data });

            await client.query(
                'UPDATE servicedirect_leads SET lead_phone = $1, raw_data = $2 WHERE lead_id = $3',
                [normalizedPhone, normalizedRawData, row.lead_id]
            );
        }

        // 3. calls
        console.log('📦 Normalizing calls...');
        const calls = await client.query('SELECT id, from_number, to_number, raw_data FROM calls');
        for (const row of calls.rows) {
            const normalizedFrom = NormalizationService.phone(row.from_number);
            const normalizedTo = NormalizationService.phone(row.to_number);
            const normalizedRawData = NormalizationService.normalizeObjectPhoneFields({ ...row.raw_data });

            await client.query(
                'UPDATE calls SET from_number = $1, to_number = $2, raw_data = $3 WHERE id = $4',
                [normalizedFrom, normalizedTo, normalizedRawData, row.id]
            );
        }

        // 4. leads (Workiz Universal)
        console.log('📦 Normalizing leads...');
        const leads = await client.query('SELECT lead_id, client_phone, raw_payload FROM leads');
        for (const row of leads.rows) {
            const normalizedPhone = NormalizationService.phone(row.client_phone);
            const normalizedRawData = NormalizationService.normalizeObjectPhoneFields({ ...row.raw_payload });

            await client.query(
                'UPDATE leads SET client_phone = $1, raw_payload = $2 WHERE lead_id = $3',
                [normalizedPhone, normalizedRawData, row.lead_id]
            );
        }

        // 5. fact_leads
        console.log('📦 Normalizing fact_leads...');
        const factLeads = await client.query('SELECT lead_id, meta FROM fact_leads');
        for (const row of factLeads.rows) {
            const normalizedMeta = NormalizationService.normalizeObjectPhoneFields({ ...row.meta });
            // phone_hash is sensitive and should ideally be re-calculated if phone changes, 
            // but phone is not stored in fact_leads directly, only in meta.
            // If phone_hash needs update, we'd need the raw phone from meta.
            let updateQuery = 'UPDATE fact_leads SET meta = $1';
            const params = [normalizedMeta];

            const rawPhone = normalizedMeta?.Phone || normalizedMeta?.phone || normalizedMeta?.client_phone;
            if (rawPhone) {
                const crypto = require('crypto');
                const normalizedDigits = NormalizationService.phone(rawPhone);
                if (normalizedDigits) {
                    const phoneHash = crypto.createHash('sha256').update(normalizedDigits).digest('hex');
                    updateQuery += ', phone_hash = $2';
                    params.push(phoneHash);
                }
            }

            updateQuery += ` WHERE lead_id = $${params.length + 1}`;
            params.push(row.lead_id);

            await client.query(updateQuery, params);
        }

        // 6. fact_jobs
        console.log('📦 Normalizing fact_jobs...');
        const factJobs = await client.query('SELECT job_id, meta FROM fact_jobs');
        for (const row of factJobs.rows) {
            const normalizedMeta = NormalizationService.normalizeObjectPhoneFields({ ...row.meta });
            await client.query(
                'UPDATE fact_jobs SET meta = $1 WHERE job_id = $2',
                [normalizedMeta, row.job_id]
            );
        }

        // 7. job_tokens
        console.log('📦 Normalizing job_tokens...');
        const jobTokens = await client.query('SELECT id, customer_phone, meta FROM job_tokens');
        for (const row of jobTokens.rows) {
            const normalizedPhone = NormalizationService.phone(row.customer_phone);
            const normalizedMeta = NormalizationService.normalizeObjectPhoneFields({ ...row.meta });

            await client.query(
                'UPDATE job_tokens SET customer_phone = $1, meta = $2 WHERE id = $3',
                [normalizedPhone, normalizedMeta, row.id]
            );
        }

        // 8. referral_shares
        console.log('📦 Normalizing referral_shares...');
        const referralShares = await client.query('SELECT id, recipient_phone FROM referral_shares');
        for (const row of referralShares.rows) {
            const normalizedPhone = NormalizationService.phone(row.recipient_phone);

            await client.query(
                'UPDATE referral_shares SET recipient_phone = $1 WHERE id = $2',
                [normalizedPhone, row.id]
            );
        }

        await client.query('COMMIT');
        console.log('✅ All data successfully normalized!');

    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('❌ Error during normalization:', error);
    } finally {
        client.release();
        process.exit(0);
    }
}

normalizeExistingData().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
