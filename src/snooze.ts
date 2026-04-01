/**
 * Sleep equivalent as a promise
 * @param ms Number of ms
 * @returns void
 */
export function snooze(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export default snooze;
