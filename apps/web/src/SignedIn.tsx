/**
 * The signed-in app (step 3): home and the setup screens. Everything a landlord
 * has is loaded once (1-20 tenancies) and reloaded after each save, so every
 * screen shows what was actually stored.
 */
import { type ReadonlySignal, signal, useSignal } from "@preact/signals";
import type { CalendarDate } from "@sasimem/core";
import { createContext } from "preact";
import { useContext, useEffect } from "preact/hooks";
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

function HomeRoute() {
  const c = useSignedIn();
  return <Home setup={c.setup.value} onSignOut={() => void c.signOut()} />;
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
