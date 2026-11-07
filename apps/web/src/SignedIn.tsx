/**
 * The signed-in app (step 3): home and the setup screens. Everything a landlord
 * has is loaded once (1-20 tenancies) and reloaded after each save, so every
 * screen shows what was actually stored.
 */
import { useSignal } from "@preact/signals";
import type { CalendarDate } from "@sasimem/core";
import { useEffect } from "preact/hooks";
import { LocationProvider, Route, Router, useLocation } from "preact-iso";
import type { Actions } from "./app.js";
import { lazyScreen } from "./lazy.js";
import type { Numbering, Setup, SetupStore } from "./setup.js";

const Home = lazyScreen(() => import("./screens/Home.js").then((m) => m.Home));
const Properties = lazyScreen(() => import("./screens/Properties.js").then((m) => m.Properties));
const PropertyForm = lazyScreen(() => import("./screens/PropertyForm.js").then((m) => m.PropertyForm));
const Tenants = lazyScreen(() => import("./screens/Tenants.js").then((m) => m.Tenants));
const TenantForm = lazyScreen(() => import("./screens/TenantForm.js").then((m) => m.TenantForm));
const TenancyForm = lazyScreen(() => import("./screens/TenancyForm.js").then((m) => m.TenancyForm));
const Settings = lazyScreen(() => import("./screens/Settings.js").then((m) => m.Settings));

const OFFLINE = "Your details could not be loaded. Check your signal, then reload the page.";

export function SignedIn(props: { orgId: string; actions: Actions; today: CalendarDate }) {
  const store = useSignal<SetupStore | null>(null);
  const setup = useSignal<Setup | null>(null);
  const failed = useSignal(false);

  const reload = async (s: SetupStore) => {
    try {
      setup.value = await s.load();
      failed.value = false;
    } catch {
      failed.value = true;
    }
  };

  useEffect(() => {
    void props.actions.setupStore(props.orgId).then(async (s) => {
      store.value = s;
      await reload(s);
    });
  }, [props.orgId]);

  if (failed.value) return <main class="narrow"><p role="alert">{OFFLINE}</p></main>;
  if (store.value === null || setup.value === null) return <main class="narrow"><p>Loading…</p></main>;
  return (
    <LocationProvider>
      <Routes store={store.value} setup={setup.value} today={props.today} reload={reload} signOut={props.actions.signOut} />
    </LocationProvider>
  );
}

function Routes(props: { store: SetupStore; setup: Setup; today: CalendarDate; reload: (s: SetupStore) => Promise<void>; signOut: () => Promise<void> }) {
  const { store, setup, today } = props;
  const { route } = useLocation();
  /** After a save: reload what was stored, then go back up a level. */
  const doneTo = (path: string) => () => void props.reload(store).then(() => route(path));
  const id = (params: Record<string, string>) => (params["id"] === "new" ? null : (params["id"] ?? null));

  return (
    <Router>
      <Route path="/properties" component={() => <Properties setup={setup} today={today} />} />
      <Route path="/properties/:id" component={({ params }: { params: Record<string, string> }) => (
        <PropertyForm key={params["id"]} id={id(params)} setup={setup} onSave={store.saveProperty} onDelete={store.deleteProperty} onDone={doneTo("/properties")} />
      )} />
      <Route path="/tenants" component={() => <Tenants setup={setup} />} />
      <Route path="/tenants/:id" component={({ params }: { params: Record<string, string> }) => (
        <TenantForm key={params["id"]} id={id(params)} setup={setup} onSave={store.saveTenant} onDelete={store.deleteTenant} onDone={doneTo("/tenants")} />
      )} />
      <Route path="/tenancies/:id" component={({ params }: { params: Record<string, string> }) => (
        <TenancyForm key={params["id"]} id={id(params)} setup={setup} today={today}
          onCreate={store.createTenancy} onUpdate={store.updateTenancy} onDelete={store.deleteTenancy} onDone={doneTo("/properties")} />
      )} />
      <Route path="/settings" component={() => <SettingsRoute store={store} setup={setup} reload={() => props.reload(store)} />} />
      <Route default component={() => <Home setup={setup} onSignOut={() => void props.signOut()} />} />
    </Router>
  );
}

/** Settings also needs the numbering (a callable) and the logo's URL (Storage); both load after the form shows. */
function SettingsRoute(props: { store: SetupStore; setup: Setup; reload: () => Promise<void> }) {
  const { store, setup } = props;
  const numbering = useSignal<Numbering | null>(null);
  const logoUrl = useSignal<string | null>(null);
  const logoPath = setup.org.logoPath;

  useEffect(() => {
    void store.numbering().then((n) => (numbering.value = typeof n === "string" ? null : n));
  }, [store]);
  useEffect(() => {
    if (logoPath === undefined) logoUrl.value = null;
    else void store.logoUrl(logoPath).then((u) => (logoUrl.value = u));
  }, [logoPath]);

  const thenReload = <A extends unknown[]>(act: (...a: A) => Promise<string | null>) => async (...a: A) => {
    const problem = await act(...a);
    if (problem === null) await props.reload();
    return problem;
  };

  return (
    <Settings
      key={numbering.value === null ? "loading" : "ready"}
      org={setup.org} numbering={numbering.value} logoUrl={logoUrl.value}
      onSave={thenReload(store.saveProfile)} onUploadLogo={thenReload(store.uploadLogo)} onRemoveLogo={thenReload(store.removeLogo)}
      onSetNext={async (n) => {
        const problem = await store.setNextNumber(n);
        if (problem === null) numbering.value = { next: n, started: false };
        return problem;
      }}
    />
  );
}
