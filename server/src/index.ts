import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as admin from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

// Initialize Firebase Admin
// Note: In local development, we use the FIREBASE_AUTH_EMULATOR_HOST or a service account key
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    databaseURL: process.env.VITE_FIREBASE_DATABASE_URL
  });
}

import authRouter from './auth';
import aiRouter from './ai';
import { verifySession, checkRole, logAdminAction } from './middleware';

const app = express();
const port = process.env.PORT || 4000;

// HTTPS Redirection Middleware
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    // Check if the request is already HTTPS (handle proxies like Firebase/Cloud Run)
    if (req.headers['x-forwarded-proto'] !== 'https' && !req.secure) {
      return res.redirect(`https://${req.get('host')}${req.url}`);
    }
    next();
  });
}

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://apis.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https://*.googleusercontent.com"],
      connectSrc: ["'self'", "https://*.firebaseio.com", "https://*.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.use(express.json());
app.use(cookieParser());

// Bot Detection Middleware
const botCheck = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const ua = req.headers['user-agent'] || '';
  const botPatterns = [
    /bot/i, /spider/i, /crawl/i, /headless/i, /phantom/i, /selenium/i, 
    /puppeteer/i, /node-fetch/i, /axios/i, /python/i, /curl/i
  ];
  
  if (botPatterns.some(pattern => pattern.test(ua))) {
    console.warn(`[BotBlocked] IP: ${req.ip}, UA: ${ua}, Path: ${req.originalUrl}`);
    return res.status(403).json({ error: 'Automated access is restricted.' });
  }
  next();
};

// Rate Limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  message: 'Too many requests from this IP, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    console.warn(`[RateLimit] Global limit exceeded for IP: ${req.ip} on ${req.originalUrl}`);
    res.status(options.statusCode).send(options.message);
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many authentication attempts, please try again after 15 minutes',
  handler: (req, res, next, options) => {
    console.warn(`[AuthLimit] Limit reached for IP: ${req.ip} on ${req.originalUrl}`);
    res.status(options.statusCode).send(options.message);
  },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'AI generation limit reached, please try again in an hour',
  handler: (req, res, next, options) => {
    console.warn(`[AILimit] Limit reached for IP: ${req.ip} on ${req.originalUrl}`);
    res.status(options.statusCode).send(options.message);
  },
});

app.use(botCheck);
app.use(globalLimiter);

// Routes
app.use('/auth', authLimiter, authRouter);
app.use('/ai', aiLimiter, aiRouter);

// Protected Admin Routes
app.use('/admin', verifySession, checkRole(['admin', 'moderator']), logAdminAction('Admin Access'), (req, res) => {
  res.status(200).json({ message: 'Welcome to the Secure Admin API' });
});

// Secure ICE Servers Proxy (Proxy for Metered TURN credentials)
app.get('/ice-servers', verifySession, async (req, res) => {
  try {
    const domain = process.env.METERED_DOMAIN;
    const apiKey = process.env.METERED_API_KEY;
    
    if (!domain || !apiKey) {
      console.error('[ICE] Metered configuration missing in environment');
      return res.status(500).json({ error: 'ICE configuration missing' });
    }

    const response = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${apiKey}`);
    if (!response.ok) {
      throw new Error(`Metered API responded with ${response.status}`);
    }
    
    const servers = await response.json();
    res.status(200).json(servers);
  } catch (error) {
    console.error('[ICE Error]:', error);
    res.status(500).json({ error: 'Failed to fetch connectivity credentials' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const errorId = Math.random().toString(36).substring(7);
  console.error(`[API Error ${errorId}] ${req.method} ${req.path}:`, {
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? 'MASKED' : err.stack,
    ip: req.ip,
    uid: (req as any).user?.uid
  });
  
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    id: errorId,
    message: process.env.NODE_ENV === 'production' ? undefined : err.message
  });
});

// Start Server
app.listen(port, () => {
  console.log(`Security Backend running at http://localhost:${port} [${process.env.NODE_ENV || 'development'}]`);
});

export default app;
