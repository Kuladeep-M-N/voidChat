import { Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';

export interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken;
}

export const verifySession = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const sessionCookie = req.cookies.session || '';

  try {
    const decodedClaims = await admin.auth().verifySessionCookie(sessionCookie, true);
    req.user = decodedClaims;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized session' });
  }
};

export const checkRole = (roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userRole = req.user?.role;

    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }
    next();
  };
};

// Logging middleware (excluding sensitive data)
export const logAdminAction = (action: string) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.user?.role === 'admin' || req.user?.role === 'moderator') {
      const db = admin.firestore();
      await db.collection('admin_logs').add({
        admin_id: req.user.uid,
        action,
        url: req.originalUrl,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        // IP hashing for privacy
        ip_hash: admin.firestore.FieldValue.serverTimestamp() // Placeholder, use crypto for real hash
      });
    }
    next();
  };
};
