# App Check

**What is protected:**
- **Every callable** refuses a request without a valid App Check token. This is set in code
  (`enforceAppCheck` in `functions/src/options.ts`), so no callable can be deployed without it.
- **Firestore and Storage** refuse SDK requests without a token once enforcement is on for the
  project. That is a project setting, made by `ops/app-check.ts`.
- **Not covered:** the approval page, which is a link opened from an email with no JavaScript;
  Firebase Auth sign-in; and server-side (Admin SDK) access, which App Check never affects.

**The app.** App Check starts with the data layer, after sign-in, before the first Firestore or
Functions request (`apps/web/src/appcheck.ts`). A real build uses reCAPTCHA Enterprise with
`VITE_RECAPTCHA_SITE_KEY`, and stops at start if the key is missing. Under the emulators it sends
a placeholder token: the Functions emulator decodes tokens without verifying them, but still
refuses a call with none, so the T4 journeys prove every call carries one.

## Turning it on

```sh
node ops/app-check.ts --project <id> [--domain <custom domain>]... [--monitor-only]
```

This:
1. enables the reCAPTCHA Enterprise and App Check APIs;
2. creates (or reuses) a score-based reCAPTCHA Enterprise key named "Sasimem web", for
   `<id>.web.app`, `<id>.firebaseapp.com` and any `--domain`;
3. registers the key for the project's web app, with tokens that last an hour;
4. enforces App Check on Firestore and Storage, unless `--monitor-only` is given;
5. prints the site key to build the app with.

On production, run it with `--monitor-only` first, deploy the app built with the key, and check
the App Check metrics in the console (verified versus unverified requests) before enforcing.
Enforcing before the app sends tokens would refuse every landlord.

## sasimem-dev, 2026-11-08

- Web app `1:347183647688:web:7a41f70c0be80dbd2a0efd` ("sasimem-web") created for it.
- Key `6LcTxBUuAAAAALnW-2SGJOgJhvvyoUfv-KI9diwQ` (a public site key) for the two Hosting domains.
- Firestore and Storage enforced (nothing is deployed to dev yet, so nothing was refused).
- A second run reused the key and changed nothing.
