/** Build a minimal CallableContext for testing callable functions. */
export function makeContext(uid: string, overrides?: Record<string, any>) {
    return {
        auth: { uid, token: { email: `${uid}@test.com` } },
        app: { appId: 'test-app' },
        ...overrides,
    } as any
}

/** Build a CallableContext with no auth (unauthenticated). */
export function makeUnauthContext() {
    return { auth: undefined, app: undefined } as any
}
