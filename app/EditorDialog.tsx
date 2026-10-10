import { useEffect, useRef, type ReactNode } from "react";
export function EditorDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="sc-reminder" onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="sc-reminder-title">
    <h2 id="sc-reminder-title">{title}</h2>{children}
  </dialog>;
}
