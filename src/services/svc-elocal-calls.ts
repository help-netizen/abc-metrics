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
      this.browser = await puppeteer.launch({
        headless: true,
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
    try {
      console.log('Authenticating with elocal.com using Puppeteer...');
      
      const loginUrl = `https://www.elocal.com/business_users/login?manual_login=true&username=${encodeURIComponent(this.username)}`;
      
      // Navigate to login page
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      // Check if we're already logged in
      const initialUrl = page.url();
      if (!initialUrl.includes('/login')) {
        console.log('Already logged in (not on login page)');
        return true;
      }
      
      // Wait for password input field or check if already logged in
      try {
        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
      } catch (error) {
        // If password field not found, check if we're already logged in
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait a bit
        const url = page.url();
        if (!url.includes('/login')) {
          console.log('Already logged in (no password field found, not on login page)');
          return true;
        }
        // Check page content to see if it's a login page
        const hasPasswordField = await page.$('input[type="password"]').catch(() => null);
        if (!hasPasswordField && !url.includes('/login')) {
          console.log('Already logged in (no password field, redirected away from login)');
          return true;
        }
        console.warn('Password field not found, but still on login page. URL:', url);
        // Continue anyway, might be a different login form
      }
      
      // Fill in password
      await page.type('input[type="password"]', this.password);
      
      // Submit form - try to find and click submit button, otherwise press Enter
      let submitted = false;
      
      // Try input[type="submit"]
      const submitInput = await page.$('input[type="submit"]').catch(() => null);
      if (submitInput) {
        await submitInput.click();
        submitted = true;
      }
      
      // Try button[type="submit"]
      if (!submitted) {
        const submitButton = await page.$('button[type="submit"]').catch(() => null);
        if (submitButton) {
          await submitButton.click();
          submitted = true;
        }
      }
      
      // Try any button that might be a submit button
      if (!submitted) {
        const anyButton = await page.$('form button, button').catch(() => null);
        if (anyButton) {
          await anyButton.click();
          submitted = true;
        }
      }
      
      // If no button found, press Enter
      if (!submitted) {
        await page.keyboard.press('Enter');
      }
      
      // Wait for navigation or dashboard
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
        new Promise(resolve => setTimeout(resolve, 3000)), // Give it 3 seconds if no navigation
      ]).catch(() => {
        // Navigation might not happen, check if we're logged in
      });
      
      // Check if login was successful by looking for login page elements or dashboard
      const currentUrl = page.url();
      const pageContent = await page.content();
      
      const isLoggedIn = !currentUrl.includes('/login') || 
                        pageContent.includes('dashboard') ||
                        pageContent.includes('calls') ||
                        !pageContent.includes('Log In');
      
      if (isLoggedIn) {
        console.log('Authentication successful');
        return true;
      } else {
        console.error('Authentication failed - still on login page');
        return false;
      }
    } catch (error: any) {
      console.error('Error during authentication:', error.message);
      return false;
    }
  }

  /**
   * Fetch calls CSV from elocal.com export endpoint using Puppeteer
   */
  async fetchCallsCsv(startDate: string, endDate: string): Promise<string> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    
    try {
      console.log(`Fetching calls CSV from elocal.com: start=${startDate}, end=${endDate}`);
      
      // First, authenticate
      const authenticated = await this.authenticate(page);
      if (!authenticated) {
        throw new Error('Failed to authenticate with elocal.com');
      }

      // Wait for navigation to complete after authentication
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get export URL
      const exportUrl = `https://www.elocal.com/business_users/calls/export/${ELOCAL_BUSINESS_ID}?start=${startDate}&end=${endDate}`;
      console.log(`Fetching CSV from export URL: ${exportUrl}`);
      
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

      // Check if we got HTML login page instead of CSV
      if (csvContent.includes('Log In') || csvContent.includes('Business User Log In') || csvContent.trim().startsWith('<!DOCTYPE')) {
        throw new Error('Received login page instead of CSV - authentication may have expired');
      }

      if (!csvContent || csvContent.trim().length === 0) {
        throw new Error('Received empty CSV response');
      }
      
      console.log(`Received CSV content (${csvContent.length} characters)`);
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
      return [];
    }

    try {
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      const calls: ElocalCall[] = [];

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
          console.warn('Skipping call record missing required fields:', record);
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

      console.log(`Parsed ${calls.length} calls from CSV`);
      return calls;
    } catch (error) {
      console.error('Error parsing CSV:', error);
      throw error;
    }
  }

  /**
   * Save calls to database
   * Uses ON CONFLICT DO UPDATE to ensure idempotent syncs - can run hourly without duplicates
   */
  async saveCalls(calls: ElocalCall[]): Promise<void> {
    if (calls.length === 0) {
      console.log('No calls to save');
      return;
    }

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      let savedCount = 0;
      let skippedCount = 0;
      const errors: Array<{ callId: string; error: string }> = [];

      for (const call of calls) {
        try {
          if (!call.call_id || !call.date) {
            console.warn('Skipping call missing required fields:', call);
            skippedCount++;
            continue;
          }

          if (savedCount < 3) {
            console.log(`Saving call: id=${call.call_id}, date=${call.date}, duration=${call.duration}`);
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
          console.error(`Error saving call ${call.call_id}:`, dbError.message);
          errors.push({ callId: call.call_id, error: dbError.message });
          skippedCount++;
        }
      }

      await client.query('COMMIT');
      
      console.log(`Calls save summary: ${savedCount} saved, ${skippedCount} skipped`);
      if (errors.length > 0) {
        console.warn(`Errors encountered:`, errors.slice(0, 10));
      }
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error saving elocal calls:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Sync calls (fetch, parse, and save)
   */
  async syncCalls(): Promise<void> {
    try {
      // Calculate date range: last 30 days, excluding today
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const endDate = yesterday.toISOString().split('T')[0];
      
      const startDateObj = new Date(yesterday);
      startDateObj.setDate(startDateObj.getDate() - 29); // 30 days total (including yesterday)
      const startDate = startDateObj.toISOString().split('T')[0];

      console.log(`Syncing elocal calls: start=${startDate}, end=${endDate}`);

      // Fetch CSV using Puppeteer
      const csvContent = await this.fetchCallsCsv(startDate, endDate);
      
      if (!csvContent || csvContent.trim().length === 0) {
        console.log('No CSV content received, skipping save');
        return;
      }

      // Parse CSV
      const calls = this.parseCallsCsv(csvContent);
      
      // Save to database
      await this.saveCalls(calls);
      
      console.log('Elocal calls sync completed successfully');
    } catch (error) {
      console.error('Error syncing elocal calls:', error);
      throw error;
    }
  }
}
