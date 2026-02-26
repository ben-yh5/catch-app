import 'dotenv/config'

export default {
    expo: {
        name: 'catch-app',
        slug: 'catch-app',
        owner: 'staticvoid12',
        version: '1.0.0',
        orientation: 'portrait',
        icon: './assets/images/icon.png',
        scheme: 'catchapp',
        userInterfaceStyle: 'automatic',
        newArchEnabled: true,
        ios: {
            bundleIdentifier: 'app.catchapp.mobile',
            supportsTablet: true,
            googleServicesFile: './GoogleService-Info.plist', // Download from Firebase Console
        },
        android: {
            package: 'app.catchapp.mobile',
            googleServicesFile: process.env.GOOGLE_SERVICES_JSON || './google-services.json',
            adaptiveIcon: {
                backgroundColor: '#E6F4FE',
                foregroundImage: './assets/images/android-icon-foreground.png',
                backgroundImage: './assets/images/android-icon-background.png',
                monochromeImage: './assets/images/android-icon-monochrome.png',
            },
            edgeToEdgeEnabled: true,
            predictiveBackGestureEnabled: false,
            config: {
                googleMaps: {
                    apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
                },
            },
        },
        web: {
            output: 'static',
            favicon: './assets/images/favicon.png',
        },
        plugins: [
            'expo-router',
            'expo-dev-client',
            [
                'expo-splash-screen',
                {
                    image: './assets/images/splash-icon.png',
                    imageWidth: 200,
                    resizeMode: 'contain',
                    backgroundColor: '#ffffff',
                    dark: {
                        backgroundColor: '#000000',
                    },
                },
            ],
            [
                'expo-notifications',
                {
                    color: '#ffffff',
                },
            ],
            '@rnmapbox/maps',
            '@react-native-firebase/app',
            '@react-native-firebase/app-check',
        ],
        experiments: {
            typedRoutes: true,
            reactCompiler: true,
        },
        extra: {
            "eas": {
                "projectId": "7d162c30-e195-4cf1-929d-9e3e2c6ebcda"
            }
        },
    },
}
