/** Session state, held in a signal by session.ts. */
export type Session =
  | { readonly status: "loading" }
  | { readonly status: "signedOut" }
  | { readonly status: "signedIn"; readonly email: string; readonly orgId: string | null };

export type Screen = "loading" | "signIn" | "onboarding" | "home";

/** The one screen that matters for this session. Sign-up and reset are reached by link from sign-in. */
export function screenFor(session: Session): Screen {
  if (session.status === "loading") return "loading";
  if (session.status === "signedOut") return "signIn";
  return session.orgId === null ? "onboarding" : "home";
}
