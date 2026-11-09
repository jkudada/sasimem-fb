/**
 * The signed-in app (step 3): home and the setup screens. Everything a landlord
 * has is loaded once (1-20 tenancies) and reloaded after each save, so every
 * screen shows what was actually stored.
 */
import { type ReadonlySignal, signal, useSignal } from "@preact/signals";
import { type CalendarDate, type Period, periodOf } from "@sasimem/core";
import { createContext } from "preact";
import { useContext, useEffect } from "preact/hooks";
import { LocationProvider, Route, Router, useLocation } from "preact-iso";
import type { Actions } from "./app.js";
import { lazyScreen } from "./lazy.js";
import type { Month, Numbering, Outcome, Setup, SetupStore } from "./setup.js";
import { invoiceTemplateName } from "./template-choice.js";

const Home = lazyScreen(() => import("./screens/Home.js").then((m) => m.Home));
const Properties = lazyScreen(() => import("./screens/Properties.js").then((m) => m.Properties));
const PropertyForm = lazyScreen(() => import("./screens/PropertyForm.js").then((m) => m.PropertyForm));
const Tenants = lazyScreen(() => import("./screens/Tenants.js").then((m) => m.Tenants));
const TenantForm = lazyScreen(() => import("./screens/TenantForm.js").then((m) => m.TenantForm));
const TenancyForm = lazyScreen(() => import("./screens/TenancyForm.js").then((m) => m.TenancyForm));
const Settings = lazyScreen(() => import("./screens/Settings.js").then((m) => m.Settings));
const Templates = lazyScreen(() => import("./screens/Templates.js").then((m) => m.Templates));
const TemplateForm = lazyScreen(() => import("./screens/TemplateForm.js").then((m) => m.TemplateForm));
const LogoBuilder = lazyScreen(() => import("./logo/LogoBuilder.js").then((m) => m.LogoBuilder));
const MonthCard = lazyScreen(() => import("./screens/MonthCard.js").then((m) => m.MonthCard));
const Review = lazyScreen(() => import("./screens/Review.js").then((m) => m.Review));
const Tracking = lazyScreen(() => import("./screens/Tracking.js").then((m) => m.Tracking));
const Invoices = lazyScreen(() => import("./screens/Invoices.js").then((m) => m.Invoices));
const Owed = lazyScreen(() => import("./screens/Owed.js").then((m) => m.Owed));

const OFFLINE = "Your details could not be loaded. Check your signal, then reload the page.";

/**
 * What every signed-in route reads. `setup` is a signal, read inside each route, so a
 * reload re-renders the screen showing now. (Closures over a plain value went stale:
 * preact-iso does not re-render the current route when only its parent changes.)
 */
interface Context {
  readonly store: SetupStore;
  readonly setup: ReadonlySignal<Setup>;
  readonly today: CalendarDate;
  readonly reload: () => Promise<void>;
  readonly signOut: () => Promise<void>;
}
const Ctx = createContext<Context | null>(null);

function useSignedIn(): Context {
  const c = useContext(Ctx);
  if (c === null) throw new Error("signed-in route outside SignedIn");
  return c;
}

export function SignedIn(props: { orgId: string; actions: Actions; today: CalendarDate }) {
  const context = useSignal<Context | null>(null);
  const failed = useSignal(false);

  useEffect(() => {
    void props.actions.setupStore(props.orgId).then(async (store) => {
      try {
        const setup = signal(await store.load());
        const reload = async () => {
          try {
            setup.value = await store.load();
          } catch {
            failed.value = true;
          }
        };
        context.value = { store, setup, today: props.today, reload, signOut: props.actions.signOut };
      } catch {
        failed.value = true;
      }
    });
  }, [props.orgId]);

  if (failed.value) return <main class="narrow"><p role="alert">{OFFLINE}</p></main>;
  if (context.value === null) return <main class="narrow"><p>Loading…</p></main>;
  return (
    <Ctx.Provider value={context.value}>
      <LocationProvider>
        <Router>
          <Route path="/properties" component={PropertiesRoute} />
          <Route path="/properties/:id" component={PropertyRoute} />
          <Route path="/tenants" component={TenantsRoute} />
          <Route path="/tenants/:id" component={TenantRoute} />
          <Route path="/tenancies/:id" component={TenancyRoute} />
          <Route path="/settings" component={SettingsRoute} />
          <Route path="/settings/logo" component={LogoRoute} />
          <Route path="/settings/templates" component={TemplatesRoute} />
          <Route path="/settings/templates/:id" component={TemplateRoute} />
          <Route path="/month/:period" component={ReviewRoute} />
          <Route path="/invoices" component={InvoicesRoute} />
          <Route path="/owed" component={OwedRoute} />
          <Route default component={HomeRoute} />
        </Router>
      </LocationProvider>
    </Ctx.Provider>
  );
}

type Params = { params: Record<string, string> };
const idOf = ({ params }: Params) => (params["id"] === "new" ? null : (params["id"] ?? null));

/** After a save elsewhere: reload what was stored, then go back up a level. */
function useDoneTo(path: string): () => void {
  const { reload } = useSignedIn();
  const { route } = useLocation();
  return () => void reload().then(() => route(path));
}

/** A month's run, loaded when shown and again after each change. */
function useMonth(period: Period) {
  const { store } = useSignedIn();
  const month = useSignal<Month | null | string | undefined>(undefined);
  const reload = async () => {
    month.value = await store.month(period);
  };
  useEffect(() => void reload(), [store, period]);
  /** Run a callable, then reload the month so the screen shows what was stored. */
  const thenReload = <A extends unknown[]>(act: (...a: A) => Promise<Outcome>) => async (...a: A) => {
    const outcome = await act(...a);
    await reload();
    return outcome;
  };
  return { month, thenReload };
}

function HomeRoute() {
  const c = useSignedIn();
  const period = periodOf(c.today);
  const { month, thenReload } = useMonth(period);
  const owed = useOwedTotal();
  const m = month.value;
  return (
    <Home setup={c.setup.value} {...(owed.value === null ? {} : { owedToea: owed.value })} onSignOut={() => void c.signOut()}>
      {m === undefined ? <p class="note">Loading this month…</p>
        : typeof m === "string" ? <p role="alert">{m}</p>
        : <MonthCard period={period} month={m} timezone={c.setup.value.org.timezone} onDraftNow={thenReload(c.store.draftNow)} />}
    </Home>
  );
}

function ReviewRoute(props: { params: Record<string, string> }) {
  const c = useSignedIn();
  const period = props.params["period"] as Period;
  const { month, thenReload } = useMonth(period);
  const m = month.value;
  if (m === undefined) return <main class="narrow"><p>Loading…</p></main>;
  if (typeof m === "string") return <main class="narrow"><p role="alert">{m}</p></main>;
  if (m === null) return <main class="narrow"><p>{period} has no invoices yet. <a href="/">Back home</a></p></main>;
  if (m.status === "sent") {
    return (
      <Tracking month={m} today={c.today}
        onMarkPaid={thenReload(c.store.markPaid)} onMarkUnpaid={thenReload(c.store.markUnpaid)} onPauseReminders={thenReload(c.store.pauseReminders)}
        onVoid={thenReload(c.store.voidInvoice)} onResend={thenReload(c.store.resendInvoice)} onOpenPdf={c.store.openPdf} />
    );
  }
  return (
    <Review month={m} timezone={c.setup.value.org.timezone} templateName={(inv) => invoiceTemplateName(c.setup.value, inv)}
      onSetRent={thenReload(c.store.setRent)} onExclude={thenReload(c.store.exclude)} onInclude={thenReload(c.store.include)}
      onRebuild={thenReload(c.store.rebuildRun)} onApprove={thenReload(c.store.approveRun)} />
  );
}

/** What is owed across all months, for home; null until loaded or if it could not be. */
function useOwedTotal() {
  const { store } = useSignedIn();
  const total = useSignal<number | null>(null);
  useEffect(() => {
    void store.owed().then((g) => (total.value = typeof g === "string" ? null : g.reduce((t, x) => t + x.totalToea, 0)));
  }, [store]);
  return total;
}

function InvoicesRoute() {
  const c = useSignedIn();
  const months = useSignal<Awaited<ReturnType<SetupStore["months"]>> | null>(null);
  useEffect(() => void c.store.months().then((m) => (months.value = m)), [c.store]);
  const m = months.value;
  if (m === null) return <main class="narrow"><p>Loading…</p></main>;
  if (typeof m === "string") return <main class="narrow"><p role="alert">{m}</p></main>;
  return <Invoices months={m} thisMonth={periodOf(c.today)} onExport={c.store.exportCsv} />;
}

function OwedRoute() {
  const c = useSignedIn();
  const groups = useSignal<Awaited<ReturnType<SetupStore["owed"]>> | null>(null);
  const load = async () => void (groups.value = await c.store.owed());
  useEffect(() => void load(), [c.store]);
  const g = groups.value;
  if (g === null) return <main class="narrow"><p>Loading…</p></main>;
  if (typeof g === "string") return <main class="narrow"><p role="alert">{g}</p></main>;
  return <Owed groups={g} today={c.today} onMarkPaid={async (id, note) => { const o = await c.store.markPaid(id, note); await load(); return o; }} />;
}

function PropertiesRoute() {
  const c = useSignedIn();
  return <Properties setup={c.setup.value} today={c.today} />;
}

function PropertyRoute(props: Params) {
  const c = useSignedIn();
  const done = useDoneTo("/properties");
  return <PropertyForm key={props.params["id"]} id={idOf(props)} setup={c.setup.value} onSave={c.store.saveProperty} onDelete={c.store.deleteProperty} onDone={done} />;
}

function TenantsRoute() {
  return <Tenants setup={useSignedIn().setup.value} />;
}

function TenantRoute(props: Params) {
  const c = useSignedIn();
  const done = useDoneTo("/tenants");
  return <TenantForm key={props.params["id"]} id={idOf(props)} setup={c.setup.value} onSave={c.store.saveTenant} onDelete={c.store.deleteTenant} onDone={done} />;
}

function TenancyRoute(props: Params) {
  const c = useSignedIn();
  const done = useDoneTo("/properties");
  return (
    <TenancyForm key={props.params["id"]} id={idOf(props)} setup={c.setup.value} today={c.today}
      onCreate={c.store.createTenancy} onUpdate={c.store.updateTenancy} onDelete={c.store.deleteTenancy} onDone={done} />
  );
}

/** The templates list saves in place: making one the default reloads and stays. */
function TemplatesRoute() {
  const { store, setup, reload } = useSignedIn();
  return (
    <Templates setup={setup.value} onSetDefault={async (id) => {
      const problem = await store.setDefaultTemplate(id);
      if (problem === null) await reload();
      return problem;
    }} />
  );
}

function TemplateRoute(props: Params) {
  const c = useSignedIn();
  const done = useDoneTo("/settings/templates");
  return (
    <TemplateForm key={props.params["id"]} id={idOf(props)} setup={c.setup.value}
      onSave={c.store.saveTemplate} onDelete={c.store.deleteTemplate} onPreview={c.store.previewTemplate} onDone={done} />
  );
}

function LogoRoute() {
  const c = useSignedIn();
  const done = useDoneTo("/settings");
  return <LogoBuilder org={c.setup.value.org} onSave={c.store.saveLogoDesign} onDone={done} />;
}

/** Settings saves in place, and also needs the numbering (a callable) and the logo's URL (Storage). */
function SettingsRoute() {
  const { store, setup, reload } = useSignedIn();
  const numbering = useSignal<Numbering | null>(null);
  const logoUrl = useSignal<string | null>(null);
  const logoPath = setup.value.org.logoPath;

  useEffect(() => {
    void store.numbering().then((n) => (numbering.value = typeof n === "string" ? null : n));
  }, [store]);
  useEffect(() => {
    if (logoPath === undefined) logoUrl.value = null;
    else void store.logoUrl(logoPath).then((u) => (logoUrl.value = u));
  }, [logoPath]);

  const thenReload = <A extends unknown[]>(act: (...a: A) => Promise<string | null>) => async (...a: A) => {
    const problem = await act(...a);
    if (problem === null) await reload();
    return problem;
  };

  return (
    <Settings
      org={setup.value.org} numbering={numbering.value} logoUrl={logoUrl.value}
      onSave={thenReload(store.saveProfile)} onUploadLogo={thenReload(store.uploadLogo)} onRemoveLogo={thenReload(store.removeLogo)}
      onSetNext={async (n) => {
        const problem = await store.setNextNumber(n);
        if (problem === null) numbering.value = { next: n, started: false };
        return problem;
      }}
    />
  );
}
