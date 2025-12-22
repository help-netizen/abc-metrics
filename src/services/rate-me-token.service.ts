import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import pool from '../db/connection';

const JOB_TOKEN_SECRET = process.env.JOB_TOKEN_SECRET || '';
const JOB_TOKEN_TTL_DAYS = parseInt(process.env.JOB_TOKEN_TTL_DAYS || '7', 10);

if (!JOB_TOKEN_SECRET) {
  console.warn('WARNING: JOB_TOKEN_SECRET is not set. JWT token generation will fail.');
}

interface JobTokenPayload {
  jobId: string;
  customerId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

interface JobTokenData {
  id: string;
  token: string;
  jobId: string;
  jobSerialId: number | null;
  customerId: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerFirstName: string | null;
  customerLastName: string | null;
  status: string;
  sentVia: string | null;
  sentAt: string | null;
  createdAt: string;
  expiresAt: string;
}

export class RateMeTokenService {
  /**
   * Generate a nonce (random string for preventing replay attacks)
   */
  private generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate JWT token for a job
   */
  private generateJwtToken(jobId: string, customerId: string): string {
    if (!JOB_TOKEN_SECRET) {
      throw new Error('JOB_TOKEN_SECRET is not configured');
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + (JOB_TOKEN_TTL_DAYS * 24 * 60 * 60);
    const nonce = this.generateNonce();

    const payload: JobTokenPayload = {
      jobId,
      customerId,
      issuedAt,
      expiresAt,
      nonce,
    };

    return jwt.sign(payload, JOB_TOKEN_SECRET, { algorithm: 'HS256' });
  }

  /**
   * Get or create token for a job
   */
  async getOrCreateToken(
    jobUuid: string,
    jobSerialId: number | null,
    customerId: string,
    customerEmail: string | null,
    customerPhone: string | null,
    customerFirstName: string | null,
    customerLastName: string | null,
    leadId?: string | null,
    sourceId?: string | null
  ): Promise<JobTokenData> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if token already exists
      const existingTokenResult = await client.query(
        `SELECT * FROM job_tokens WHERE job_uuid = $1`,
        [jobUuid]
      );

      if (existingTokenResult.rows.length > 0) {
        const existingToken = existingTokenResult.rows[0];
        const expiresAt = new Date(existingToken.expires_at);

        // Check if token is expired
        if (expiresAt > new Date()) {
          // Token is valid, return it
          return this.mapTokenToResponse(existingToken);
        } else {
          // Token is expired, update status
          await client.query(
            `UPDATE job_tokens SET status = 'expired', updated_at_db = CURRENT_TIMESTAMP WHERE id = $1`,
            [existingToken.id]
          );
        }
      }

      // Generate new token
      const token = this.generateJwtToken(jobUuid, customerId);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + JOB_TOKEN_TTL_DAYS);

      // Insert new token
      const insertResult = await client.query(
        `INSERT INTO job_tokens (
          job_uuid, job_serial_id, customer_id, token, customer_email, customer_phone,
          customer_first_name, customer_last_name, expires_at, lead_id, source_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (job_uuid) DO UPDATE SET
          token = EXCLUDED.token,
          expires_at = EXCLUDED.expires_at,
          status = 'pending',
          updated_at_db = CURRENT_TIMESTAMP
        RETURNING *`,
        [
          jobUuid,
          jobSerialId,
          customerId,
          token,
          customerEmail,
          customerPhone,
          customerFirstName,
          customerLastName,
          expiresAt,
          leadId || null,
          sourceId || null,
        ]
      );

      await client.query('COMMIT');

      return this.mapTokenToResponse(insertResult.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating job token:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get token by job UUID
   */
  async getTokenByJobUuid(jobUuid: string): Promise<JobTokenData | null> {
    const result = await pool.query(
      `SELECT * FROM job_tokens WHERE job_uuid = $1`,
      [jobUuid]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapTokenToResponse(result.rows[0]);
  }

  /**
   * Get token by Serial ID
   */
  async getTokenBySerialId(serialId: number): Promise<JobTokenData | null> {
    const result = await pool.query(
      `SELECT * FROM job_tokens WHERE job_serial_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [serialId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapTokenToResponse(result.rows[0]);
  }

  /**
   * Update token status
   */
  async updateToken(
    tokenId: string,
    updates: {
      status?: string;
      sentVia?: string;
      sentAt?: Date;
    }
  ): Promise<JobTokenData | null> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const setClauses: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (updates.status) {
        setClauses.push(`status = $${paramCount++}`);
        values.push(updates.status);
      }

      if (updates.sentVia !== undefined) {
        setClauses.push(`sent_via = $${paramCount++}`);
        values.push(updates.sentVia);
      }

      if (updates.sentAt) {
        setClauses.push(`sent_at = $${paramCount++}`);
        values.push(updates.sentAt);
      }

      if (setClauses.length === 0) {
        throw new Error('No updates provided');
      }

      setClauses.push(`updated_at_db = CURRENT_TIMESTAMP`);
      values.push(tokenId);

      const result = await client.query(
        `UPDATE job_tokens SET ${setClauses.join(', ')} WHERE id = $${paramCount} RETURNING *`,
        values
      );

      await client.query('COMMIT');

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapTokenToResponse(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error updating job token:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Map database row to API response format
   */
  private mapTokenToResponse(row: any): JobTokenData {
    return {
      id: row.id,
      token: row.token,
      jobId: row.job_uuid,
      jobSerialId: row.job_serial_id,
      customerId: row.customer_id,
      customerEmail: row.customer_email,
      customerPhone: row.customer_phone,
      customerFirstName: row.customer_first_name,
      customerLastName: row.customer_last_name,
      status: row.status,
      sentVia: row.sent_via,
      sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  }
}



