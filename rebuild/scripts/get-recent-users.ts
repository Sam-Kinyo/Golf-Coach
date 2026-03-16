import 'dotenv/config';
import { initFirebase } from '../src/config/firebase';
import { getFirestore } from 'firebase-admin/firestore';

async function main() {
  initFirebase();
  const db = getFirestore();
  const usersRef = db.collection('users').orderBy('updatedAt', 'desc').limit(5);
  const snapshot = await usersRef.get();
  
  snapshot.forEach(doc => {
    console.log(`User ID: ${doc.id}, Name: ${doc.data().displayName}`);
  });
}

main().catch(console.error);
