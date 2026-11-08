/** Session state, held in a signal by session.ts. */
export type Session =
  | { readonly status: "loading" }
  | { readonly status: "signedOut" }
  | { readonly status: "signedIn"; readonly email: string; readonly emailVerified: boolean; readonly orgId: string | null };

export type Screen = "loading" | "signIn" | "verify" | "onboarding" | "home";

/**
 * The one screen that matters for this session. Sign-up and reset are reached by link
 * from sign-in. An organisation is made only from a confirmed email (createOrg checks it
 * too, docs/PLAN-TEMPLATES.md §7); a landlord who already has one is never stopped here.
 */
export function screenFor(session: Session): Screen {
  if (session.status === "loading") return "loading";
  if (session.status === "signedOut") return "signIn";
  if (session.orgId !== null) return "home";
  return session.emailVerified ? "onboarding" : "verify";
}
