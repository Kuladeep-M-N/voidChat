import { Request, Response, Router } from 'express';
import * as admin from 'firebase-admin';
import sanitizeHtml from 'sanitize-html';

const router = Router();

// Session expiration: 30 minutes
const expiresIn = 30 * 60 * 1000;

// Helper to sanitize text
const sanitize = (text: string) => {
  return sanitizeHtml(text, {
    allowedTags: [],
    allowedAttributes: {},
  });
};

router.post('/login', async (req: Request, res: Response) => {
  const { idToken } = req.body;

  try {
    // Create session cookie
    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });
    
    // Set cookie options
    const options = { 
      maxAge: expiresIn, 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production', 
      sameSite: 'strict' as const 
    };

    res.cookie('session', sessionCookie, options);
    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).send('Unauthorized');
  }
});

router.post('/signup', async (req: Request, res: Response) => {
  const { realUsername, anonymousUsername, password } = req.body;

  try {
    const sanitizedReal = sanitize(realUsername);
    const sanitizedAnon = sanitize(anonymousUsername);
    const virtualEmail = `${sanitizedReal.toLowerCase()}@voidchat.internal`;

    // 1. Create User in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email: virtualEmail,
      password: password,
      displayName: sanitizedReal,
    });

    // 2. Set Custom Claims (Default role: user)
    await admin.auth().setCustomUserClaims(userRecord.uid, { role: 'user' });

    // 3. Create Firestore profile (exclude password)
    const db = admin.firestore();
    await db.collection('users').doc(userRecord.uid).set({
      id: userRecord.uid,
      anonymous_username: sanitizedAnon,
      real_username: sanitizedReal,
      joined_at: admin.firestore.FieldValue.serverTimestamp(),
      role: 'user'
    });

    res.status(201).json({ status: 'success', uid: userRecord.uid });
  } catch (error: any) {
    console.error('Signup error:', error);
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

export default router;
