/**
 * Firebase app and Auth: the only Firebase code on the sign-in route (plan §7:
 * the payload is the SDK). Firestore and Functions are loaded lazily in data.ts.
 * Public config comes from .env.local (gitignored); against the emulators a demo
 * project is used, which cannot reach any real project.
 */
import { type FirebaseOptions, initializeApp } from "firebase/app";
import { browserLocalPersistence, connectAuthEmulator, indexedDBLocalPersistence, initializeAuth } from "firebase/auth";

const env = import.meta.env;
export const usingEmulators = env["VITE_USE_EMULATORS"] === "1";

const config: FirebaseOptions = usingEmulators
  ? { apiKey: "demo-key", authDomain: "demo-sasimem.firebaseapp.com", projectId: "demo-sasimem", storageBucket: "demo-sasimem.appspot.com" }
  : {
      apiKey: env["VITE_FIREBASE_API_KEY"],
      authDomain: env["VITE_FIREBASE_AUTH_DOMAIN"],
      projectId: env["VITE_FIREBASE_PROJECT_ID"],
      storageBucket: env["VITE_FIREBASE_STORAGE_BUCKET"],
      appId: env["VITE_FIREBASE_APP_ID"],
    };

export const app = initializeApp(config);
// initializeAuth (not getAuth) leaves out the popup/redirect resolver, which this app never uses.
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
if (usingEmulators) connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
