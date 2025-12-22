import { Router, Request, Response } from 'express';
import axios from 'axios';
import pool from '../db/connection';
import { RateMeTokenService } from '../services/rate-me-token.service';
import { authenticateApiKey } from '../middleware/auth.middleware';
import { rateMeRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();
const tokenService = new RateMeTokenService();

// Workiz API configuration for fetching single jobs
const WORKIZ_API_KEY = process.env.WORKIZ_API_KEY || '';
const WORKIZ_API_URL = process.env.WORKIZ_API_URL || 'https://api.workiz.com';
const WORKIZ_API_BASE_PATH = `${WORKIZ_API_URL}/api/v1/${WORKIZ_API_KEY}`;

/**
 * Fetch job from Workiz API by UUID
 */
async function fetchJobFromWorkiz(uuid: string): Promise<any | null> {
  try {
    const response = await axios.get(`${WORKIZ_API_BASE_PATH}/job/get/${uuid}/`);
    
    // Handle different possible response structures
    let jobData: any;
    if (response.data && typeof response.data === 'object') {
      // API might return data wrapped in 'data' field or as array
      if (Array.isArray(response.data)) {
        jobData = response.data[0];
      } else if (response.data.data) {
        jobData = response.data.data;
      } else if (response.data.flag && response.data.data) {
        jobData = response.data.data;
      } else {
        jobData = response.data;
      }
    } else {
      return null;
    }

    return jobData;
  } catch (error: any) {
    console.error(`Error fetching job ${uuid} from Workiz API:`, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    return null;
  }
}

/**
 * GET /api/v1/jobs/{uuid}
 * Получение информации о работе по UUID
 */
router.get('/jobs/:uuid', authenticateApiKey, rateMeRateLimiter, async (req: Request, res: Response) => {
  try {
    const { uuid } = req.params;

    // Try to find job in database first
    const dbResult = await pool.query(
      `SELECT meta FROM fact_jobs WHERE job_id = $1`,
      [uuid]
    );

    let jobData: any = null;

    if (dbResult.rows.length > 0) {
      // Job found in database
      const meta = dbResult.rows[0].meta;
      if (meta && typeof meta === 'object') {
        jobData = meta;
      }
    } else {
      // Job not in database, fetch from Workiz API
      console.log(`Job ${uuid} not found in DB, fetching from Workiz API...`);
      const workizJobData = await fetchJobFromWorkiz(uuid);
      
      if (!workizJobData) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Job with UUID ${uuid} not found`
        });
      }

      jobData = workizJobData;

      // Save job to database for future use (безопасно, не затрагивает токены)
      try {
        await pool.query(
          `INSERT INTO fact_jobs (job_id, created_at, source_id, type, meta)
           VALUES ($1, $2, (SELECT id FROM dim_source WHERE code = 'workiz' LIMIT 1), $3, $4)
           ON CONFLICT (job_id) DO UPDATE SET meta = EXCLUDED.meta, updated_at_db = CURRENT_TIMESTAMP`,
          [
            uuid,
            new Date(),
            workizJobData.JobType || null,
            JSON.stringify(workizJobData)
          ]
        );
      } catch (saveError) {
        console.error('Error saving job to database:', saveError);
        // Continue even if save fails - токены не зависят от этого
      }
    }

    if (!jobData) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Job with UUID ${uuid} not found`
      });
    }

    res.json({
      data: jobData
    });
  } catch (error: any) {
    console.error('Error fetching job:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/jobs/serial/{serialId}
 * Получение информации о работе по SerialId
 */
router.get('/jobs/serial/:serialId', authenticateApiKey, rateMeRateLimiter, async (req: Request, res: Response) => {
  try {
    const { serialId } = req.params;
    const serialIdNum = parseInt(serialId, 10);

    if (isNaN(serialIdNum)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid serialId format'
      });
    }

    // Find job by serial_id in database
    const dbResult = await pool.query(
      `SELECT job_id, meta FROM fact_jobs WHERE serial_id = $1 ORDER BY created_at_db DESC LIMIT 1`,
      [serialIdNum]
    );

    if (dbResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Job with SerialId ${serialId} not found`
      });
    }

    const jobId = dbResult.rows[0].job_id;
    const meta = dbResult.rows[0].meta;

    if (!meta || typeof meta !== 'object') {
      return res.status(404).json({
        error: 'Not Found',
        message: `Job data not available for SerialId ${serialId}`
      });
    }

    res.json({
      data: meta
    });
  } catch (error: any) {
    console.error('Error fetching job by serialId:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/job-tokens/{jobUuid}
 * Получение или создание токена для работы
 */
router.get('/job-tokens/:jobUuid', authenticateApiKey, rateMeRateLimiter, async (req: Request, res: Response) => {
  try {
    const { jobUuid } = req.params;

    // Get job data first
    let jobData: any = null;
    const dbResult = await pool.query(
      `SELECT meta, serial_id FROM fact_jobs WHERE job_id = $1`,
      [jobUuid]
    );

    if (dbResult.rows.length > 0) {
      jobData = dbResult.rows[0].meta;
    } else {
      // Fetch from Workiz if not in DB
      const workizJobData = await fetchJobFromWorkiz(jobUuid);
      if (!workizJobData) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Job with UUID ${jobUuid} not found`
        });
      }
      jobData = workizJobData;
    }

    if (!jobData) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Job with UUID ${jobUuid} not found`
      });
    }

    // Extract customer information
    const customerId = String(jobData.ClientId || '');
    const serialId = jobData.SerialId || dbResult.rows[0]?.serial_id || null;
    const customerEmail = jobData.Email || null;
    const customerPhone = jobData.Phone || null;
    const customerFirstName = jobData.FirstName || null;
    const customerLastName = jobData.LastName || null;

    if (!customerId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Job does not have a valid customer ID'
      });
    }

    // Get or create token
    const tokenData = await tokenService.getOrCreateToken(
      jobUuid,
      serialId,
      customerId,
      customerEmail,
      customerPhone,
      customerFirstName,
      customerLastName,
      jobData.LeadId || null,
      jobData.JobSource || null
    );

    res.json({
      data: tokenData
    });
  } catch (error: any) {
    console.error('Error getting job token:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/job-tokens/serial/{serialId}
 * Получение токена для работы по SerialId
 */
router.get('/job-tokens/serial/:serialId', authenticateApiKey, rateMeRateLimiter, async (req: Request, res: Response) => {
  try {
    const { serialId } = req.params;
    const serialIdNum = parseInt(serialId, 10);

    if (isNaN(serialIdNum)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid serialId format'
      });
    }

    // Find job by serial_id
    const dbResult = await pool.query(
      `SELECT job_id FROM fact_jobs WHERE serial_id = $1 ORDER BY created_at_db DESC LIMIT 1`,
      [serialIdNum]
    );

    if (dbResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Job with SerialId ${serialId} not found`
      });
    }

    const jobUuid = dbResult.rows[0].job_id;

    // Get job data first
    let jobData: any = null;
    const jobDbResult = await pool.query(
      `SELECT meta, serial_id FROM fact_jobs WHERE job_id = $1`,
      [jobUuid]
    );

    if (jobDbResult.rows.length > 0) {
      jobData = jobDbResult.rows[0].meta;
    } else {
      // Fetch from Workiz if not in DB
      const workizJobData = await fetchJobFromWorkiz(jobUuid);
      if (!workizJobData) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Job with UUID ${jobUuid} not found`
        });
      }
      jobData = workizJobData;
    }

    if (!jobData) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Job data not available for UUID ${jobUuid}`
      });
    }

    // Extract customer information
    const customerId = String(jobData.ClientId || '');
    const serialIdFromJob = jobData.SerialId || jobDbResult.rows[0]?.serial_id || null;
    const customerEmail = jobData.Email || null;
    const customerPhone = jobData.Phone || null;
    const customerFirstName = jobData.FirstName || null;
    const customerLastName = jobData.LastName || null;

    if (!customerId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Job does not have a valid customer ID'
      });
    }

    // Get or create token
    const tokenData = await tokenService.getOrCreateToken(
      jobUuid,
      serialIdFromJob,
      customerId,
      customerEmail,
      customerPhone,
      customerFirstName,
      customerLastName,
      jobData.LeadId || null,
      jobData.JobSource || null
    );

    res.json({
      data: tokenData
    });
  } catch (error: any) {
    console.error('Error getting job token by serialId:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/job-tokens
 * Создание токена для работы вручную
 */
router.post('/job-tokens', authenticateApiKey, rateMeRateLimiter, async (req: Request, res: Response) => {
  try {
    const {
      jobUuid,
      customerId,
      customerEmail,
      customerPhone,
      customerFirstName,
      customerLastName
    } = req.body;

    if (!jobUuid || !customerId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'jobUuid and customerId are required'
      });
    }

    // Check if token already exists
    const existingToken = await tokenService.getTokenByJobUuid(jobUuid);
    if (existingToken) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Token already exists for this job',
        data: existingToken
      });
    }

    // Get serial_id from job
    const dbResult = await pool.query(
      `SELECT serial_id FROM fact_jobs WHERE job_id = $1`,
      [jobUuid]
    );

    const serialId = dbResult.rows[0]?.serial_id || null;

    // Create token
    const tokenData = await tokenService.getOrCreateToken(
      jobUuid,
      serialId,
      customerId,
      customerEmail || null,
      customerPhone || null,
      customerFirstName || null,
      customerLastName || null
    );

    res.status(201).json({
      data: tokenData
    });
  } catch (error: any) {
    console.error('Error creating job token:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * PUT /api/v1/job-tokens/{tokenId}
 * Обновление статуса токена
 */
router.put('/job-tokens/:tokenId', authenticateApiKey, rateMeRateLimiter, async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const { status, sentVia, sentAt } = req.body;

    const updates: any = {};
    if (status) updates.status = status;
    if (sentVia) updates.sentVia = sentVia;
    if (sentAt) updates.sentAt = new Date(sentAt);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'No update fields provided'
      });
    }

    const tokenData = await tokenService.updateToken(tokenId, updates);

    if (!tokenData) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Token with ID ${tokenId} not found`
      });
    }

    res.json({
      data: tokenData
    });
  } catch (error: any) {
    console.error('Error updating job token:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

export default router;

