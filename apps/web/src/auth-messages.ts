/** Plain English for Firebase Auth error codes (plan §7: no jargon). */
const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "That email and password do not match.",
  "auth/wrong-password": "That email and password do not match.",
  "auth/user-not-found": "That email and password do not match.",
  "auth/invalid-email": "Enter an email address like name@example.com.",
  "auth/email-already-in-use": "There is already an account for that email. Sign in instead.",
  "auth/weak-password": "Use a password of at least 6 characters.",
  "auth/network-request-failed": "No connection. Check your signal and try again.",
  "auth/too-many-requests": "Too many tries. Wait a few minutes and try again.",
};

export const authMessage = (code: string): string => MESSAGES[code] ?? "Something went wrong. Please try again.";
