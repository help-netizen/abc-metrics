import puppeteer, { Browser, Page } from 'puppeteer';
import { parse } from 'csv-parse/sync';
import pool from '../db/connection';

// Business ID is hardcoded as per requirements
const ELOCAL_BUSINESS_ID = '11809158';

// Normalized call interface
interface ElocalCall {
  call_id: string;
  date: string;
  duration?: number;
  call_type?: string;
  source: string;
}

export class SvcElocalCalls {
  private username: string;
  private password: string;
  private browser: Browser | null = null;

  constructor() {
    this.username = process.env.ELOCAL_USERNAME || 'help@bostonmasters.com';
    this.password = process.env.ELOCAL_PASSWORD || 'Alga!B@r2';
  }

  /**
   * Get or create browser instance
   */
  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
      this.browser = await puppeteer.launch({
        headless: true,
        executablePath: executablePath,
        protocolTimeout: 300000, // 5 minutes timeout for network operations
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      });
    }
    return this.browser;
  }

  /**
   * Close browser instance
   */
  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Authenticate with elocal.com using Puppeteer
   */
  async authenticate(page: Page): Promise<boolean> {
    const authStartTime = Date.now();
    try {
      console.log(`[AUTH] Authenticating with elocal.com using Puppeteer (username: ${this.username})...`);
      
      const loginUrl = `https://www.elocal.com/business_users/login?manual_login=true&username=${encodeURIComponent(this.username)}`;
      console.log(`[AUTH] Navigating to login page: ${loginUrl}`);
      
      // Navigate to login page with increased timeout
      await page.setDefaultNavigationTimeout(120000); // 2 minutes
      await page.setDefaultTimeout(120000); // 2 minutes
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
      
      // Check if we're already logged in
      const initialUrl = page.url();
      console.log(`[AUTH] Initial URL after navigation: ${initialUrl}`);
      if (!initialUrl.includes('/login')) {
        const authTime = ((Date.now() - authStartTime) / 1000).toFixed(2);
        console.log(`[AUTH] Already logged in (not on login page) (took ${authTime}s)`);
        return true;
      }
      
      // Wait for page to fully load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Wait for password input field or check if already logged in
      let passwordField = null;
      try {
        passwordField = await page.waitForSelector('input[type="password"]', { timeout: 20000 });
      } catch (error) {
        // Try alternative selectors
        passwordField = await page.$('input[name="password"], input[id*="password"], input[placeholder*="password" i]').catch(() => null);
      }
      
      // If password field not found, check if we're already logged in
      if (!passwordField) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const url = page.url();
        if (!url.includes('/login')) {
          const authTime = ((Date.now() - authStartTime) / 1000).toFixed(2);
          console.log(`[AUTH] Already logged in (no password field found, not on login page) (took ${authTime}s)`);
          return true;
        }
        console.warn('[AUTH] Password field not found, but still on login page. URL:', url);
        // Try to find password field with different approach
        const allInputs = await page.$$('input').catch(() => []);
        console.log(`[AUTH] Found ${allInputs.length} input fields on page`);
        // Continue anyway, might be a different login form
      }
      
      // Fill in password
      if (passwordField) {
        await passwordField.type(this.password, { delay: 100 });
      } else {
        // Try to type password using evaluate
        await page.evaluate((password) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pwdInput = (globalThis as any).document?.querySelector('input[type="password"]');
          if (pwdInput) {
            pwdInput.value = password;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pwdInput.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
          }
        }, this.password);
      }
      
      // Submit form - wait for navigation before clicking to avoid context destruction
      const navigationPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {
        // Navigation might not happen
      });
      
      // Try to submit form
      let submitted = false;
      
      // Try input[type="submit"]
      try {
        const submitInput = await page.$('input[type="submit"]');
        if (submitInput) {
          await Promise.all([
            navigationPromise,
            submitInput.click(),
          ]);
          submitted = true;
        }
      } catch (e) {
        // Ignore
      }
      
      // Try button[type="submit"]
      if (!submitted) {
        try {
          const submitButton = await page.$('button[type="submit"]');
          if (submitButton) {
            await Promise.all([
              navigationPromise,
              submitButton.click(),
            ]);
            submitted = true;
          }
        } catch (e) {
          // Ignore
        }
      }
      
      // Try pressing Enter on password field
      if (!submitted) {
        try {
          await Promise.all([
            navigationPromise,
            page.keyboard.press('Enter'),
          ]);
          submitted = true;
        } catch (e) {
          // Ignore
        }
      }
      
      // Wait a bit for navigation to complete
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Check if login was successful by looking for login page elements or dashboard
      const currentUrl = page.url();
      const pageContent = await page.content();
      
      const isLoggedIn = !currentUrl.includes('/login') || 
                        pageContent.includes('dashboard') ||
                        pageContent.includes('calls') ||
                        !pageContent.includes('Log In');
      
      const authTime = ((Date.now() - authStartTime) / 1000).toFixed(2);
      if (isLoggedIn) {
        console.log(`[AUTH] Authentication successful (took ${authTime}s)`);
        return true;
      } else {
        console.error(`[AUTH] Authentication failed - still on login page (took ${authTime}s). Current URL: ${currentUrl}`);
        return false;
      }
    } catch (error: any) {
      const authTime = ((Date.now() - authStartTime) / 1000).toFixed(2);
      console.error(`[AUTH] Error during authentication (took ${authTime}s):`, error.message);
      return false;
    }
  }

  /**
   * Fetch calls CSV from elocal.com export endpoint using Puppeteer
   */
  async fetchCallsCsv(startDate: string, endDate: string): Promise<string> {
    const fetchStartTime = Date.now();
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    
    try {
      // Set increased timeouts for network operations
      await page.setDefaultNavigationTimeout(120000); // 2 minutes
      await page.setDefaultTimeout(120000); // 2 minutes
      
      console.log(`[FETCH] Fetching calls CSV from elocal.com: start=${startDate}, end=${endDate}`);
      
      // First, authenticate
      const authenticated = await this.authenticate(page);
      if (!authenticated) {
        throw new Error('Failed to authenticate with elocal.com');
      }

      // Wait for navigation to complete after authentication
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get export URL
      const exportUrl = `https://www.elocal.com/business_users/calls/export/${ELOCAL_BUSINESS_ID}?start=${startDate}&end=${endDate}`;
      console.log(`[FETCH] Fetching CSV from export URL: ${exportUrl}`);
      
      const csvFetchStartTime = Date.now();
      // Use page.evaluate to fetch CSV using browser's fetch API (with cookies)
      const csvContent = await page.evaluate(async (url: string) => {
        try {
          const response = await fetch(url, {
            method: 'GET',
            credentials: 'include', // Include cookies
          });
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const text = await response.text();
          
          // Check if it's HTML (login page) instead of CSV
          if (text.trim().startsWith('<!DOCTYPE') || text.includes('<html')) {
            throw new Error('Received HTML instead of CSV');
          }
          
          return text;
        } catch (error: any) {
          throw new Error(`Failed to fetch CSV: ${error.message}`);
        }
      }, exportUrl);
      const csvFetchTime = ((Date.now() - csvFetchStartTime) / 1000).toFixed(2);

      // Check if we got HTML login page instead of CSV
      if (csvContent.includes('Log In') || csvContent.includes('Business User Log In') || csvContent.trim().startsWith('<!DOCTYPE')) {
        throw new Error('Received login page instead of CSV - authentication may have expired');
      }

      if (!csvContent || csvContent.trim().length === 0) {
        throw new Error('Received empty CSV response');
      }
      
      // Calculate CSV statistics
      const csvBytes = csvContent.length;
      const csvLines = csvContent.split('\n').length;
      const csvSizeKB = (csvBytes / 1024).toFixed(2);
      
      // Log first few lines of CSV for format verification
      const csvLinesArray = csvContent.split('\n');
      const previewLines = csvLinesArray.slice(0, 3).join('\n');
      
      const fetchTime = ((Date.now() - fetchStartTime) / 1000).toFixed(2);
      console.log(`[FETCH] Received CSV: ${csvBytes} bytes (${csvSizeKB} KB), ~${csvLines} lines (took ${csvFetchTime}s, total ${fetchTime}s)`);
      console.log(`[FETCH] CSV preview (first 3 lines):\n${previewLines}`);
      
      return csvContent;
    } catch (error: any) {
      console.error('Error fetching calls CSV:', {
        message: error.message,
        url: page.url(),
      });
      throw error;
    } finally {
      await page.close();
    }
  }

  /**
   * Parse CSV content into normalized call records
   */
  parseCallsCsv(csvContent: string): ElocalCall[] {
    if (!csvContent || csvContent.trim().length === 0) {
      console.log(`[PARSE] Empty CSV content, returning empty array`);
      return [];
    }

    try {
      const parseStartTime = Date.now();
      console.log(`[PARSE] Starting CSV parsing...`);
      
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      console.log(`[PARSE] CSV parsed into ${records.length} raw records`);
      const calls: ElocalCall[] = [];
      const skippedReasons: { [key: string]: number } = {};

      for (const record of records) {
        // Map CSV columns to our call structure based on actual elocal.com CSV format
        // Real fields from elocal.com CSV:
        // - 'Unique ID' -> call_id
        // - 'Time' -> date
        // - 'Duration' -> duration (format: 'MM:SS')
        // - 'Status' -> call_type
        
        const callId = record['Unique ID'] || record.call_id || record.id || record['Call ID'] || 
                      record['CallID'] || record['call-id'] || record['Call Id'] || null;
        const callDate = record.Time || record.date || record.Date || record['Call Date'] || 
                        record['CallDate'] || record['call-date'] || record['Call Date'] || null;
        const duration = record.Duration || record.duration || record['Call Duration'] || 
                        record['CallDuration'] || record['call-duration'] || record['Duration (seconds)'] || null;
        const callType = record.Status || record.call_type || record.type || record.Type || 
                        record['Call Type'] || record['CallType'] || record['call-type'] || null;

        if (!callId || !callDate) {
          const reason = !callId ? 'missing call_id' : 'missing date';
          skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
          if (calls.length < 3) {
            console.warn(`[PARSE] Skipping call record (${reason}):`, JSON.stringify(record).substring(0, 200));
          }
          continue;
        }

        // Parse duration if it's a string
        let durationNum: number | undefined = undefined;
        if (duration) {
          if (typeof duration === 'number') {
            durationNum = duration;
          } else if (typeof duration === 'string') {
            // Try to parse duration (might be in seconds, minutes, or "MM:SS" format)
            const durationStr = duration.trim();
            if (durationStr.includes(':')) {
              // Format like "5:30" (minutes:seconds)
              const [mins, secs] = durationStr.split(':').map(Number);
              durationNum = (mins || 0) * 60 + (secs || 0);
            } else {
              durationNum = parseInt(durationStr, 10);
            }
          }
        }

        // Normalize date format
        let normalizedDate = callDate;
        if (typeof callDate === 'string') {
          // Try to parse and normalize date
          const dateObj = new Date(callDate);
          if (!isNaN(dateObj.getTime())) {
            normalizedDate = dateObj.toISOString().split('T')[0];
          } else {
            // Try common date formats
            const dateMatch = callDate.match(/(\d{4})[-\/](\d{2})[-\/](\d{2})/);
            if (dateMatch) {
              normalizedDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
            } else {
              console.warn(`Could not parse date: ${callDate}, using as-is`);
            }
          }
        }

        calls.push({
          call_id: String(callId),
          date: normalizedDate,
          duration: durationNum,
          call_type: callType || undefined,
          source: 'elocals',
        });
      }

      const parseTime = ((Date.now() - parseStartTime) / 1000).toFixed(2);
      const skippedCount = records.length - calls.length;
      const skippedSummary = Object.keys(skippedReasons).length > 0 
        ? ` (${skippedCount} skipped: ${Object.entries(skippedReasons).map(([reason, count]) => `${count} ${reason}`).join(', ')})`
        : '';
      
      console.log(`[PARSE] Parsed ${calls.length} calls from ${records.length} CSV rows${skippedSummary} (took ${parseTime}s)`);
      
      // Log sample parsed calls
      if (calls.length > 0) {
        const sampleCalls = calls.slice(0, 3);
        console.log(`[PARSE] Sample parsed calls (first ${sampleCalls.length}):`);
        sampleCalls.forEach((call, idx) => {
          console.log(`[PARSE]   ${idx + 1}. call_id=${call.call_id}, date=${call.date}, duration=${call.duration || 'N/A'}, type=${call.call_type || 'N/A'}`);
        });
      }
      
      return calls;
    } catch (error) {
      console.error('[PARSE] Error parsing CSV:', error);
      throw error;
    }
  }

  /**
   * Save calls to database
   * Uses ON CONFLICT DO UPDATE to ensure idempotent syncs - can run hourly without duplicates
   */
  async saveCalls(calls: ElocalCall[]): Promise<void> {
    const saveStartTime = Date.now();
    if (calls.length === 0) {
      console.log('[SAVE] No calls to save');
      return;
    }

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      console.log(`[SAVE] Starting to save ${calls.length} calls to database...`);

      let savedCount = 0;
      let skippedCount = 0;
      const errors: Array<{ callId: string; error: string }> = [];
      const totalCalls = calls.length;
      const progressInterval = Math.max(1, Math.floor(totalCalls / 10)); // Log every 10%

      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        try {
          if (!call.call_id || !call.date) {
            console.warn(`[SAVE] Skipping call missing required fields: call_id=${call.call_id}, date=${call.date}`);
            skippedCount++;
            continue;
          }

          if (savedCount < 3) {
            console.log(`[SAVE] Saving call: id=${call.call_id}, date=${call.date}, duration=${call.duration || 'N/A'}`);
          }
          
          // Log progress every 10% or every 100 records
          if ((i + 1) % progressInterval === 0 || (i + 1) % 100 === 0) {
            const progress = ((i + 1) / totalCalls * 100).toFixed(0);
            console.log(`[SAVE] Progress: ${i + 1}/${totalCalls} processed (${progress}%), ${savedCount} saved, ${skippedCount} skipped`);
          }

          // Upsert call record using call_id as unique key
          // This allows running sync multiple times without creating duplicates
          // All fields are updated to ensure data is always current
          await client.query(
            `INSERT INTO calls (call_id, date, duration, call_type, source)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (call_id) 
             DO UPDATE SET 
               date = EXCLUDED.date,
               duration = EXCLUDED.duration,
               call_type = EXCLUDED.call_type,
               source = EXCLUDED.source,
               updated_at = CURRENT_TIMESTAMP`,
            [
              call.call_id,
              call.date,
              call.duration || null,
              call.call_type || null,
              call.source,
            ]
          );

          savedCount++;
        } catch (dbError: any) {
          // Log first 5 errors in detail
          if (errors.length < 5) {
            console.error(`[SAVE] Error saving call ${call.call_id}:`, {
              callId: call.call_id,
              error: dbError.message,
              code: dbError.code,
              detail: dbError.detail,
              hint: dbError.hint,
              callData: {
                date: call.date,
                duration: call.duration,
                call_type: call.call_type,
                source: call.source,
              }
            });
          }
          errors.push({ callId: call.call_id, error: dbError.message });
          skippedCount++;
        }
      }

      await client.query('COMMIT');
      
      const saveTime = ((Date.now() - saveStartTime) / 1000).toFixed(2);
      console.log(`[SAVE] Calls save summary: ${savedCount} saved, ${skippedCount} skipped (took ${saveTime}s)`);
      if (errors.length > 0) {
        console.warn(`[SAVE] Errors encountered (${errors.length} total):`, errors.slice(0, 10));
        if (errors.length > 10) {
          console.warn(`[SAVE] ... and ${errors.length - 10} more errors`);
        }
      }
    } catch (error) {
      await client.query('ROLLBACK');
      const saveTime = ((Date.now() - saveStartTime) / 1000).toFixed(2);
      console.error(`[SAVE] Error saving elocal calls (took ${saveTime}s):`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Sync calls (fetch, parse, and save)
   */
  async syncCalls(): Promise<void> {
    const startTime = Date.now();
    try {
      // Calculate date range: last 30 days, excluding today
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const endDate = yesterday.toISOString().split('T')[0];
      
      const startDateObj = new Date(yesterday);
      startDateObj.setDate(startDateObj.getDate() - 29); // 30 days total (including yesterday)
      const startDate = startDateObj.toISOString().split('T')[0];

      console.log(`[START] Elocal calls sync: start=${startDate}, end=${endDate}`);

      // Step 1: Fetch CSV using Puppeteer
      const fetchStartTime = Date.now();
      console.log(`[STEP 1] Fetching CSV from elocal.com...`);
      const csvContent = await this.fetchCallsCsv(startDate, endDate);
      const fetchTime = ((Date.now() - fetchStartTime) / 1000).toFixed(2);
      
      if (!csvContent || csvContent.trim().length === 0) {
        console.log(`[STEP 1] No CSV content received, skipping save (took ${fetchTime}s)`);
        return;
      }
      console.log(`[STEP 1] CSV fetched successfully (took ${fetchTime}s)`);

      // Step 2: Parse CSV
      const parseStartTime = Date.now();
      console.log(`[STEP 2] Parsing CSV content...`);
      const calls = this.parseCallsCsv(csvContent);
      const parseTime = ((Date.now() - parseStartTime) / 1000).toFixed(2);
      console.log(`[STEP 2] CSV parsed: ${calls.length} calls extracted (took ${parseTime}s)`);
      
      if (calls.length === 0) {
        console.log(`[WARNING] No calls to save after parsing`);
        return;
      }

      // Step 3: Save to database
      const saveStartTime = Date.now();
      console.log(`[STEP 3] Saving ${calls.length} calls to database...`);
      await this.saveCalls(calls);
      const saveTime = ((Date.now() - saveStartTime) / 1000).toFixed(2);
      console.log(`[STEP 3] Calls saved to database (took ${saveTime}s)`);
      
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[SUCCESS] Elocal calls sync completed: ${calls.length} calls processed in ${totalTime}s total`);
    } catch (error) {
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error(`[ERROR] Elocal calls sync failed after ${totalTime}s:`, error);
      throw error;
    }
  }
}
