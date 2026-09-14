import { Linking } from 'react-native'

/**
 * Legal document URLs, shown on the welcome screen and in Settings.
 *
 * TODO: terms page not yet published — its link tap is a no-op while empty.
 */
export const PRIVACY_POLICY_URL = 'https://ben-yh5.github.io/catch/privacy'
export const ACCOUNT_DELETION_URL = 'https://ben-yh5.github.io/catch/delete-account'
export const TERMS_OF_SERVICE_URL = ''

export const openLegalUrl = (url: string) => {
    if (!url) return
    Linking.openURL(url).catch(() => {})
}
