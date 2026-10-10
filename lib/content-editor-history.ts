export type EditorHistory<T> = {
    past: T[];
    present: T;
    future: T[];
};
export function pushEditorHistory<T>(old: EditorHistory<T>, present: T, coalesce = false): EditorHistory<T> {
    return { past: coalesce ? old.past : [...old.past, old.present].slice(-150), present, future: [] };
}
export function travelEditorHistory<T>(old: EditorHistory<T>, redo = false): EditorHistory<T> {
    const pool = redo ? old.future : old.past;
    if (!pool.length)
        return old;
    const present = pool.at(-1)!;
    return redo ? { past: [...old.past, old.present], present, future: old.future.slice(0, -1) } : { past: old.past.slice(0, -1), present, future: [...old.future, old.present] };
}
