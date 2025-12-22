/**
 * Elocal Calls Service for Metrics Module
 * 
 * This service fetches calls from elocal.com and saves them to abc-metrics via API.
 * No direct database connections - all operations go through AbcMetricsClient.
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { parse } from 'csv-parse/sync';
import { AbcMetricsClient, AbcMetricsCall } from './abc-metrics-client';

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
  private abcMetricsClient: AbcMetricsClient;

  constructor() {
    this.username = process.env.ELOCAL_USERNAME || 'help@bostonmasters.com';
    this.password = process.env.ELOCAL_PASSWORD || 'Alga!B@r2';
    this.abcMetricsClient = new AbcMetricsClient();
  }

  /**
   * Get or create browser instance
   */
  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      const browserStartTime = Date.now();
      console.log(`[BROWSER] Launching Puppeteer browser...`);
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
      this.browser = await puppeteer.launch({
        headless: true,
        executablePath: executablePath,
        protocolTimeout: 600000, // 10 minutes timeout
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      });
      const browserTime = ((Date.now() - browserStartTime) / 1000).toFixed(2);
      console.log(`[BROWSER] Browser launched successfully (took ${browserTime}s)`);
    } else {
      console.log(`[BROWSER] Reusing existing browser instance`);
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
      
      await page.setDefaultNavigationTimeout(120000);
      await page.setDefaultTimeout(120000);
      
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
      
      const initialUrl = page.url();
      console.log(`[AUTH] Initial URL after navigation: ${initialUrl}`);
      if (!initialUrl.includes('/login')) {
        const authTime = ((Date.now() - authStartTime) / 1000).toFixed(2);
        console.log(`[AUTH] Already logged in (not on login page) (took ${authTime}s)`);
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      let passwordField = null;
      try {
        passwordField = await page.waitForSelector('input[type="password"]', { timeout: 20000 });
      } catch (error) {
        passwordField = await page.$('input[name="password"], input[id*="password"]').catch(() => null);
      }
      
      if (!passwordField) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const url = page.url();
        if (!url.includes('/login')) {
          const authTime = ((Date.now() - authStartTime) / 1000).toFixed(2);
          console.log(`[AUTH] Already logged in (no password field found, not on login page) (took ${authTime}s)`);
          return true;
        }
      }
      
      if (passwordField) {
        await passwordField.type(this.password, { delay: 100 });
      } else {
        await page.evaluate((password) => {
          const pwdInput = (globalThis as any).document?.querySelector('input[type="password"]');
          if (pwdInput) {
            pwdInput.value = password;
            pwdInput.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
          }
        }, this.password);
      }
      
      const urlBeforeSubmit = page.url();
      let submitted = false;
      let navigationOccurred = false;
      
      try {
        const submitInput = await page.$('input[type="submit"]');
        if (submitInput) {
          await submitInput.click();
          try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 180000 });
            navigationOccurred = true;
          } catch (navError: any) {
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          submitted = true;
        }
      } catch (e: any) {
        // Try button
      }
      
      if (!submitted) {
        try {
          const submitButton = await page.$('button[type="submit"]');
          if (submitButton) {
            await submitButton.click();
            try {
              await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 180000 });
              navigationOccurred = true;
            } catch (navError: any) {
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
            submitted = true;
          }
        } catch (e: any) {
          // Try Enter key
        }
      }
      
      if (!submitted) {
        await page.keyboard.press('Enter');
        try {
          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 180000 });
          navigationOccurred = true;
        } catch (navError: any) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      const currentUrl = page.url();
      const urlChanged = currentUrl !== urlBeforeSubmit;
      
      if (navigationOccurred || urlChanged) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      const pageContent = await page.content();
      const hasLoginElements = pageContent.includes('Log In') || pageContent.includes('Business User Log In') || currentUrl.includes('/login');
      const hasDashboardElements = pageContent.includes('dashboard') || pageContent.includes('calls') || pageContent.includes('business_users');
      
      const isLoggedIn = urlChanged && !currentUrl.includes('/login') && (!hasLoginElements || hasDashboardElements);
      
      const authTime = ((Date.now() - authStartTime) / 1000).toFixed(2);
      
      if (isLoggedIn) {
        console.log(`[AUTH] Authentication successful (took ${authTime}s)`);
        return true;
      } else {
        console.error(`[AUTH] Authentication failed (took ${authTime}s)`);
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
    console.log(`[FETCH] Starting fetchCallsCsv: start=${startDate}, end=${endDate}`);
    
    let browser: Browser | null = null;
    let page: Page | null = null;
    
    try {
      browser = await this.getBrowser();
      page = await browser.newPage();
      
      await page.setDefaultNavigationTimeout(180000);
      await page.setDefaultTimeout(180000);
      
      let authenticated = await this.authenticate(page);
      if (!authenticated) {
        if (page) {
          await page.close();
          page = null;
        }
        page = await browser.newPage();
        await page.setDefaultNavigationTimeout(180000);
        await page.setDefaultTimeout(180000);
        authenticated = await this.authenticate(page);
        
        if (!authenticated) {
          if (page) await page.close();
          throw new Error('Failed to authenticate with elocal.com after retry');
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const exportUrl = `https://www.elocal.com/business_users/calls/export/${ELOCAL_BUSINESS_ID}?start=${startDate}&end=${endDate}`;
      console.log(`[FETCH] Fetching CSV from export URL: ${exportUrl}`);
      
      const csvFetchStartTime = Date.now();
      const csvContent = await page.evaluate(async (url: string) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 120000);
          
          let response: Response;
          try {
            response = await fetch(url, {
              method: 'GET',
              credentials: 'include',
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeoutId);
          }
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const text = await response.text();
          
          if (text.trim().startsWith('<!DOCTYPE') || text.includes('<html')) {
            throw new Error('Received HTML instead of CSV');
          }
          
          return text;
        } catch (error: any) {
          if (error.name === 'AbortError') {
            throw new Error('Fetch timeout after 120 seconds');
          }
          throw new Error(`Failed to fetch CSV: ${error.message}`);
        }
      }, exportUrl);
      const csvFetchTime = ((Date.now() - csvFetchStartTime) / 1000).toFixed(2);

      if (csvContent.includes('Log In') || csvContent.includes('Business User Log In') || csvContent.trim().startsWith('<!DOCTYPE')) {
        throw new Error('Received login page instead of CSV - authentication may have expired');
      }

      if (!csvContent || csvContent.trim().length === 0) {
        throw new Error('Received empty CSV response');
      }
      
      const csvBytes = csvContent.length;
      const csvLines = csvContent.split('\n').length;
      const csvSizeKB = (csvBytes / 1024).toFixed(2);
      
      const csvLinesArray = csvContent.split('\n');
      const previewLines = csvLinesArray.slice(0, 3).join('\n');
      
      const fetchTime = ((Date.now() - fetchStartTime) / 1000).toFixed(2);
      console.log(`[FETCH] Received CSV: ${csvBytes} bytes (${csvSizeKB} KB), ~${csvLines} lines (took ${csvFetchTime}s, total ${fetchTime}s)`);
      console.log(`[FETCH] CSV preview (first 3 lines):\n${previewLines}`);

      return csvContent;
    } catch (error: any) {
      const fetchTime = ((Date.now() - fetchStartTime) / 1000).toFixed(2);
      console.error(`[FETCH] Error fetching calls CSV after ${fetchTime}s:`, {
        message: error.message,
        stack: error.stack?.substring(0, 500),
        url: page?.url() || 'unknown',
        errorName: error.name,
      });
      throw error;
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (closeError: any) {
          console.error(`[FETCH] Error closing page:`, closeError.message);
        }
      }
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
        const callId = record['Unique ID'] || record.call_id || record.id || record['Call ID'] || null;
        const callDate = record.Time || record.date || record.Date || record['Call Date'] || null;
        const duration = record.Duration || record.duration || record['Call Duration'] || null;
        const callType = record.Status || record.call_type || record.type || record.Type || null;

        if (!callId || !callDate) {
          const reason = !callId ? 'missing call_id' : 'missing date';
          skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
          continue;
        }

        let durationNum: number | undefined = undefined;
        if (duration) {
          if (typeof duration === 'number') {
            durationNum = duration;
          } else if (typeof duration === 'string') {
            const durationStr = duration.trim();
            if (durationStr.includes(':')) {
              const [mins, secs] = durationStr.split(':').map(Number);
              durationNum = (mins || 0) * 60 + (secs || 0);
            } else {
              durationNum = parseInt(durationStr, 10);
            }
          }
        }

        let normalizedDate = callDate;
        if (typeof callDate === 'string') {
          const dateObj = new Date(callDate);
          if (!isNaN(dateObj.getTime())) {
            normalizedDate = dateObj.toISOString().split('T')[0];
          } else {
            const dateMatch = callDate.match(/(\d{4})[-\/](\d{2})[-\/](\d{2})/);
            if (dateMatch) {
              normalizedDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
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
      console.log(`[PARSE] Parsed ${calls.length} calls from ${records.length} CSV rows (${skippedCount} skipped) (took ${parseTime}s)`);
      
      return calls;
    } catch (error) {
      console.error('[PARSE] Error parsing CSV:', error);
      throw error;
    }
  }

  /**
   * Convert ElocalCall to AbcMetricsCall format for API
   */
  private convertToApiFormat(call: ElocalCall): AbcMetricsCall {
    return {
      call_id: call.call_id,
      date: call.date,
      duration: call.duration,
      call_type: call.call_type,
      source: call.source,
    };
  }

  /**
   * Save calls to abc-metrics via API
   * Uses UPSERT to ensure idempotent syncs
   */
  async saveCalls(calls: ElocalCall[]): Promise<void> {
    if (!calls || calls.length === 0) {
      console.log('No calls to save');
      return;
    }

    try {
      // Convert to API format
      const apiCalls: AbcMetricsCall[] = calls
        .filter(call => call.call_id) // Filter out calls without ID
        .map(call => this.convertToApiFormat(call));

      if (apiCalls.length === 0) {
        console.warn('No valid calls to save after conversion');
        return;
      }

      console.log(`Saving ${apiCalls.length} calls to abc-metrics via API...`);
      
      // Save via API
      const result = await this.abcMetricsClient.saveCalls(apiCalls);
      
      if (result.success) {
        console.log(`Calls save summary: ${result.count || apiCalls.length} saved via API`);
      } else {
        console.error(`Error saving calls via API: ${result.error || 'Unknown error'}`);
        throw new Error(result.error || 'Failed to save calls via API');
      }
    } catch (error: any) {
      console.error('Error saving Elocal calls via API:', error);
      throw error;
    }
  }

  /**
   * Sync calls (fetch, parse and save)
   */
  async syncCalls(): Promise<void> {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const endDate = yesterday.toISOString().split('T')[0];

    const startDateObj = new Date(yesterday);
    startDateObj.setDate(startDateObj.getDate() - 29);
    const startDate = startDateObj.toISOString().split('T')[0];

    console.log(`Syncing Elocal calls: start=${startDate}, end=${endDate}`);
    
    const csvContent = await this.fetchCallsCsv(startDate, endDate);
    const calls = this.parseCallsCsv(csvContent);
    await this.saveCalls(calls);
    
    await this.closeBrowser();
  }
}



