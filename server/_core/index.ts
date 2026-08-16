import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { initSocketServer } from "../socketServer";
import { verifyMercadoPagoWebhookSignature } from "../mercadopago";
import { registerStorageProxy } from "./storageProxy";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Mercado Pago Pix webhook for payment notifications
  app.post('/api/webhooks/mercadopago', async (req, res) => {
    try {
      const mpSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
      const dataId = (req.query as Record<string, unknown>)['data.id'] ?? req.body?.data?.id;
      const hasValidSignature = verifyMercadoPagoWebhookSignature({
        signature: req.headers['x-signature'],
        requestId: req.headers['x-request-id'],
        dataId,
        secret: mpSecret,
      });
      if (mpSecret && !hasValidSignature) {
        console.warn('[Webhook] Invalid Mercado Pago HMAC signature — rejecting request');
        return res.sendStatus(401);
      }
      if (!mpSecret) {
        if (process.env.NODE_ENV === 'production') {
          console.error('[Webhook] MERCADO_PAGO_WEBHOOK_SECRET is required in production');
          return res.sendStatus(503);
        }
        console.warn('[Webhook] MERCADO_PAGO_WEBHOOK_SECRET not set — development-only bypass');
      }

      const { type, data } = req.body;
      if (type === 'payment' && data?.id) {
        const { updatePixPaymentStatus } = await import('../db');
        const credited = await updatePixPaymentStatus(String(data.id), 'approved');
        if (credited) {
          console.log(`[Webhook] Pilas credited for payment ${data.id}`);
        }
      }
      res.sendStatus(200);
    } catch (error) {
      console.error('[Webhook] Error processing MP notification:', error);
      res.sendStatus(200); // Always return 200 to MP
    }
  });

  // Health check endpoint for monitoring
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory: process.memoryUsage().rss,
    });
  });

  // Initialize Socket.io for multiplayer
  initSocketServer(server);

  // Development uses Vite's history fallback; production serves dist/public and
  // falls back to client/index.html only for non-API routes. Socket.IO remains
  // isolated under /api/socketio and is never handled by the SPA fallback.
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
