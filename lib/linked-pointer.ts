/** Track a marquee outside its list without capturing ordinary cue clicks. */
export function trackLinkedPointer(target: Pick<Window, "addEventListener" | "removeEventListener">, pointerId: number, onMove: (event: PointerEvent) => void, onFinish: (cancel: boolean) => void) {
    let active = true;
    function cleanup() {
        active = false;
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
        target.removeEventListener("pointercancel", cancel);
        target.removeEventListener("blur", blur);
    }
    function finish(cancelled: boolean) {
        if (!active)
            return;
        cleanup();
        onFinish(cancelled);
    }
    function move(event: Event) {
        const pointer = event as PointerEvent;
        if (pointer.pointerId !== pointerId)
            return;
        if (!(pointer.buttons & 1))
            finish(true);
        else
            onMove(pointer);
    }
    function up(event: Event) {
        const pointer = event as PointerEvent;
        if (pointer.pointerId !== pointerId)
            return;
        onMove(pointer);
        finish(false);
    }
    function cancel(event: Event) {
        if ((event as PointerEvent).pointerId === pointerId)
            finish(true);
    }
    function blur() { finish(true); }
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", cancel);
    target.addEventListener("blur", blur);
    return cleanup;
}
