import express from "express";
import { createServer } from "http";
import { createServer as createHttpsServer } from "https";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import os from "os";
import dns from "dns/promises";
import fs from "fs/promises";
import fsSync from "fs";
import { execFileSync } from "child_process";
import { createServer as createViteServer } from "vite";

const PROXY_TIMEOUT_MS = 120_000;
const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const SYNC_STATE_FILE = path.join(LOG_DIR, 'sync-state.json');

type LogLevel = 'info' | 'warning' | 'error' | 'critical';

interface LogEntry {
  time: string;
  level: LogLevel;
  context: string;
  message: string;
  technicalMessage?: string;
  stack?: string;
  status?: number;
  requestId?: string;
  source?: string;
}

interface LanCertificateInfo {
  ipAddress: string;
  certDir: string;
  certPath: string;
  keyPath: string;
  rootCertificatePath: string;
}

let logWriteQueue = Promise.resolve();

function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

function getProxyErrorStatus(message: string): number {
  if (/Missing|Invalid|private|must use/i.test(message)) return 400;
  if (/timed out|aborted/i.test(message)) return 504;
  return 502;
}

async function writeLogEntry(entry: LogEntry): Promise<void> {
  await fs.mkdir(LOG_DIR, { recursive: true });
  const line = JSON.stringify(entry) + '\n';
  logWriteQueue = logWriteQueue.then(() => fs.appendFile(LOG_FILE, line, 'utf8')).catch((error) => {
    console.error('[Log write failed]', error);
  });
  await logWriteQueue;
}

function queueLogEntry(entry: LogEntry): void {
  void writeLogEntry(entry);
}

async function loadSyncState(): Promise<Record<string, string>> {
  try {
    const text = await fs.readFile(SYNC_STATE_FILE, 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function saveSyncState(state: Record<string, string>): Promise<void> {
  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.writeFile(SYNC_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function getLanIPv4Addresses(): string[] {
  const addresses: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

function readLanCertificateInfo(certDir: string): LanCertificateInfo | null {
  const metadataPath = path.join(certDir, 'metadata.json');
  const certPath = path.join(certDir, 'lan-server.pem');
  const keyPath = path.join(certDir, 'lan-server-key.pem');
  const rootCertificatePath = path.join(certDir, 'phone-root-ca.cer');

  if (!fsSync.existsSync(metadataPath) || !fsSync.existsSync(certPath) || !fsSync.existsSync(keyPath) || !fsSync.existsSync(rootCertificatePath)) {
    return null;
  }

  try {
    const metadata = JSON.parse(fsSync.readFileSync(metadataPath, 'utf8'));
    if (typeof metadata?.ipAddress !== 'string' || !metadata.ipAddress) return null;
    return { ipAddress: metadata.ipAddress, certDir, certPath, keyPath, rootCertificatePath };
  } catch {
    return null;
  }
}

function findLanCertificateForCurrentIp(certRoot: string, lanAddresses: string[]): LanCertificateInfo | null {
  if (!fsSync.existsSync(certRoot)) return null;
  const entries = fsSync.readdirSync(certRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const info = readLanCertificateInfo(path.join(certRoot, entry.name));
    if (info && lanAddresses.includes(info.ipAddress)) return info;
  }
  return null;
}

function ensureLanCertificate(): LanCertificateInfo | null {
  const certRoot = path.join(process.cwd(), 'certs');
  fsSync.mkdirSync(certRoot, { recursive: true });

  const lanAddresses = getLanIPv4Addresses();
  if (lanAddresses.length === 0) return null;

  const existing = findLanCertificateForCurrentIp(certRoot, lanAddresses);
  if (existing) return existing;

  const scriptPath = path.join(process.cwd(), 'scripts', 'generate-lan-cert.mjs');
  if (!fsSync.existsSync(scriptPath)) return null;

  const ipAddress = lanAddresses[0];
  try {
    execFileSync(process.execPath, [scriptPath, '--ip', ipAddress, '--silent'], { stdio: 'ignore' });
  } catch (error) {
    console.error('[HTTPS cert generation failed]', error);
    return null;
  }

  return findLanCertificateForCurrentIp(certRoot, lanAddresses);
}

function handleServerListenError(error: NodeJS.ErrnoException, port: number, protocol: 'HTTP' | 'HTTPS'): void {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n[Fatal] ${protocol} 端口 ${port} 已被占用。`);
    console.error(`请先关闭正在运行的旧服务器窗口，或执行：`);
    console.error(`  netstat -ano | findstr :${port}`);
    console.error(`  taskkill /PID <上一步查到的PID> /F\n`);
    process.exitCode = 1;
    return;
  }

  console.error(`[Fatal] ${protocol} server listen error:`, error);
  process.exitCode = 1;
}

function isPrivateAddress(address: string): boolean {
  if (address === "::1" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) {
    return true;
  }

  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part))) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

async function validateProxyTarget(rawTargetUrl: unknown): Promise<string> {
  if (typeof rawTargetUrl !== "string" || !rawTargetUrl.trim()) {
    throw new Error("Missing x-target-url header");
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(rawTargetUrl);
  } catch {
    throw new Error("Invalid x-target-url header");
  }

  if (!["https:", "http:"].includes(targetUrl.protocol)) {
    throw new Error("Proxy target must use http or https");
  }

  const hostname = targetUrl.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || isPrivateAddress(hostname)) {
    throw new Error("Proxy target points to a private address");
  }

  const resolvedAddresses = await dns.lookup(hostname, { all: true, verbatim: false });
  if (!resolvedAddresses.length || resolvedAddresses.some(result => isPrivateAddress(result.address))) {
    throw new Error("Proxy target resolves to a private address");
  }

  return targetUrl.toString();
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
  const distPath = path.join(process.cwd(), 'dist');
  const shouldUseViteDevServer = process.env.NODE_ENV !== "production" && !fsSync.existsSync(path.join(distPath, 'index.html'));
  
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
      maxHttpBufferSize: 1e8,
      cors: {
          origin: "*"
      }
  });

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/log", async (req, res) => {
    try {
      const body = req.body ?? {};
      const entry: LogEntry = {
        time: new Date().toISOString(),
        level: ['info', 'warning', 'error', 'critical'].includes(body.level) ? body.level : 'error',
        context: String(body.context || 'unknown'),
        message: String(body.message || 'Unknown log message'),
        technicalMessage: body.technicalMessage ? String(body.technicalMessage) : undefined,
        stack: body.stack ? String(body.stack) : undefined,
        status: typeof body.status === 'number' ? body.status : undefined,
        requestId: body.requestId ? String(body.requestId) : undefined,
        source: body.source ? String(body.source) : 'client',
      };
      await writeLogEntry(entry);
      res.status(204).end();
    } catch (error) {
      console.error('[Log ingestion error]', error);
      res.status(500).json({ error: { message: 'Failed to write log entry' } });
    }
  });

  // Proxy route for custom OpenAI-compatible endpoints to bypass CORS
  app.post("/api/proxy", async (req, res) => {
    const requestId = createRequestId();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

    req.on('aborted', () => controller.abort());
    res.on('close', () => controller.abort());

    try {
      const targetUrl = await validateProxyTarget(req.headers['x-target-url']);
      
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Accept': req.body?.stream ? 'text/event-stream' : 'application/json',
          'Content-Type': 'application/json',
          'Authorization': String(req.headers['authorization'] || '')
        },
        body: JSON.stringify(req.body),
        signal: controller.signal
      });
      
      // If the target is streaming AND response is successful, stream it back
      if (req.body.stream && response.ok) {
        res.status(response.status);
        res.setHeader('Content-Type', response.headers.get('content-type') || 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        if (!response.body) {
            res.end();
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
        }
        res.end();
      } else {
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch(e) {
            data = { error: { message: "Failed to parse JSON response from target: " + response.status, text, requestId } };
        }
        res.status(response.status).json(data);
      }
    } catch (e: any) {
      const rawMessage = e?.name === 'AbortError' ? 'Proxy request timed out or was aborted' : getErrorMessage(e);
      const status = getProxyErrorStatus(rawMessage);
      const logEntry: LogEntry = {
        time: new Date().toISOString(),
        level: status >= 500 ? 'error' : 'warning',
        context: 'proxy',
        message: rawMessage,
        stack: e?.stack,
        status,
        requestId,
        source: 'server',
        technicalMessage: JSON.stringify({ target: req.headers['x-target-url'] }),
      };
      queueLogEntry(logEntry);
      console.error(`[Proxy error:${requestId}]`, {
        status,
        message: rawMessage,
        target: req.headers['x-target-url'],
        stack: e?.stack,
      });
      if (!res.headersSent) {
        res.status(status).json({ error: { message: rawMessage, requestId, status } });
      } else {
        res.end();
      }
    } finally {
      clearTimeout(timeout);
    }
  });

  // Socket.io for local network sync
  let serverState: Record<string, string> = await loadSyncState();
  let syncStateSaveTimer: NodeJS.Timeout | null = null;
  const scheduleSyncStateSave = () => {
      if (syncStateSaveTimer) clearTimeout(syncStateSaveTimer);
      syncStateSaveTimer = setTimeout(() => {
          syncStateSaveTimer = null;
          saveSyncState(serverState).catch((error) => {
              console.error('[Sync state save failed]', error);
          });
      }, 300);
  };

  io.on("connection", (socket) => {
      // Send current state to newly connected client
      socket.emit("sync_init", serverState);

      socket.on("sync_update", (data: { key: string, value: string | null }) => {
          if (data.value === null) {
              delete serverState[data.key];
          } else {
              serverState[data.key] = data.value;
          }
          scheduleSyncStateSave();
          // Broadcast to ALL OTHER clients
          socket.broadcast.emit("sync_update", data);
      });
      
      socket.on("sync_full", (data: Record<string, string>) => {
          serverState = { ...serverState, ...data };
          scheduleSyncStateSave();
          socket.broadcast.emit("sync_full", serverState);
      });
  });

  // Prefer the built PWA when dist exists so service-worker offline cache works on localhost.
  if (shouldUseViteDevServer) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use((req, res, next) => {
      if (req.path === '/sw.js') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Service-Worker-Allowed', '/');
      }
      if (req.path === '/manifest.webmanifest') {
        res.setHeader('Cache-Control', 'no-cache');
      }
      next();
    });
    app.use(express.static(distPath, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }));
    app.get('*all', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.on('error', (error: NodeJS.ErrnoException) => handleServerListenError(error, PORT, 'HTTP'));
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`\n> Local Server Running:    http://localhost:${PORT}`);
    console.log(`> Frontend Mode:           ${shouldUseViteDevServer ? 'Vite dev middleware (no production offline cache)' : 'Built PWA from dist'}`);
    
    // Attempt to discover local IP addresses
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log(`> Network/LAN Server:      http://${iface.address}:${PORT}`);
        }
      }
    }
    console.log();
  });

  const lanCertificate = process.env.HTTPS_PFX ? null : ensureLanCertificate();
  const httpsKeyPath = process.env.HTTPS_KEY || lanCertificate?.keyPath || path.join(process.cwd(), 'certs', 'localhost-key.pem');
  const httpsCertPath = process.env.HTTPS_CERT || lanCertificate?.certPath || path.join(process.cwd(), 'certs', 'localhost.pem');
  const httpsPfxPath = process.env.HTTPS_PFX || path.join(process.cwd(), 'certs', 'lan-server.pfx');
  const httpsPfxPasswordPath = path.join(process.cwd(), 'certs', 'lan-server-password.txt');
  const httpsOptions = httpsPfxPath && fsSync.existsSync(httpsPfxPath)
    ? {
        pfx: fsSync.readFileSync(httpsPfxPath),
        passphrase: process.env.HTTPS_PFX_PASSWORD || (fsSync.existsSync(httpsPfxPasswordPath) ? fsSync.readFileSync(httpsPfxPasswordPath, 'utf8').trim() : undefined),
      }
    : fsSync.existsSync(httpsKeyPath) && fsSync.existsSync(httpsCertPath)
      ? {
          key: fsSync.readFileSync(httpsKeyPath),
          cert: fsSync.readFileSync(httpsCertPath),
        }
      : null;

  if (httpsOptions) {
    const httpsServer = createHttpsServer(httpsOptions, app);
    io.attach(httpsServer);

    httpsServer.on('error', (error: NodeJS.ErrnoException) => handleServerListenError(error, HTTPS_PORT, 'HTTPS'));
    httpsServer.listen(HTTPS_PORT, "0.0.0.0", () => {
      console.log(`> HTTPS Local Server:     https://localhost:${HTTPS_PORT}`);
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
          if (iface.family === 'IPv4' && !iface.internal) {
            console.log(`> HTTPS LAN Server:       https://${iface.address}:${HTTPS_PORT}`);
          }
        }
      }
      if (lanCertificate) {
        console.log(`> HTTPS Cert Source:      ${path.relative(process.cwd(), lanCertificate.certPath)}`);
        console.log(`> Phone Root Cert:        ${path.relative(process.cwd(), lanCertificate.rootCertificatePath)}`);
      } else {
        console.log(`> HTTPS Cert Source:      ${fsSync.existsSync(httpsPfxPath) ? path.relative(process.cwd(), httpsPfxPath) : 'certs/localhost.pem or HTTPS_CERT/HTTPS_KEY'}`);
      }
      console.log();
    });
  } else {
    console.log('> HTTPS LAN Server:       disabled (auto certificate generation failed; run npm.cmd run cert:lan to inspect)');
    console.log();
  }
}

process.on('uncaughtException', (error) => {
  console.error('[Fatal] Uncaught exception:', error);
  queueLogEntry({
    time: new Date().toISOString(),
    level: 'critical',
    context: 'uncaughtException',
    message: getErrorMessage(error),
    stack: error instanceof Error ? error.stack : undefined,
    source: 'server',
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[Fatal] Unhandled rejection:', reason);
  queueLogEntry({
    time: new Date().toISOString(),
    level: 'critical',
    context: 'unhandledRejection',
    message: getErrorMessage(reason),
    source: 'server',
  });
});

startServer().catch((error) => {
  console.error('[Fatal] Failed to start server:', error);
  process.exitCode = 1;
});
