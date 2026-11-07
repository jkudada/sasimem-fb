/**
 * The app shell: picks the one screen that matters for the session. Screens are
 * lazy, so the sign-in route carries only Preact, Auth and the sign-in form.
 */
import { type ReadonlySignal, signal, useSignal } from "@preact/signals";
import type { CalendarDate, OrgSetupInput } from "@sasimem/core";
import type { ComponentType } from "preact";
import { LocationProvider, Route, Router } from "preact-iso";
import { screenFor, type Session } from "./route.js";
import type { SignInAction } from "./screens/SignIn.js";
import type { FirstTenancy } from "./screens/TenancyStep.js";

/**
 * A screen loaded on first use, showing "Loading…" meanwhile. Plain signals rather
 * than suspense: preact-iso's Router only re-routes on a URL change, and onboarding
 * changes screen without one.
 */
function lazyScreen<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  const loaded = signal<ComponentType<P> | null>(null);
  let started = false;
  return (props: P) => {
    if (!started) {
      started = true;
      void load().then((c) => (loaded.value = c));
    }
    const Screen = loaded.value;
    return Screen === null ? <main class="narrow"><p>Loading…</p></main> : <Screen {...props} />;
  };
}

const SignIn = lazyScreen(() => import("./screens/SignIn.js").then((m) => m.SignIn));
const SignUp = lazyScreen(() => import("./screens/SignUp.js").then((m) => m.SignUp));
const ResetPassword = lazyScreen(() => import("./screens/ResetPassword.js").then((m) => m.ResetPassword));
const OrgStep = lazyScreen(() => import("./screens/OrgStep.js").then((m) => m.OrgStep));
const TenancyStep = lazyScreen(() => import("./screens/TenancyStep.js").then((m) => m.TenancyStep));

/** What screens can do. Each resolves to a plain-English problem, or null on success. */
export interface Actions {
  signIn: SignInAction;
  signUp: SignInAction;
  reset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  createOrg: (input: OrgSetupInput) => Promise<string | null>;
  saveFirstTenancy: (first: FirstTenancy) => Promise<string | null>;
}

export function App(props: { session: ReadonlySignal<Session>; actions: Actions; today: () => string }) {
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
          <Route path="/sign-up" component={() => <SignUp onSignUp={actions.signUp} />} />
          <Route path="/reset" component={() => <ResetPassword onReset={actions.reset} />} />
          <Route default component={() => <SignIn onSignIn={actions.signIn} />} />
        </Router>
      </LocationProvider>
    );
  }
  if (screen === "onboarding" && session.status === "signedIn") return <OrgStep defaultEmail={session.email} onSubmit={createOrg} />;
  if (addingTenant.value) return <TenancyStep today={props.today() as CalendarDate} onSubmit={saveFirstTenancy} />;
  return (
    <main class="narrow">
      <h1>You're set up</h1>
      <p>Each month Sasimem drafts your invoices and emails you one link to approve them. Nothing goes to a tenant until you approve.</p>
      <button type="button" onClick={() => (addingTenant.value = true)}>Add a tenant</button>
      <button type="button" class="quiet" onClick={() => void actions.signOut()}>Sign out</button>
    </main>
  );
}
