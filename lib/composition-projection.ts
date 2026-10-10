/** A sampled physical plane, serialized once and consumed by both painters. */
export type Quad = [
    [
        number,
        number
    ],
    [
        number,
        number
    ],
    [
        number,
        number
    ],
    [
        number,
        number
    ]
];
export type ProjectionState = {
    quad: Quad;
    opacity: number;
    blur: number;
};
export type ProjectionTrack = {
    width: number;
    height: number;
    start: number;
    duration: number;
    end: number;
    before: ProjectionState;
    samples: ProjectionState[];
};
/** Output corners retain left-to-right reading order on the visible face. */
export function projectPlane(width: number, height: number, yaw = 0, roll = 0, scale = 1, x = 0, y = 0, distance = width * 2.6): Quad {
    const ay = yaw * Math.PI / 180, az = roll * Math.PI / 180;
    return [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]].map(([px, py]) => {
        const z = -px * Math.sin(ay), k = distance / (distance - z);
        const xx = px * Math.cos(ay) * k * scale, yy = py * k * scale;
        return [x + xx * Math.cos(az) - yy * Math.sin(az), y + xx * Math.sin(az) + yy * Math.cos(az)];
    }) as Quad;
}
export function sampleProjection(track: ProjectionTrack, time: number): ProjectionState {
    if (time < track.start)
        return track.before;
    if (time >= track.end)
        return { ...track.samples.at(-1)!, opacity: 0 };
    const index = Math.max(0, Math.min(1, (time - track.start) / Math.max(.001, track.duration))) * (track.samples.length - 1);
    const lo = Math.floor(index), hi = Math.min(track.samples.length - 1, lo + 1), p = index - lo;
    const a = track.samples[lo], b = track.samples[hi];
    return { quad: a.quad.map((point, i) => point.map((n, j) => n * (1 - p) + b.quad[i][j] * p)) as Quad, opacity: a.opacity * (1 - p) + b.opacity * p, blur: a.blur * (1 - p) + b.blur * p };
}
/** Maps the rectangle (0,0)..(width,height) to four arbitrary corners. */
export function quadHomography(width: number, height: number, q: Quad): number[] {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    const det = dx1 * dy2 - dx2 * dy1;
    const g = Math.abs(det) < 1e-12 ? 0 : (dx3 * dy2 - dx2 * dy3) / det;
    const h = Math.abs(det) < 1e-12 ? 0 : (dx1 * dy3 - dx3 * dy1) / det;
    return [(x1 - x0 + g * x1) / width, (x3 - x0 + h * x3) / height, x0,
        (y1 - y0 + g * y1) / width, (y3 - y0 + h * y3) / height, y0, g / width, h / height, 1];
}
export function projectionCss(track: ProjectionTrack, time: number, unit: number) {
    const state = sampleProjection(track, time);
    const quad = state.quad.map(([x, y]) => [(x + track.width / 2) * unit, (y + track.height / 2) * unit]) as Quad;
    const [a, b, c, d, e, f, g, h] = quadHomography(track.width * unit, track.height * unit, quad);
    return { transform: `matrix3d(${[a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, 1].join(',')})`, opacity: state.opacity, filter: state.blur ? `blur(${state.blur * unit}px)` : undefined };
}
