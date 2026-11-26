/**
 * PREVIEW BUILD ONLY. expo-secure-store has no web implementation (every call throws), so the
 * Supabase session could not be stored. In the preview build it is backed by localStorage, which
 * lets the preview driver seed a signed-in session. Only the three calls the app uses exist.
 */
export async function getItemAsync(key: string): Promise<string | null> {
  return localStorage.getItem(key);
}
export async function setItemAsync(key: string, value: string): Promise<void> {
  localStorage.setItem(key, value);
}
export async function deleteItemAsync(key: string): Promise<void> {
  localStorage.removeItem(key);
}
