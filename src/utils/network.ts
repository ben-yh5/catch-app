/**
 * Connectivity helpers (expo-network).
 *
 * `isInternetReachable` can be null/undefined while the OS is still probing —
 * only an explicit `false` counts as unreachable, so a slow probe never
 * misroutes a healthy submit into the offline outbox.
 */

import * as Network from 'expo-network'

export async function isOffline(): Promise<boolean> {
    try {
        const state = await Network.getNetworkStateAsync()
        return !state.isConnected || state.isInternetReachable === false
    } catch {
        // If the platform can't even report network state, assume online and
        // let the real request succeed or fail on its own merits
        return false
    }
}

export function isOnlineState(state: Network.NetworkState): boolean {
    return !!state.isConnected && state.isInternetReachable !== false
}
