import { Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// Material 3 BottomNavigationView height (dp). The bar also absorbs the
// system navigation inset as internal padding, so its full block is
// 80 + insets.bottom.
const ANDROID_TAB_BAR_HEIGHT = 80

/**
 * Bottom padding that keeps content clear of the native tab bar, for
 * screens inside the (tabs) navigator.
 *
 * The SDK 54 native-tabs alpha lays tab screens out at full host height on
 * Android while the platform view actually sits above the bar, so the
 * bottom bar-height of every tab screen is clipped behind it (fixed
 * upstream in Expo Router v55 — delete this hook after upgrading). iOS
 * needs nothing here: scrollables handle the overlaying bar natively via
 * contentInsetAdjustmentBehavior="automatic".
 */
export function useTabBarInset(): number {
    const insets = useSafeAreaInsets()
    return Platform.OS === 'android'
        ? ANDROID_TAB_BAR_HEIGHT + insets.bottom
        : 0
}
