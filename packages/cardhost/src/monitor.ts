/**
 * Cardhost Monitor - Web UI for monitoring Cardhost status
 * Spec: docs/what-to-make.md (Section 3.4)
 * Refactor: Externalize HTML to monitor-ui.html and keep API routes lean
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

interface MonitorMetrics {
  uptime: number;
  apdusSent: number;
  apdusReceived: number;
  errorCount: number;
  lastActivityAt: string;
  cpuUsage: number;
  memoryUsage: number;
}

interface MonitorStatus {
  isRunning: boolean;
  isConnected: boolean;
  cardInserted: boolean;
  uuid: string;
  metrics: MonitorMetrics;
  sessionCount: number;
  logs: string[];
}

class CardHostMonitor {
  private metrics: MonitorMetrics;
  private isConnected = false;
  private cardInserted = false;
  private uuid: string;
  private logs: string[] = [];
  private maxLogs = 1000;
  private router: Router;
  private startTime: number;

  constructor(uuid: string) {
    this.uuid = uuid;
    this.router = Router();
    this.startTime = Date.now();
    this.metrics = {
      uptime: 0,
      apdusSent: 0,
      apdusReceived: 0,
      errorCount: 0,
      lastActivityAt: new Date().toISOString(),
      cpuUsage: 0,
      memoryUsage: 0
    };
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // GET /monitor/status - System status
    this.router.get('/status', (_req: Request, res: Response) => {
      res.json(this.getStatus());
    });

    // GET /monitor/metrics - Detailed metrics
    this.router.get('/metrics', (_req: Request, res: Response) => {
      res.json(this.metrics);
    });

    // GET /monitor/logs - Recent logs
    this.router.get('/logs', (req: Request, res: Response) => {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      res.json({
        logs: this.logs.slice(-limit),
        total: this.logs.length
      });
    });

    // POST /monitor/logs/clear - Clear logs
    this.router.post('/logs/clear', (_req: Request, res: Response) => {
      this.logs = [];
      res.json({ success: true });
    });

    // GET /monitor/health - Health check
    this.router.get('/health', (_req: Request, res: Response) => {
      const health = {
        healthy: this.isConnected && this.metrics.errorCount < 10,
        connected: this.isConnected,
        uptime: this.getUptime(),
        uuid: this.uuid
      };
      res.json(health);
    });

    // GET /monitor/ui - Serve external HTML UI
    this.router.get('/ui', async (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirnameLocal = dirname(__filename);
        const uiPath = join(__dirnameLocal, 'monitor-ui.html');
        const html = await readFile(uiPath, 'utf8');
        res.send(html);
      } catch (e) {
        res
          .status(500)
          .send('<!DOCTYPE html><html><body><h1>Monitor UI not found</h1><p>monitor-ui.html is missing.</p></body></html>');
      }
    });

    // GET /monitor - Redirect to UI
    this.router.get('/', (_req: Request, res: Response) => {
      res.redirect('/monitor/ui');
    });
  }

  private getStatus(): MonitorStatus {
    return {
      isRunning: true,
      isConnected: this.isConnected,
      cardInserted: this.cardInserted,
      uuid: this.uuid,
      metrics: this.metrics,
      sessionCount: 0,
      logs: this.logs.slice(-50)
    };
  }

  private getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  recordApduSent(): void {
    this.metrics.apdusSent++;
    this.updateActivity();
  }

  recordApduReceived(): void {
    this.metrics.apdusReceived++;
    this.updateActivity();
  }

  recordError(message: string): void {
    this.metrics.errorCount++;
    this.log(`ERROR: ${message}`, 'error');
    this.updateActivity();
  }

  recordCardInserted(): void {
    this.cardInserted = true;
    this.log('Card inserted');
  }

  recordCardRemoved(): void {
    this.cardInserted = false;
    this.log('Card removed');
  }

  setConnected(connected: boolean): void {
    this.isConnected = connected;
    if (connected) {
      this.log('Connected to Router');
    } else {
      this.log('Disconnected from Router');
    }
  }

  log(message: string, level = 'info'): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    this.logs.push(logEntry);

    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // eslint-disable-next-line no-console
    console.log(logEntry);
  }

  private updateActivity(): void {
    this.metrics.lastActivityAt = new Date().toISOString();
    // Optional telemetry sampling
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const memUsage = process.memoryUsage();
      this.metrics.memoryUsage = memUsage.heapUsed;
    }
    // Uptime update
    this.metrics.uptime = this.getUptime();
  }

  getRouter(): Router {
    return this.router;
  }
}

export { CardHostMonitor, MonitorStatus, MonitorMetrics };