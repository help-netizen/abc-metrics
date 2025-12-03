import pool from '../db/connection';

export class AggregationService {
  /**
   * Determine segment from job type
   */
  private getSegment(type: string): string {
    if (type && type.includes('COD')) return 'COD';
    if (type && type.includes('INS')) return 'INS';
    return 'OTHER';
  }

  /**
   * Check if job is a Unit (Type IN ('COD Service', 'INS Service'))
   */
  private isUnit(type: string): boolean {
    return type === 'COD Service' || type === 'INS Service';
  }

  /**
   * Aggregate daily metrics by source and segment
   */
  async aggregateDailyMetrics(date: Date): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get all unique source/segment combinations for the date
      // Using fact_jobs with dim_source join
      const sourcesResult = await client.query(`
        SELECT DISTINCT 
          COALESCE(ds.code, 'Unknown') as source,
          CASE 
            WHEN fj.type LIKE '%COD%' THEN 'COD'
            WHEN fj.type LIKE '%INS%' THEN 'INS'
            ELSE 'OTHER'
          END as segment
        FROM fact_jobs fj
        LEFT JOIN dim_source ds ON fj.source_id = ds.id
        WHERE DATE(fj.created_at) = $1::date
        UNION
        SELECT DISTINCT 
          'elocals' as source,
          'OTHER' as segment
        FROM elocals_leads
        WHERE date = $1::date
        UNION
        SELECT DISTINCT 
          COALESCE(ds.code, 'Unknown') as source,
          'OTHER' as segment
        FROM fact_leads fl
        LEFT JOIN dim_source ds ON fl.source_id = ds.id
        WHERE DATE(fl.created_at) = $1::date
        UNION
        SELECT DISTINCT 
          'google' as source,
          'OTHER' as segment
        FROM google_spend
        WHERE date = $1::date
      `, [dateStr]);

      for (const row of sourcesResult.rows) {
        const source = row.source;
        const segment = row.segment;

        // Calculate metrics for this source/segment combination
        const metrics = await this.calculateDailyMetrics(dateStr, source, segment, client);

        // Insert or update daily metrics
        await client.query(`
          INSERT INTO daily_metrics (
            date, source, segment, leads, units, repairs,
            revenue_gross, revenue40, cost, profit, calls, google_spend, cpl, conv_l_to_r
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (date, source, segment)
          DO UPDATE SET
            leads = EXCLUDED.leads,
            units = EXCLUDED.units,
            repairs = EXCLUDED.repairs,
            revenue_gross = EXCLUDED.revenue_gross,
            revenue40 = EXCLUDED.revenue40,
            cost = EXCLUDED.cost,
            profit = EXCLUDED.profit,
            calls = EXCLUDED.calls,
            google_spend = EXCLUDED.google_spend,
            cpl = EXCLUDED.cpl,
            conv_l_to_r = EXCLUDED.conv_l_to_r,
            updated_at = CURRENT_TIMESTAMP
        `, [
          dateStr, source, segment,
          metrics.leads, metrics.units, metrics.repairs,
          metrics.revenue_gross, metrics.revenue40, metrics.cost, metrics.profit,
          metrics.calls, metrics.google_spend, metrics.cpl, metrics.conv_l_to_r
        ]);
      }

      await client.query('COMMIT');
      console.log(`Aggregated daily metrics for ${dateStr}`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`Error aggregating daily metrics for ${dateStr}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Calculate daily metrics for a specific date, source, and segment
   */
  private async calculateDailyMetrics(
    dateStr: string,
    source: string,
    segment: string,
    client: any
  ): Promise<any> {
    let leads = 0;
    let units = 0;
    let repairs = 0;
    let revenue_gross = 0;
    let revenue40 = 0;
    let cost = 0;
    let calls = 0;
    let google_spend = 0;

    // Get source_id for the source code
    const sourceIdResult = await client.query(
      'SELECT id FROM dim_source WHERE code = $1',
      [source]
    );
    const sourceId = sourceIdResult.rows[0]?.id || null;

    // Calculate leads by source
    if (source === 'elocals') {
      const result = await client.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(cost), 0) as total_cost
        FROM elocals_leads
        WHERE date = $1::date AND cost > 0
      `, [dateStr]);
      leads = parseInt(result.rows[0].count) || 0;
      cost = parseFloat(result.rows[0].total_cost) || 0;
    } else if (source === 'pro_referral') {
      // Pro Referral leads now come from fact_leads table
      const result = await client.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(cost), 0) as total_cost
        FROM fact_leads fl
        WHERE DATE(fl.created_at) = $1::date 
          AND fl.source_id = (SELECT id FROM dim_source WHERE code = 'pro_referral')
          AND fl.raw_source LIKE '%Pro Referral%'
      `, [dateStr]);
      leads = parseInt(result.rows[0].count) || 0;
      cost = parseFloat(result.rows[0].total_cost) || leads * 20; // $20 per lead if cost not set
    } else if (source === 'google') {
      // Google leads from fact_leads
      const result = await client.query(`
        SELECT COUNT(*) as count
        FROM fact_leads fl
        WHERE DATE(fl.created_at) = $1::date 
          AND fl.source_id = (SELECT id FROM dim_source WHERE code = 'google')
      `, [dateStr]);
      leads = parseInt(result.rows[0].count) || 0;
      
      const spendResult = await client.query(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM google_spend
        WHERE date = $1::date
      `, [dateStr]);
      google_spend = parseFloat(spendResult.rows[0].total) || 0;
      cost = google_spend;
    } else if (['rely', 'nsa', 'liberty', 'retention'].includes(source)) {
      // For these sources, leads = units (only those who reached service visit)
      if (sourceId) {
        const result = await client.query(`
          SELECT COUNT(DISTINCT CASE 
            WHEN fj.type IN ('COD Service', 'INS Service') THEN fj.job_id 
          END) as count
          FROM fact_jobs fj
          WHERE DATE(fj.created_at) = $1::date AND fj.source_id = $2
        `, [dateStr, sourceId]);
        leads = parseInt(result.rows[0].count) || 0;
      }
      cost = 0; // Free sources
    } else if (sourceId) {
      // Generic source from fact_leads
      const result = await client.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(cost), 0) as total_cost
        FROM fact_leads fl
        WHERE DATE(fl.created_at) = $1::date AND fl.source_id = $2
      `, [dateStr, sourceId]);
      leads = parseInt(result.rows[0].count) || 0;
      cost = parseFloat(result.rows[0].total_cost) || 0;
    }

    // Calculate units using VIEW vw_job_metrics
    if (sourceId) {
      const unitsResult = await client.query(`
        SELECT COUNT(DISTINCT job_id) as count
        FROM vw_job_metrics
        WHERE d = $1::date 
          AND source_id = $2
          AND is_unit = true
      `, [dateStr, sourceId]);
      units = parseInt(unitsResult.rows[0].count) || 0;
    }

    // Calculate repairs using VIEW vw_job_metrics
    if (sourceId) {
      const repairsResult = await client.query(`
        SELECT COUNT(DISTINCT job_id) as count
        FROM vw_job_metrics
        WHERE d = $1::date 
          AND source_id = $2
          AND is_repair = true
      `, [dateStr, sourceId]);
      repairs = parseInt(repairsResult.rows[0].count) || 0;
    }

    // Calculate revenue (gross and revenue40) using VIEW vw_job_metrics
    if (sourceId) {
      const revenueResult = await client.query(`
        SELECT 
          COALESCE(SUM(gross_revenue), 0) as gross,
          COALESCE(SUM(net_revenue), 0) as net
        FROM vw_job_metrics
        WHERE d = $1::date AND source_id = $2
      `, [dateStr, sourceId]);
      revenue_gross = parseFloat(revenueResult.rows[0].gross) || 0;
      revenue40 = parseFloat(revenueResult.rows[0].net) || 0;
    }

    // Calculate calls
    const callsResult = await client.query(`
      SELECT COUNT(*) as count
      FROM calls
      WHERE date = $1::date AND source = $2
    `, [dateStr, source]);
    calls = parseInt(callsResult.rows[0].count) || 0;

    // Calculate CPL (Cost Per Lead)
    const cpl = leads > 0 ? cost / leads : null;

    // Calculate Conv L→R (Conversion Leads to Repairs)
    const conv_l_to_r = leads > 0 ? repairs / leads : null;

    const profit = revenue40 - cost;

    return {
      leads,
      units,
      repairs,
      revenue_gross,
      revenue40,
      cost,
      profit,
      calls,
      google_spend,
      cpl,
      conv_l_to_r
    };
  }

  /**
   * Aggregate monthly metrics by source and segment
   */
  async aggregateMonthlyMetrics(monthDate: Date): Promise<void> {
    const monthStr = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
      .toISOString().split('T')[0];
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get all unique source/segment combinations for the month
      const sourcesResult = await client.query(`
        SELECT DISTINCT 
          COALESCE(ds.code, 'Unknown') as source,
          CASE 
            WHEN fj.type LIKE '%COD%' THEN 'COD'
            WHEN fj.type LIKE '%INS%' THEN 'INS'
            ELSE 'OTHER'
          END as segment
        FROM fact_jobs fj
        LEFT JOIN dim_source ds ON fj.source_id = ds.id
        WHERE DATE_TRUNC('month', fj.created_at) = $1::date
        UNION
        SELECT DISTINCT 
          'elocals' as source,
          'OTHER' as segment
        FROM elocals_leads
        WHERE DATE_TRUNC('month', date) = $1::date
        UNION
        SELECT DISTINCT 
          COALESCE(ds.code, 'Unknown') as source,
          'OTHER' as segment
        FROM fact_leads fl
        LEFT JOIN dim_source ds ON fl.source_id = ds.id
        WHERE DATE_TRUNC('month', fl.created_at) = $1::date
        UNION
        SELECT DISTINCT 
          'google' as source,
          'OTHER' as segment
        FROM google_spend
        WHERE DATE_TRUNC('month', date) = $1::date
      `, [monthStr]);

      for (const row of sourcesResult.rows) {
        const source = row.source;
        const segment = row.segment;

        // Calculate metrics for this source/segment combination
        const metrics = await this.calculateMonthlyMetrics(monthStr, source, segment, client);

        // Insert or update monthly metrics
        await client.query(`
          INSERT INTO monthly_metrics (
            month, source, segment, leads, units, repairs,
            revenue_gross, revenue40, cost, profit, calls, google_spend, cpl, conv_l_to_r
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (month, source, segment)
          DO UPDATE SET
            leads = EXCLUDED.leads,
            units = EXCLUDED.units,
            repairs = EXCLUDED.repairs,
            revenue_gross = EXCLUDED.revenue_gross,
            revenue40 = EXCLUDED.revenue40,
            cost = EXCLUDED.cost,
            profit = EXCLUDED.profit,
            calls = EXCLUDED.calls,
            google_spend = EXCLUDED.google_spend,
            cpl = EXCLUDED.cpl,
            conv_l_to_r = EXCLUDED.conv_l_to_r,
            updated_at = CURRENT_TIMESTAMP
        `, [
          monthStr, source, segment,
          metrics.leads, metrics.units, metrics.repairs,
          metrics.revenue_gross, metrics.revenue40, metrics.cost, metrics.profit,
          metrics.calls, metrics.google_spend, metrics.cpl, metrics.conv_l_to_r
        ]);
      }

      await client.query('COMMIT');
      console.log(`Aggregated monthly metrics for ${monthStr}`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`Error aggregating monthly metrics for ${monthStr}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Calculate monthly metrics for a specific month, source, and segment
   */
  private async calculateMonthlyMetrics(
    monthStr: string,
    source: string,
    segment: string,
    client: any
  ): Promise<any> {
    let leads = 0;
    let units = 0;
    let repairs = 0;
    let revenue_gross = 0;
    let revenue40 = 0;
    let cost = 0;
    let calls = 0;
    let google_spend = 0;

    // Get source_id for the source code
    const sourceIdResult = await client.query(
      'SELECT id FROM dim_source WHERE code = $1',
      [source]
    );
    const sourceId = sourceIdResult.rows[0]?.id || null;

    // Calculate leads by source
    if (source === 'elocals') {
      const result = await client.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(cost), 0) as total_cost
        FROM elocals_leads
        WHERE DATE_TRUNC('month', date) = $1::date AND cost > 0
      `, [monthStr]);
      leads = parseInt(result.rows[0].count) || 0;
      cost = parseFloat(result.rows[0].total_cost) || 0;
    } else if (source === 'pro_referral') {
      const result = await client.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(cost), 0) as total_cost
        FROM fact_leads fl
        WHERE DATE_TRUNC('month', fl.created_at) = $1::date
          AND fl.source_id = (SELECT id FROM dim_source WHERE code = 'pro_referral')
          AND fl.raw_source LIKE '%Pro Referral%'
      `, [monthStr]);
      leads = parseInt(result.rows[0].count) || 0;
      cost = parseFloat(result.rows[0].total_cost) || leads * 20; // $20 per lead if cost not set
    } else if (source === 'google') {
      const result = await client.query(`
        SELECT COUNT(*) as count
        FROM fact_leads fl
        WHERE DATE_TRUNC('month', fl.created_at) = $1::date 
          AND fl.source_id = (SELECT id FROM dim_source WHERE code = 'google')
      `, [monthStr]);
      leads = parseInt(result.rows[0].count) || 0;
      
      const spendResult = await client.query(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM google_spend
        WHERE DATE_TRUNC('month', date) = $1::date
      `, [monthStr]);
      google_spend = parseFloat(spendResult.rows[0].total) || 0;
      cost = google_spend;
    } else if (['rely', 'nsa', 'liberty', 'retention'].includes(source)) {
      if (sourceId) {
        const result = await client.query(`
          SELECT COUNT(DISTINCT CASE 
            WHEN fj.type IN ('COD Service', 'INS Service') THEN fj.job_id 
          END) as count
          FROM fact_jobs fj
          WHERE DATE_TRUNC('month', fj.created_at) = $1::date AND fj.source_id = $2
        `, [monthStr, sourceId]);
        leads = parseInt(result.rows[0].count) || 0;
      }
      cost = 0;
    } else if (sourceId) {
      const result = await client.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(cost), 0) as total_cost
        FROM fact_leads fl
        WHERE DATE_TRUNC('month', fl.created_at) = $1::date AND fl.source_id = $2
      `, [monthStr, sourceId]);
      leads = parseInt(result.rows[0].count) || 0;
      cost = parseFloat(result.rows[0].total_cost) || 0;
    }

    // Calculate units using VIEW vw_job_metrics
    if (sourceId) {
      const unitsResult = await client.query(`
        SELECT COUNT(DISTINCT job_id) as count
        FROM vw_job_metrics
        WHERE DATE_TRUNC('month', d) = $1::date 
          AND source_id = $2
          AND is_unit = true
      `, [monthStr, sourceId]);
      units = parseInt(unitsResult.rows[0].count) || 0;
    }

    // Calculate repairs using VIEW vw_job_metrics
    if (sourceId) {
      const repairsResult = await client.query(`
        SELECT COUNT(DISTINCT job_id) as count
        FROM vw_job_metrics
        WHERE DATE_TRUNC('month', d) = $1::date 
          AND source_id = $2
          AND is_repair = true
      `, [monthStr, sourceId]);
      repairs = parseInt(repairsResult.rows[0].count) || 0;
    }

    // Calculate revenue (gross and revenue40) using VIEW vw_job_metrics
    if (sourceId) {
      const revenueResult = await client.query(`
        SELECT 
          COALESCE(SUM(gross_revenue), 0) as gross,
          COALESCE(SUM(net_revenue), 0) as net
        FROM vw_job_metrics
        WHERE DATE_TRUNC('month', d) = $1::date AND source_id = $2
      `, [monthStr, sourceId]);
      revenue_gross = parseFloat(revenueResult.rows[0].gross) || 0;
      revenue40 = parseFloat(revenueResult.rows[0].net) || 0;
    }

    // Calculate calls
    const callsResult = await client.query(`
      SELECT COUNT(*) as count
      FROM calls
      WHERE DATE_TRUNC('month', date) = $1::date AND source = $2
    `, [monthStr, source]);
    calls = parseInt(callsResult.rows[0].count) || 0;

    // Calculate CPL and Conv L→R
    const cpl = leads > 0 ? cost / leads : null;
    const conv_l_to_r = leads > 0 ? repairs / leads : null;
    const profit = revenue40 - cost;

    return {
      leads,
      units,
      repairs,
      revenue_gross,
      revenue40,
      cost,
      profit,
      calls,
      google_spend,
      cpl,
      conv_l_to_r
    };
  }

  async aggregateAllDailyMetrics(): Promise<void> {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT DISTINCT date FROM (
          SELECT date FROM jobs
          UNION
          SELECT date FROM payments
          UNION
          SELECT date FROM calls
          UNION
          SELECT date FROM elocals_leads
          UNION
          SELECT DATE(created_at) as date FROM leads
          UNION
          SELECT date FROM google_spend
        ) AS all_dates
        ORDER BY date DESC
        LIMIT 90
      `);

      for (const row of result.rows) {
        await this.aggregateDailyMetrics(new Date(row.date));
      }
    } catch (error) {
      console.error('Error aggregating all daily metrics:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async aggregateAllMonthlyMetrics(): Promise<void> {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT DISTINCT DATE_TRUNC('month', date)::date as month
        FROM (
          SELECT date FROM jobs
          UNION
          SELECT date FROM payments
          UNION
          SELECT date FROM calls
          UNION
          SELECT date FROM elocals_leads
          UNION
          SELECT DATE(created_at) as date FROM leads
          UNION
          SELECT date FROM google_spend
        ) AS all_dates
        ORDER BY month DESC
        LIMIT 12
      `);

      for (const row of result.rows) {
        await this.aggregateMonthlyMetrics(new Date(row.month));
      }
    } catch (error) {
      console.error('Error aggregating all monthly metrics:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}
