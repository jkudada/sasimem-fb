/**
 * The console shell: who gets in (session.ts), then three read-only pages. Screens are
 * lazy, so sign-in carries only Preact and Auth.
 */
import type { ReadonlySignal } from "@preact/signals";
import { LocationProvider, Route, Router } from "preact-iso";
import type { ConsoleData } from "./data.js";
import { lazyScreen } from "./lazy.js";
import type { ConsoleSession } from "./session.js";

const SignIn = lazyScreen(() => import("./screens/SignIn.js").then((m) => m.SignIn));
const Enrol = lazyScreen(() => import("./screens/Enrol.js").then((m) => m.Enrol));
const Subscribers = lazyScreen(() => import("./screens/Subscribers.js").then((m) => m.Subscribers));
const Subscriber = lazyScreen(() => import("./screens/Subscriber.js").then((m) => m.Subscriber));
const Health = lazyScreen(() => import("./screens/Health.js").then((m) => m.Health));

export type SignInResult = { readonly kind: "in" } | { readonly kind: "code" } | { readonly kind: "problem"; readonly message: string };

/** What screens can do. Each resolves to a plain-English problem, or null on success. */
export interface Actions {
  signIn: (email: string, password: string) => Promise<SignInResult>;
  verifyCode: (code: string) => Promise<string | null>;
  startEnrolment: () => Promise<{ key: string; url: string } | { problem: string }>;
  finishEnrolment: (code: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  /** Firestore, loaded only once an operator is fully signed in. */
  data: () => Promise<ConsoleData>;
}

function Gate(props: { title: string; email: string; text: string; onSignOut: () => void }) {
  return (
    <main class="narrow">
      <h1>{props.title}</h1>
      <p>{props.text}</p>
      <p class="note">Signed in as {props.email}.</p>
      <button type="button" onClick={props.onSignOut}>Sign out</button>
    </main>
  );
}

export function App(props: { session: ReadonlySignal<ConsoleSession>; actions: Actions; now: () => Date }) {
  const { actions, now } = props;
  const s = props.session.value;
  const signOut = () => void actions.signOut();

  switch (s.status) {
    case "loading": return <main class="narrow"><h1>Sasimem console</h1><p>Loading…</p></main>;
    case "signedOut": return <SignIn onSignIn={actions.signIn} onCode={actions.verifyCode} />;
    case "notOperator":
      return <Gate title="This account is not an operator" email={s.email} onSignOut={signOut}
        text="The console is for Sasimem's operators. Landlords use the Sasimem app itself." />;
    case "needsEnrolment": return <Enrol email={s.email} onStart={actions.startEnrolment} onFinish={actions.finishEnrolment} onSignOut={signOut} />;
    case "needsSecondFactor":
      return <Gate title="Sign in again with your code" email={s.email} onSignOut={signOut}
        text="This session was signed in without your authenticator code. Sign out, then sign in with your password and the code." />;
    case "ready":
      return (
        <LocationProvider>
          <header class="top">
            <nav><a href="/">Subscribers</a><a href="/health">Health</a></nav>
            <span class="note">{s.email}</span>
            <button type="button" class="small quiet" onClick={signOut}>Sign out</button>
          </header>
          <Router>
            <Route path="/s/:orgId" component={({ orgId }: { orgId: string }) => <Subscriber orgId={orgId} data={actions.data} now={now} />} />
            <Route path="/health" component={() => <Health data={actions.data} now={now} />} />
            <Route default component={() => <Subscribers data={actions.data} now={now} />} />
          </Router>
        </LocationProvider>
      );
  }
}
