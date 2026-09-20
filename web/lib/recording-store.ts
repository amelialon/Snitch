export interface SavedRecording { id: string; interviewId: string; mimeType: string; createdAt: number }

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("interview-recordings", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("sessions", { keyPath: "id" });
      request.result.createObjectStore("chunks", { keyPath: ["sessionId", "index"] });
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function write(stores: string[], action: (tx: IDBTransaction) => void) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite"); tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error("Recording storage interrupted.")); action(tx);
  }); } finally { db.close(); }
}
export const saveRecordingSession = (session: SavedRecording) => write(["sessions"], tx => tx.objectStore("sessions").put(session));
export const saveRecordingChunk = (sessionId: string, index: number, blob: Blob) => write(["chunks"], tx => tx.objectStore("chunks").put({ sessionId, index, blob }));
export const removeRecording = (id: string) => write(["sessions", "chunks"], tx => {
  tx.objectStore("sessions").delete(id); tx.objectStore("chunks").delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
});
export async function recoverRecording(interviewId: string): Promise<{ session: SavedRecording; blob: Blob } | null> {
  const db = await database();
  try {
    const sessions = await new Promise<SavedRecording[]>((resolve, reject) => {
      const request = db.transaction("sessions").objectStore("sessions").getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const session = sessions.filter(s => s.interviewId === interviewId).sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!session) return null;
    const chunks = await new Promise<{ index: number; blob: Blob }[]>((resolve, reject) => {
      const request = db.transaction("chunks").objectStore("chunks").getAll(IDBKeyRange.bound([session.id, 0], [session.id, Number.MAX_SAFE_INTEGER]));
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return { session, blob: new Blob(chunks.sort((a, b) => a.index - b.index).map(c => c.blob), { type: session.mimeType }) };
  } finally { db.close(); }
}
