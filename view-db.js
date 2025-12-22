#!/usr/bin/env node
/**
 * Скрипт для просмотра содержимого базы данных
 * Использование: node view-db.js [table_name]
 */

const pool = require('./dist/db/connection.js').default;

async function showDatabase() {
  try {
    console.log('=== Подключение к базе данных ===\n');

    // Список всех таблиц
    const tables = await pool.query(`
      SELECT 
        table_name,
        (SELECT COUNT(*) FROM information_schema.columns 
         WHERE table_name = t.table_name) as column_count
      FROM information_schema.tables t
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log('📊 Таблицы в базе данных:');
    console.log('─'.repeat(50));
    tables.rows.forEach(t => {
      console.log(`  • ${t.table_name.padEnd(30)} (${t.column_count} колонок)`);
    });
    console.log('');

    // Список всех VIEW
    const views = await pool.query(`
      SELECT view_name
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY view_name
    `);
    
    if (views.rows.length > 0) {
      console.log('👁️  VIEW в базе данных:');
      console.log('─'.repeat(50));
      views.rows.forEach(v => {
        console.log(`  • ${v.view_name}`);
      });
      console.log('');
    }

    // Данные из dim_source
    const sources = await pool.query('SELECT * FROM dim_source ORDER BY id');
    console.log('📋 dim_source:');
    console.log('─'.repeat(50));
    if (sources.rows.length > 0) {
      console.table(sources.rows);
    } else {
      console.log('  (пусто)');
    }
    console.log('');

    // Данные из dim_date (первые 10 и последние 10)
    const dateCount = await pool.query('SELECT COUNT(*) as cnt FROM dim_date');
    const dates = await pool.query('SELECT * FROM dim_date ORDER BY d LIMIT 10');
    console.log(`📅 dim_date (всего: ${dateCount.rows[0].cnt}, показано первых 10):`);
    console.log('─'.repeat(50));
    if (dates.rows.length > 0) {
      console.table(dates.rows);
    } else {
      console.log('  (пусто)');
    }
    console.log('');

    // Количество записей в fact таблицах
    console.log('📈 Количество записей в fact таблицах:');
    console.log('─'.repeat(50));
    
    const factLeads = await pool.query('SELECT COUNT(*) as cnt FROM fact_leads');
    const factJobs = await pool.query('SELECT COUNT(*) as cnt FROM fact_jobs');
    const factPayments = await pool.query('SELECT COUNT(*) as cnt FROM fact_payments');
    
    console.log(`  fact_leads:    ${factLeads.rows[0].cnt}`);
    console.log(`  fact_jobs:     ${factJobs.rows[0].cnt}`);
    console.log(`  fact_payments: ${factPayments.rows[0].cnt}`);
    console.log('');

    // Если есть данные, показать примеры
    if (parseInt(factLeads.rows[0].cnt) > 0) {
      const sampleLeads = await pool.query('SELECT lead_id, created_at, raw_source, cost FROM fact_leads ORDER BY created_at DESC LIMIT 5');
      console.log('📝 Примеры из fact_leads (последние 5):');
      console.log('─'.repeat(50));
      console.table(sampleLeads.rows);
      console.log('');
    }

    if (parseInt(factJobs.rows[0].cnt) > 0) {
      const sampleJobs = await pool.query('SELECT job_id, created_at, type, source_id FROM fact_jobs ORDER BY created_at DESC LIMIT 5');
      console.log('📝 Примеры из fact_jobs (последние 5):');
      console.log('─'.repeat(50));
      console.table(sampleJobs.rows);
      console.log('');
    }

    if (parseInt(factPayments.rows[0].cnt) > 0) {
      const samplePayments = await pool.query('SELECT payment_id, job_id, paid_at, amount FROM fact_payments ORDER BY paid_at DESC LIMIT 5');
      console.log('📝 Примеры из fact_payments (последние 5):');
      console.log('─'.repeat(50));
      console.table(samplePayments.rows);
      console.log('');
    }

    // Проверка VIEW
    try {
      const dailyMetrics = await pool.query('SELECT * FROM vw_daily_metrics ORDER BY d DESC LIMIT 5');
      if (dailyMetrics.rows.length > 0) {
        console.log('📊 Примеры из vw_daily_metrics (последние 5):');
        console.log('─'.repeat(50));
        console.table(dailyMetrics.rows);
        console.log('');
      }
    } catch (e) {
      console.log('⚠️  vw_daily_metrics: ' + e.message);
    }

    pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    pool.end();
    process.exit(1);
  }
}

showDatabase();





