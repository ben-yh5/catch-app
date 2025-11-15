import 'dotenv/config'

export default {
    expo: {
        name: 'catch-app',
        slug: 'catch-app',
        version: '1.0.0',
        orientation: 'portrait',
        icon: './assets/images/icon.png',
        scheme: 'catchapp',
        userInterfaceStyle: 'automatic',
        newArchEnabled: true,
        ios: {
            bundleIdentifier: 'com.anonymous.catchapp',
            supportsTablet: true,
        },
        android: {
            package: 'com.anonymous.catchapp',
            adaptiveIcon: {
                backgroundColor: '#E6F4FE',
                foregroundImage: './assets/images/android-icon-foreground.png',
                backgroundImage: './assets/images/android-icon-background.png',
                monochromeImage: './assets/images/android-icon-monochrome.png',
            },
            edgeToEdgeEnabled: true,
            predictiveBackGestureEnabled: false,
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
        ],
        experiments: {
            typedRoutes: true,
            reactCompiler: true,
        },
        extra: {},
    },
}
