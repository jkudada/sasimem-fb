/**
 * The console shell: who gets in (session.ts), then the pages their role allows
 * (PLAN-ADMIN-DASHBOARD §4). Changes go through audited callables (S3, A1). Screens are
 * lazy, so sign-in carries only Preact and Auth.
 */
import type { ReadonlySignal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { can, type ConsoleSettings, ROLE_NAMES } from "@sasimem/core";
import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { LocationProvider, Route, Router } from "preact-iso";
import type { ConsoleData } from "./data.js";
import { lazyScreen } from "./lazy.js";
import type { ConsoleSession } from "./session.js";
import type { Access, StaffResult } from "./types.js";
import { LOAD_FAILED } from "./screens/useLoad.js";

const SignIn = lazyScreen(() => import("./screens/SignIn.js").then((m) => m.SignIn));
const Enrol = lazyScreen(() => import("./screens/Enrol.js").then((m) => m.Enrol));
const Subscribers = lazyScreen(() => import("./screens/Subscribers.js").then((m) => m.Subscribers));
const Subscriber = lazyScreen(() => import("./screens/Subscriber.js").then((m) => m.Subscriber));
const Health = lazyScreen(() => import("./screens/Health.js").then((m) => m.Health));
const Billing = lazyScreen(() => import("./screens/Billing.js").then((m) => m.Billing));
const Metrics = lazyScreen(() => import("./screens/Metrics.js").then((m) => m.Metrics));
const Invites = lazyScreen(() => import("./screens/Invites.js").then((m) => m.Invites));
const Staff = lazyScreen(() => import("./screens/Staff.js").then((m) => m.Staff));
const Settings = lazyScreen(() => import("./screens/Settings.js").then((m) => m.Settings));
const Account = lazyScreen(() => import("./screens/Account.js").then((m) => m.Account));

export type SignInResult = { readonly kind: "in" } | { readonly kind: "code" } | { readonly kind: "problem"; readonly message: string };

/** What screens can do. Each resolves to a plain-English problem, or null on success. */
export interface Actions {
  signIn: (email: string, password: string) => Promise<SignInResult>;
  verifyCode: (code: string) => Promise<string | null>;
  startEnrolment: () => Promise<{ key: string; url: string } | { problem: string }>;
  finishEnrolment: (code: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  /** Firestore, loaded only once staff are fully signed in. */
  data: () => Promise<ConsoleData>;
  /** An operator action on one subscription (core's OperatorAction): the server's refusal, or null. */
  operate: (orgId: string, action: unknown) => Promise<string | null>;
  /** Send or revoke an invitation (core's InviteRequest): the server's refusal, or null. */
  invite: (request: unknown) => Promise<string | null>;
  /** A staff action (core's StaffAction); the list for `{ kind: "list" }`. */
  staff: (action: unknown) => Promise<StaffResult>;
  /** Change console settings (core's SettingsChange): the server's refusal, or null. */
  updateSettings: (change: unknown) => Promise<string | null>;
}

export type Page = "subscribers" | "invites" | "billing" | "metrics" | "health" | "staff" | "settings" | "account";
const PAGES: readonly { page: Page; href: string; label: string }[] = [
  { page: "subscribers", href: "/", label: "Subscribers" },
  { page: "invites", href: "/invites", label: "Invites" },
  { page: "billing", href: "/billing", label: "Billing" },
  { page: "metrics", href: "/metrics", label: "Metrics" },
  { page: "health", href: "/health", label: "Health" },
  { page: "staff", href: "/staff", label: "Staff" },
  { page: "settings", href: "/settings", label: "Settings" },
  { page: "account", href: "/account", label: "My account" },
];

/**
 * The pages a role sees. Metrics reads every customer's runs, so until A3 builds it on the
 * stats job it is the Owner's alone, like the customers' records it reads.
 */
export function pagesFor(access: Pick<Access, "role" | "settings">): Page[] {
  const may = (c: Parameters<typeof can>[1]) => can(access.role, c, access.settings);
  const allowed: Record<Page, boolean> = {
    subscribers: may("subscriptions"), invites: may("invites"), billing: may("billing"), metrics: may("orgRecords"),
    health: may("stats"), staff: may("staff"), settings: true, account: true,
  };
  return PAGES.map((p) => p.page).filter((p) => allowed[p]);
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

const NotForRole = () => <main><h1>Not available</h1><p>Your role does not include this page.</p></main>;

/** Signed in with the code: load the settings, note the visit, then the pages. */
function Ready(props: { session: Extract<ConsoleSession, { status: "ready" }>; actions: Actions; now: () => Date }) {
  const { actions, now, session } = props;
  const settings = useSignal<ConsoleSettings | "loading" | "failed">("loading");
  const version = useSignal(0);
  useEffect(() => {
    actions.data().then((d) => d.settings()).then((s) => (settings.value = s), () => (settings.value = "failed"));
  }, [version.value]);
  useEffect(() => {
    actions.data().then((d) => d.seen(session.uid)).catch(() => undefined); // last seen is a nicety; never block on it
  }, [session.uid]);
  const signOut = () => void actions.signOut();
  if (settings.value === "loading") return <main class="narrow"><p>Loading…</p></main>;
  if (settings.value === "failed") {
    return <Gate title="Sasimem console" email={session.email} onSignOut={signOut} text={LOAD_FAILED} />;
  }
  const access: Access = { uid: session.uid, email: session.email, role: session.role, settings: settings.value };
  const pages = pagesFor(access);
  const has = (p: Page) => pages.includes(p);
  const guard = (p: Page, el: () => JSX.Element) => (has(p) ? el() : <NotForRole />);
  const Home = has("subscribers") ? () => <Subscribers data={actions.data} access={access} now={now} /> : () => <Health data={actions.data} access={access} now={now} />;

  return (
    <LocationProvider>
      <header class="top">
        <nav aria-label="Console">{PAGES.filter((p) => has(p.page)).map((p) => <a key={p.page} href={p.href}>{p.label}</a>)}</nav>
        <span class="note">{session.email}, {ROLE_NAMES[session.role]}</span>
        <button type="button" class="small quiet" onClick={signOut}>Sign out</button>
      </header>
      <Router>
        <Route path="/s/:orgId" component={({ orgId }: { orgId: string }) => guard("subscribers", () => <Subscriber orgId={orgId} data={actions.data} access={access} operate={actions.operate} now={now} />)} />
        <Route path="/invites" component={() => guard("invites", () => <Invites data={actions.data} invite={actions.invite} now={now} />)} />
        <Route path="/health" component={() => <Health data={actions.data} access={access} now={now} />} />
        <Route path="/billing" component={() => guard("billing", () => <Billing data={actions.data} access={access} now={now} />)} />
        <Route path="/metrics" component={() => guard("metrics", () => <Metrics data={actions.data} access={access} now={now} />)} />
        <Route path="/staff" component={() => guard("staff", () => <Staff access={access} staff={actions.staff} now={now} />)} />
        <Route path="/settings" component={() => <Settings access={access} staff={actions.staff} update={actions.updateSettings} onChanged={() => (version.value += 1)} />} />
        <Route path="/account" component={() => <Account access={access} data={actions.data} staff={actions.staff} signOut={actions.signOut} />} />
        <Route default component={Home} />
      </Router>
    </LocationProvider>
  );
}

export function App(props: { session: ReadonlySignal<ConsoleSession>; actions: Actions; now: () => Date }) {
  const { actions, now } = props;
  const s = props.session.value;
  const signOut = () => void actions.signOut();

  switch (s.status) {
    case "loading": return <main class="narrow"><h1>Sasimem console</h1><p>Loading…</p></main>;
    case "signedOut": return <SignIn onSignIn={actions.signIn} onCode={actions.verifyCode} notice={s.notice} />;
    case "notOperator":
      return <Gate title="This account is not Sasimem staff" email={s.email} onSignOut={signOut}
        text="The console is for Sasimem's staff. Landlords use the Sasimem app itself. If you were just given access, sign out and in again." />;
    case "needsEnrolment": return <Enrol email={s.email} onStart={actions.startEnrolment} onFinish={actions.finishEnrolment} onSignOut={signOut} />;
    case "needsSecondFactor":
      return <Gate title="Sign in again with your code" email={s.email} onSignOut={signOut}
        text="This session was signed in without your authenticator code. Sign out, then sign in with your password and the code." />;
    case "ready":
      return <Ready session={s} actions={actions} now={now} />;
  }
}
