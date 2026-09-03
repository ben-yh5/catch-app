import { Linking } from 'react-native'

/**
 * Legal document URLs, shown on the welcome screen and in Settings.
 *
 * TODO: replace with the hosted URLs once privacy-policy.html (and a terms
 * page) are published — link taps are no-ops while these are empty.
 */
export const PRIVACY_POLICY_URL = ''
export const TERMS_OF_SERVICE_URL = ''

export const openLegalUrl = (url: string) => {
    if (!url) return
    Linking.openURL(url).catch(() => {})
}
