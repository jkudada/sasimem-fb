/** The Admin SDK, initialised once. Region and project come from the environment. */
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const app = () => getApps()[0] ?? initializeApp();

export const db = (): Firestore => getFirestore(app());
export const auth = (): Auth => getAuth(app());
