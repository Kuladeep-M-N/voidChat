import { Request, Response, Router } from 'express';
import * as admin from 'firebase-admin';
import { validateString, sanitize, handleValidationError } from './validation';
import { verifySession, checkRole } from './middleware';

const router = Router();

// Session expiration: 30 minutes
const expiresIn = 30 * 60 * 1000;

router.post('/login', async (req: Request, res: Response) => {
  const { idToken } = req.body;
  const ip = req.ip;

  // Validation
  const tokenError = validateString(idToken, 'ID Token', { required: true, minLength: 20 });
  if (tokenError) return handleValidationError(res, [tokenError]);

  try {
    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    const options = { 
      maxAge: expiresIn, 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production', 
      sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const 
    };

    res.cookie('session', sessionCookie, options);
    console.info(`[AuthSuccess] Login for User: ${decodedToken.uid} from IP: ${ip}`);
    res.status(200).json({ status: 'success' });
  } catch (error: any) {
    console.warn(`[AuthFailure] Login failed from IP: ${ip}. Error: ${error.message}`);
    res.status(401).send('Unauthorized');
  }
});

router.post('/signup', async (req: Request, res: Response) => {
  const { realUsername, anonymousUsername, password } = req.body;
  const ip = req.ip;

  // Strict Validation
  const errors: string[] = [];
  const realError = validateString(realUsername, 'Real Username', { required: true, minLength: 3, maxLength: 30 });
  const anonError = validateString(anonymousUsername, 'Anonymous Username', { required: true, minLength: 3, maxLength: 30 });
  const passError = validateString(password, 'Password', { required: true, minLength: 8, maxLength: 100 });

  if (realError) errors.push(realError);
  if (anonError) errors.push(anonError);
  if (passError) errors.push(passError);

  if (errors.length > 0) return handleValidationError(res, errors);

  try {
    const sanitizedReal = sanitize(realUsername);
    const sanitizedAnon = sanitize(anonymousUsername);
    const virtualEmail = `${sanitizedReal.toLowerCase().replace(/[^a-z0-9]/g, '')}@voidchat.internal`;

    // 0. Check if names are taken in Firestore (Case-insensitive for real_username)
    const db = admin.firestore();
    const [anonCheck, realCheck] = await Promise.all([
      db.collection('users').where('anonymous_username', '==', sanitizedAnon).limit(1).get(),
      db.collection('users').where('real_username_lower', '==', sanitizedReal.toLowerCase()).limit(1).get()
    ]);

    if (!anonCheck.empty) {
      return res.status(400).json({ error: 'Anonymous name taken. Try another!' });
    }
    if (!realCheck.empty) {
      return res.status(400).json({ error: 'Username taken. Try another!' });
    }

    // 1. Create User in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email: virtualEmail,
      password: password,
      displayName: sanitizedReal,
    });

    // 2. Parallelize: Set Custom Claims, Firestore profile, and Create Custom Token (with embedded claims)
    // This removes 2 sequential network roundtrips.
    const [customToken] = await Promise.all([
      admin.auth().createCustomToken(userRecord.uid, { role: 'user' }),
      admin.auth().setCustomUserClaims(userRecord.uid, { role: 'user' }),
      db.collection('users').doc(userRecord.uid).set({
        id: userRecord.uid,
        anonymous_username: sanitizedAnon,
        real_username: sanitizedReal,
        real_username_lower: sanitizedReal.toLowerCase(), // Store lowercase for fast case-insensitive checks
        joined_at: admin.firestore.FieldValue.serverTimestamp(),
        role: 'user'
      })
    ]);

    console.info(`[AuthSuccess] Signup for User: ${userRecord.uid} (${sanitizedReal}) from IP: ${ip}`);
    res.status(201).json({ status: 'success', uid: userRecord.uid, customToken });
  } catch (error: any) {
    console.warn(`[AuthFailure] Signup failed from IP: ${ip}. Error: ${error.message} (Code: ${error.code})`);
    
    // Comprehensive mapping for Firebase email/user errors
    if (error.code === 'auth/email-already-exists' || 
        error.code === 'auth/uid-already-exists' || 
        error.message?.toLowerCase().includes('already in use') || 
        error.message?.toLowerCase().includes('already exists')) {
      return res.status(400).json({ error: 'Username taken. Try another!' });
    }
    
    res.status(400).json({ error: error.message });
  }
});

router.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('session');
  res.status(200).json({ status: 'success' });
});

router.get('/session', async (req: Request, res: Response) => {
  const sessionCookie = req.cookies.session || '';

  try {
    const decodedClaims = await admin.auth().verifySessionCookie(sessionCookie, true);
    res.status(200).json(decodedClaims);
  } catch (error) {
    res.status(401).send('Unauthorized');
  }
});

router.delete('/users/:uid', verifySession, checkRole(['admin']), async (req: Request, res: Response) => {
  const uid = req.params.uid as string;
  const ip = req.ip as string;

  try {
    // 1. Check if target is admin (Safety check)
    const targetUser = await admin.auth().getUser(uid);
    if (targetUser.customClaims?.role === 'admin') {
      return res.status(403).json({ error: 'Cannot delete administrative accounts via API.' });
    }

    // 2. Revoke Refresh Tokens (Force Logout)
    await admin.auth().revokeRefreshTokens(uid);

    // 3. Delete from Firebase Auth
    await admin.auth().deleteUser(uid);

    // 4. Delete from Firestore
    const db = admin.firestore();
    await db.collection('users').doc(uid).delete();

    console.info(`[AuthSuccess] Deep Delete for User: ${uid} by Admin: ${(req as any).user?.uid} from IP: ${ip}`);
    res.status(200).json({ status: 'success', message: 'User fully purged and logged out.' });
  } catch (error: any) {
    console.error(`[AuthFailure] Deep Delete failed for User: ${uid}. Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

export default router;
