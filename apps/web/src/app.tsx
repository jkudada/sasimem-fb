/**
 * The app shell: picks the one screen that matters for the session. Screens are
 * lazy, so the sign-in route carries only Preact, Auth and the sign-in form.
 */
import { type ReadonlySignal, useSignal } from "@preact/signals";
import type { CalendarDate, OrgSetupInput } from "@sasimem/core";
import { LocationProvider, Route, Router } from "preact-iso";
import { lazyScreen } from "./lazy.js";
import { screenFor, type Session } from "./route.js";
import type { SetupStore } from "./setup.js";
import type { SignInAction } from "./screens/SignIn.js";
import type { FirstTenancy } from "./screens/TenancyStep.js";

const SignIn = lazyScreen(() => import("./screens/SignIn.js").then((m) => m.SignIn));
const SignUp = lazyScreen(() => import("./screens/SignUp.js").then((m) => m.SignUp));
const ResetPassword = lazyScreen(() => import("./screens/ResetPassword.js").then((m) => m.ResetPassword));
const VerifyEmail = lazyScreen(() => import("./screens/VerifyEmail.js").then((m) => m.VerifyEmail));
const OrgStep = lazyScreen(() => import("./screens/OrgStep.js").then((m) => m.OrgStep));
const TenancyStep = lazyScreen(() => import("./screens/TenancyStep.js").then((m) => m.TenancyStep));
const SignedIn = lazyScreen(() => import("./SignedIn.js").then((m) => m.SignedIn));

/** What screens can do. Each resolves to a plain-English problem, or null on success. */
export interface Actions {
  signIn: SignInAction;
  signUp: SignInAction;
  reset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Email the confirmation link again; a problem, or null. */
  resendVerification: () => Promise<string | null>;
  /** Ask Auth whether the email is confirmed now; the session follows when it is. */
  checkVerified: () => Promise<boolean>;
  createOrg: (input: OrgSetupInput) => Promise<string | null>;
  saveFirstTenancy: (first: FirstTenancy) => Promise<string | null>;
  /** Firestore for the setup screens, loaded after sign-in. */
  setupStore: (orgId: string) => Promise<SetupStore>;
}

/** signUpOpen: whether new accounts can be made from the app; true unless the build closes it (main.tsx). */
export function App(props: { session: ReadonlySignal<Session>; actions: Actions; today: () => string; signUpOpen?: boolean }) {
  const signUpOpen = props.signUpOpen ?? true;
  const { actions } = props;
  const addingTenant = useSignal(false);
  const session = props.session.value;
  const screen = screenFor(session);

  const createOrg = async (input: OrgSetupInput) => {
    const problem = await actions.createOrg(input);
    if (problem === null) addingTenant.value = true; // straight on to the first tenant
    return problem;
  };
  const saveFirstTenancy = async (first: FirstTenancy) => {
    const problem = await actions.saveFirstTenancy(first);
    if (problem === null) addingTenant.value = false;
    return problem;
  };

  if (screen === "loading") return <main class="narrow"><h1>Sasimem</h1><p>Loading…</p></main>;
  if (screen === "signIn") {
    return (
      <LocationProvider>
        <Router>
          <Route path="/sign-up" component={() => <SignUp onSignUp={actions.signUp} open={signUpOpen} />} />
          <Route path="/reset" component={() => <ResetPassword onReset={actions.reset} />} />
          <Route default component={() => <SignIn onSignIn={actions.signIn} signUpOpen={signUpOpen} />} />
        </Router>
      </LocationProvider>
    );
  }
  if (screen === "verify" && session.status === "signedIn") {
    return <VerifyEmail email={session.email} onCheck={actions.checkVerified} onResend={actions.resendVerification} onSignOut={actions.signOut} />;
  }
  if (screen === "onboarding" && session.status === "signedIn") return <OrgStep defaultEmail={session.email} onSubmit={createOrg} />;
  if (addingTenant.value) return <TenancyStep today={props.today() as CalendarDate} onSubmit={saveFirstTenancy} />;
  if (session.status !== "signedIn" || session.orgId === null) return null;
  return <SignedIn orgId={session.orgId} actions={actions} today={props.today() as CalendarDate} />;
}
