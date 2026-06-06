import PocketBase, { type RecordModel } from "pocketbase";

// Cloud-sync via zelf-gehoste PocketBase. Zonder VITE_PB_URL draait de app
// volledig lokaal (geen sync). De auth-sessie wordt door de SDK automatisch in
// localStorage bewaard, dus je blijft ingelogd tussen sessies.

const url = (import.meta.env.VITE_PB_URL as string | undefined)?.trim();

export const pbEnabled = Boolean(url);

export const pb = new PocketBase(url || "http://127.0.0.1:8090");
pb.autoCancellation(false);

export function currentUser(): RecordModel | null {
  return pb.authStore.record;
}

export function isLoggedIn(): boolean {
  return pbEnabled && pb.authStore.isValid;
}

export async function login(email: string, password: string) {
  return pb.collection("users").authWithPassword(email, password);
}

export function logout() {
  pb.authStore.clear();
}

/** Roept `cb` aan zodra de auth-status verandert (login/logout/refresh). */
export function onAuthChange(cb: () => void): () => void {
  return pb.authStore.onChange(() => cb(), false);
}
