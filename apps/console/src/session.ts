/** Who gets into the console: pure, so every case is a T1 test (the Auth emulator has no TOTP). */
export type ConsoleSession =
  | { readonly status: "loading" }
  | { readonly status: "signedOut" }
  | { readonly status: "notOperator"; readonly email: string }
  | { readonly status: "needsEnrolment"; readonly email: string }
  | { readonly status: "needsSecondFactor"; readonly email: string }
  | { readonly status: "ready"; readonly email: string };

export interface SignedInUser {
  readonly email: string;
  /** The `operator` custom claim, set only by ops/grant-operator.ts. */
  readonly operator: boolean;
  /** The token's firebase.sign_in_second_factor: null when signed in with a password alone. */
  readonly secondFactor: string | null;
  readonly enrolledFactors: number;
}

export function sessionFrom(user: SignedInUser | null): ConsoleSession {
  if (user === null) return { status: "signedOut" };
  const { email } = user;
  if (!user.operator) return { status: "notOperator", email };
  if (user.secondFactor !== null) return { status: "ready", email };
  return user.enrolledFactors === 0 ? { status: "needsEnrolment", email } : { status: "needsSecondFactor", email };
}
