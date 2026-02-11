import 'dotenv/config'

export default {
    expo: {
        name: 'catch-app',
        slug: 'catch-app',
        owner: 'your-expo-username', // Replace with your Expo username if using EAS
        version: '1.0.0',
        orientation: 'portrait',
        icon: './assets/images/icon.png',
        scheme: 'catchapp',
        userInterfaceStyle: 'automatic',
        newArchEnabled: true,
        ios: {
            bundleIdentifier: 'app.catchapp.mobile',
            supportsTablet: true,
        },
        android: {
            package: 'app.catchapp.mobile',
            googleServicesFile: './google-services.json',
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
        ],
        experiments: {
            typedRoutes: true,
            reactCompiler: true,
        },
        extra: {},
    },
}
