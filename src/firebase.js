import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const app = initializeApp({
  apiKey: 'AIzaSyADJ_WVcrluSOzRcZlEQUvvD0vM_c_IWEQ',
  authDomain: 'compound-bank-it.firebaseapp.com',
  databaseURL: 'https://compound-bank-it-default-rtdb.firebaseio.com',
  projectId: 'compound-bank-it',
  storageBucket: 'compound-bank-it.firebasestorage.app',
  messagingSenderId: '729580549445',
  appId: '1:729580549445:web:b2f803c7cf17f601337a2c',
});

export const db = getDatabase(app);
