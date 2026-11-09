import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { ConsoleData } from "../data.js";

export type Loaded<T> = { readonly state: "loading" } | { readonly state: "failed" } | { readonly state: "ready"; readonly value: T };

/** Read once when the screen opens. A failed read says so rather than showing nothing. */
export function useLoad<T>(data: () => Promise<ConsoleData>, read: (d: ConsoleData) => Promise<T>, key = ""): Loaded<T> {
  const result = useSignal<Loaded<T>>({ state: "loading" });
  useEffect(() => {
    result.value = { state: "loading" };
    data().then(read).then((value) => (result.value = { state: "ready", value }), () => (result.value = { state: "failed" }));
  }, [key]);
  return result.value;
}

export const LOAD_FAILED = "That could not be read. Check the connection, and that you signed in with your code, then reload.";
