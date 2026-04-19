import admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { env } from './env';

const STORAGE_BUCKET = 'golf-coach-aebcd-videos';

let initialized = false;

export function initFirebase(): admin.firestore.Firestore {
  if (initialized) {
    return admin.firestore();
  }
  const credPath = path.resolve(process.cwd(), env.firebase.credentialPath);
  if (fs.existsSync(credPath)) {
    const key = require(credPath);
    admin.initializeApp({ credential: admin.credential.cert(key), storageBucket: STORAGE_BUCKET });
  } else {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), storageBucket: STORAGE_BUCKET });
  }
  initialized = true;
  return admin.firestore();
}

export function getDb(): admin.firestore.Firestore {
  return admin.firestore();
}

export function getBucket() {
  return admin.storage().bucket();
}

export { admin };
