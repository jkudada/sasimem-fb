/**
 * The setup screens' Firebase side (step 3), loaded only after sign-in. Firestore
 * Lite, as in data.ts: one read of everything when the app opens and after each
 * save, no live listeners. A landlord has 1-20 tenancies, so that is a handful of
 * small documents. Storage loads only when Settings shows or changes the logo.
 */
import { type OrgProfile, type PropertyInput, type TenancyDocument, type TenantInput, logoExtension } from "@sasimem/core";
import {
  addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, setDoc, updateDoc,
} from "firebase/firestore/lite";
import { httpsCallable } from "firebase/functions";
import { app, usingEmulators } from "./firebase.js";
import { db, functions } from "./data.js";
import type { Numbering, Org, Setup, SetupStore, TenancyEdit, WithId } from "./setup.js";

const OFFLINE = "You need a connection to do this. Check your signal and try again.";
const COULD_NOT_SAVE = "That could not be saved. Please try again.";

/** Turn a thrown write into a plain message, or null on success. */
async function attempt(act: () => Promise<unknown>, failure = COULD_NOT_SAVE): Promise<string | null> {
  try {
    await act();
    return null;
  } catch {
    return navigator.onLine ? failure : OFFLINE;
  }
}

async function storage() {
  const { connectStorageEmulator, getStorage } = await import("firebase/storage");
  const s = getStorage(app);
  if (usingEmulators && !connected) {
    connectStorageEmulator(s, "127.0.0.1", 9199);
    connected = true;
  }
  return s;
}
let connected = false;

const withIds = <T,>(snap: Awaited<ReturnType<typeof getDocs>>): WithId<T>[] =>
  snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));

export function setupStore(orgId: string): SetupStore {
  const org = `orgs/${orgId}`;
  const ref = (path: string) => doc(db, `${org}/${path}`);

  return {
    async load(): Promise<Setup> {
      const [o, properties, tenants, tenancies] = await Promise.all([
        getDoc(doc(db, org)),
        getDocs(collection(db, `${org}/properties`)),
        getDocs(collection(db, `${org}/tenants`)),
        getDocs(collection(db, `${org}/tenancies`)),
      ]);
      const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
      return {
        org: o.data() as Org,
        properties: withIds<PropertyInput>(properties).sort((a, b) => a.address.localeCompare(b.address)),
        tenants: withIds<TenantInput>(tenants).sort(byName),
        tenancies: withIds<TenancyDocument>(tenancies),
      };
    },

    saveProperty: (id, property) => attempt(() => (id === null ? addDoc(collection(db, `${org}/properties`), property) : setDoc(ref(`properties/${id}`), property))),
    deleteProperty: (id) => attempt(() => deleteDoc(ref(`properties/${id}`))),
    saveTenant: (id, tenant) => attempt(() => (id === null ? addDoc(collection(db, `${org}/tenants`), tenant) : setDoc(ref(`tenants/${id}`), tenant))),
    deleteTenant: (id) => attempt(() => deleteDoc(ref(`tenants/${id}`))),
    createTenancy: (tenancy) => attempt(() => addDoc(collection(db, `${org}/tenancies`), tenancy)),
    updateTenancy: (id, edit: TenancyEdit) => attempt(() => updateDoc(ref(`tenancies/${id}`), { ...edit })),
    deleteTenancy: (id) => attempt(() => deleteDoc(ref(`tenancies/${id}`))),
    saveProfile: (profile: OrgProfile) => attempt(() => updateDoc(doc(db, org), { ...profile })),

    uploadLogo: (file) => attempt(async () => {
      const { ref: fileRef, uploadBytes } = await import("firebase/storage");
      // A new name each time, so an old logo cached by a browser is never shown as the new one.
      const path = `logos/${orgId}/${Date.now()}.${logoExtension(file.type)}`;
      await uploadBytes(fileRef(await storage(), path), file, { contentType: file.type });
      await updateDoc(doc(db, org), { logoPath: path });
    }, "The logo could not be uploaded. Please try again."),

    removeLogo: () => attempt(() => updateDoc(doc(db, org), { logoPath: deleteField() })),

    async logoUrl(path) {
      try {
        const { getDownloadURL, ref: fileRef } = await import("firebase/storage");
        return await getDownloadURL(fileRef(await storage(), path));
      } catch {
        return null;
      }
    },

    async numbering(): Promise<Numbering | string> {
      try {
        return (await httpsCallable<{ orgId: string }, Numbering>(functions, "getNumbering")({ orgId })).data;
      } catch {
        return OFFLINE;
      }
    },

    async setNextNumber(next) {
      try {
        await httpsCallable(functions, "setNextInvoiceNumber")({ orgId, next });
        return null;
      } catch (e) {
        // The callable's own message is plain English (e.g. "already been numbered").
        const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "";
        return code.startsWith("functions/") && code !== "functions/unavailable" && e instanceof Error ? e.message : OFFLINE;
      }
    },
  };
}
