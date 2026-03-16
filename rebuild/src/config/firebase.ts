import admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { env } from './env';

let initialized = false;

export function initFirebase(): admin.firestore.Firestore {
  if (initialized) {
    return admin.firestore();
  }
  const credPath = path.resolve(process.cwd(), env.firebase.credentialPath);
  if (fs.existsSync(credPath)) {
    const key = require(credPath);
    admin.initializeApp({ credential: admin.credential.cert(key) });
  } else {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  initialized = true;
  return admin.firestore();
}

export function getDb(): admin.firestore.Firestore {
  return admin.firestore();
}

export { admin };
