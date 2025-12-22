/**
 * Metrics Module Entry Point
 * 
 * This module provides isolated metrics synchronization functionality
 * for rely-lead-processor. All data is saved to abc-metrics via API.
 */

import { Router } from 'express';
import metricsRoutes from './routes';
import { MetricsScheduler } from './scheduler';

export interface MetricsModule {
  routes: Router;
  scheduler: MetricsScheduler;
}

const routes = metricsRoutes;
const scheduler = new MetricsScheduler();

const metricsModule: MetricsModule = {
  routes,
  scheduler,
};

export default metricsModule;



