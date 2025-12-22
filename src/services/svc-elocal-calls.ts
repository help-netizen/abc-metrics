import puppeteer, { Browser, Page } from 'puppeteer';
import { parse } from 'csv-parse/sync';

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
      const browserStartTime = Date.now();
      console.log(`[BROWSER] Launching Puppeteer browser...`);
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
      this.browser = await puppeteer.launch({
        headless: true,
        executablePath: executablePath,
        protocolTimeout: 600000, // 10 minutes timeout for network operations (increased due to slow network)
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
      
      // Navigate to login page with increased timeout
      await page.setDefaultNavigationTimeout(120000); // 2 minutes
      await page.setDefaultTimeout(120000); // 2 minutes
      
      const navStartTime = Date.now();
      console.log(`[AUTH] Starting navigation (timeout: 120s)...`);
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
      const navTime = ((Date.now() - navStartTime) / 1000).toFixed(2);
      console.log(`[AUTH] Navigation completed (took ${navTime}s)`);
      
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
      
      // Submit form and wait for navigation explicitly
      // Save current URL to check if navigation occurred
      const urlBeforeSubmit = page.url();
      console.log(`[AUTH] Current URL before submit: ${urlBeforeSubmit}`);
      
      // Try to submit form
      let submitted = false;
      let navigationOccurred = false;
      
      // Try input[type="submit"]
      try {
        const submitInput = await page.$('input[type="submit"]');
        if (submitInput) {
          console.log('[AUTH] Submitting form using input[type="submit"]');
          // Click first, then wait for navigation
          await submitInput.click();
          
          // Wait for navigation with increased timeout (3 minutes)
          try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 180000 });
            navigationOccurred = true;
            console.log('[AUTH] Navigation occurred after submit');
          } catch (navError: any) {
            console.warn(`[AUTH] Navigation timeout after submit: ${navError.message}`);
            // Wait a bit more to see if page is still loading
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          submitted = true;
        }
      } catch (e: any) {
        console.warn(`[AUTH] Error with input[type="submit"]: ${e.message}`);
      }
      
      // Try button[type="submit"]
      if (!submitted) {
        try {
          const submitButton = await page.$('button[type="submit"]');
          if (submitButton) {
            console.log('[AUTH] Submitting form using button[type="submit"]');
            await submitButton.click();
            
            try {
              await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 180000 });
              navigationOccurred = true;
              console.log('[AUTH] Navigation occurred after submit');
            } catch (navError: any) {
              console.warn(`[AUTH] Navigation timeout after submit: ${navError.message}`);
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
            submitted = true;
          }
        } catch (e: any) {
          console.warn(`[AUTH] Error with button[type="submit"]: ${e.message}`);
        }
      }
      
      // Try pressing Enter on password field
      if (!submitted) {
        try {
          console.log('[AUTH] Submitting form using Enter key');
          await page.keyboard.press('Enter');
          
          try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 180000 });
            navigationOccurred = true;
            console.log('[AUTH] Navigation occurred after Enter');
          } catch (navError: any) {
            console.warn(`[AUTH] Navigation timeout after Enter: ${navError.message}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          submitted = true;
        } catch (e: any) {
          console.warn(`[AUTH] Error with Enter key: ${e.message}`);
        }
      }
      
      // Check if navigation occurred by comparing URLs
      const currentUrl = page.url();
      const urlChanged = currentUrl !== urlBeforeSubmit;
      console.log(`[AUTH] URL after submit: ${currentUrl}, changed: ${urlChanged}, navigation occurred: ${navigationOccurred}`);
      
      // Additional wait for page to fully load if navigation occurred
      if (navigationOccurred || urlChanged) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // Check if login was successful with detailed validation
      const pageContent = await page.content();
      const hasLoginElements = pageContent.includes('Log In') || pageContent.includes('Business User Log In') || currentUrl.includes('/login');
      const hasDashboardElements = pageContent.includes('dashboard') || pageContent.includes('calls') || pageContent.includes('business_users');
      
      // More strict check: URL must have changed AND must not be on login page
      const isLoggedIn = urlChanged && !currentUrl.includes('/login') && (!hasLoginElements || hasDashboardElements);
      
      const authTime = ((Date.now() - authStartTime) / 1000).toFixed(2);
      
      if (isLoggedIn) {
        console.log(`[AUTH] Authentication successful (took ${authTime}s)`);
        console.log(`[AUTH] Final URL: ${currentUrl}`);
        return true;
      } else {
        console.error(`[AUTH] Authentication failed (took ${authTime}s)`);
        console.error(`[AUTH] URL changed: ${urlChanged}, Current URL: ${currentUrl}`);
        console.error(`[AUTH] Has login elements: ${hasLoginElements}, Has dashboard elements: ${hasDashboardElements}`);
        console.error(`[AUTH] Navigation occurred: ${navigationOccurred}`);
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
      // Get browser instance with detailed timing
      const browserStartTime = Date.now();
      console.log(`[FETCH] Getting browser instance...`);
      browser = await this.getBrowser();
      const browserTime = ((Date.now() - browserStartTime) / 1000).toFixed(2);
      console.log(`[FETCH] Browser instance obtained (took ${browserTime}s)`);
      
      // Create new page with detailed timing
      const pageStartTime = Date.now();
      console.log(`[FETCH] Creating new page...`);
      page = await browser.newPage();
      const pageTime = ((Date.now() - pageStartTime) / 1000).toFixed(2);
      console.log(`[FETCH] Page created (took ${pageTime}s)`);
      
      // Set increased timeouts for network operations
      await page.setDefaultNavigationTimeout(180000); // 3 minutes
      await page.setDefaultTimeout(180000); // 3 minutes
      console.log(`[FETCH] Timeouts set: navigation=180s, default=180s`);
      
      console.log(`[FETCH] Starting authentication...`);
      
      // First, authenticate - retry once if session expired
      const authStartTime = Date.now();
      let authenticated = await this.authenticate(page);
      const authTime = ((Date.now() - authStartTime) / 1000).toFixed(2);
      console.log(`[FETCH] Authentication completed (took ${authTime}s, success=${authenticated})`);
      if (!authenticated) {
        console.warn('[FETCH] Initial authentication failed, retrying with fresh page...');
        if (page) {
          await page.close();
          page = null;
        }
        const retryPageStartTime = Date.now();
        page = await browser.newPage();
        await page.setDefaultNavigationTimeout(180000);
        await page.setDefaultTimeout(180000);
        const retryPageTime = ((Date.now() - retryPageStartTime) / 1000).toFixed(2);
        console.log(`[FETCH] Retry page created (took ${retryPageTime}s)`);
        
        const retryAuthStartTime = Date.now();
        authenticated = await this.authenticate(page);
        const retryAuthTime = ((Date.now() - retryAuthStartTime) / 1000).toFixed(2);
        console.log(`[FETCH] Retry authentication completed (took ${retryAuthTime}s, success=${authenticated})`);
        
        if (!authenticated) {
          if (page) await page.close();
          throw new Error('Failed to authenticate with elocal.com after retry');
        }
        console.log('[FETCH] Authentication successful on retry');
      }

      // Wait for navigation to complete after authentication
      console.log(`[FETCH] Waiting 2s for page to stabilize after auth...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get export URL
      const exportUrl = `https://www.elocal.com/business_users/calls/export/${ELOCAL_BUSINESS_ID}?start=${startDate}&end=${endDate}`;
      console.log(`[FETCH] Preparing to fetch CSV from export URL: ${exportUrl}`);
      
      const csvFetchStartTime = Date.now();
      console.log(`[FETCH] Starting page.evaluate with fetch (timeout: 120s)...`);
      
      // Use page.evaluate to fetch CSV using browser's fetch API (with cookies)
      // Add explicit timeout for fetch operation
      // Wrap in Promise.race to ensure we timeout even if page.evaluate hangs
      const evaluatePromise = page.evaluate(async (url: string) => {
        try {
          // Create AbortController with 2 minute timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 120000);
          
          let response: Response;
          try {
            response = await fetch(url, {
              method: 'GET',
              credentials: 'include', // Include cookies
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeoutId);
          }
          
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
          if (error.name === 'AbortError') {
            throw new Error('Fetch timeout after 120 seconds');
          }
          throw new Error(`Failed to fetch CSV: ${error.message}`);
        }
      }, exportUrl);
      
      // Add external timeout for page.evaluate to prevent indefinite hanging
      // This ensures we don't wait forever if page.evaluate hangs at protocol level
      const evaluateTimeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => {
          reject(new Error('page.evaluate timeout after 180 seconds - operation may have hung at protocol level'));
        }, 180000); // 3 minutes external timeout
      });
      
      console.log(`[FETCH] Waiting for fetch to complete (with 180s external timeout)...`);
      const csvContent = await Promise.race([evaluatePromise, evaluateTimeoutPromise]);
      const csvFetchTime = ((Date.now() - csvFetchStartTime) / 1000).toFixed(2);
      console.log(`[FETCH] Fetch completed (took ${csvFetchTime}s)`);

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
          console.log(`[FETCH] Closing page...`);
          await page.close();
          console.log(`[FETCH] Page closed`);
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

}
