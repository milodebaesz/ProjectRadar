import { useEffect, useState } from "react";
import { currentUser, onAuthChange } from "../lib/pocketbase";

/** Houdt het ingelogde e-mailadres bij via de PocketBase auth-store. */
export function useAuth(): string | null {
  const [userEmail, setUserEmail] = useState<string | null>(currentUser()?.email ?? null);
  useEffect(() => onAuthChange(() => setUserEmail(currentUser()?.email ?? null)), []);
  return userEmail;
}
