/**
 * Firebase app and Auth for the console. The same Firebase web app as the landlord app
 * (one project), on its own Hosting site. Public config comes from .env.local.
 * There is no emulator mode: the Auth emulator has no TOTP, and the rules need a
 * second factor, so the console only works against a real project (screens are T1-tested).
 */
import { type FirebaseOptions, initializeApp } from "firebase/app";
import { browserLocalPersistence, indexedDBLocalPersistence, initializeAuth } from "firebase/auth";

const env = import.meta.env;
const config: FirebaseOptions = {
  apiKey: env["VITE_FIREBASE_API_KEY"],
  authDomain: env["VITE_FIREBASE_AUTH_DOMAIN"],
  projectId: env["VITE_FIREBASE_PROJECT_ID"],
  storageBucket: env["VITE_FIREBASE_STORAGE_BUCKET"],
  appId: env["VITE_FIREBASE_APP_ID"],
};

export const app = initializeApp(config);
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
