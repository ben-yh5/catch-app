import { router } from 'expo-router'
import React, { Component, ErrorInfo, ReactNode } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

interface Props {
    children: ReactNode
}

interface State {
    hasError: boolean
    resetKey: number
}

export default class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false, resetKey: 0 }

    static getDerivedStateFromError(): Partial<State> {
        return { hasError: true }
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error(error, errorInfo.componentStack)
    }

    handleReload = () => {
        // A real reset: remount the subtree AND navigate to the root route,
        // so a deterministic crash in one screen doesn't just re-throw.
        // (Just clearing hasError re-renders the same broken tree forever.)
        this.setState(
            (prev) => ({ hasError: false, resetKey: prev.resetKey + 1 }),
            () => {
                try {
                    router.replace('/')
                } catch (e) {
                    console.error('ErrorBoundary: navigation reset failed', e)
                }
            }
        )
    }

    render() {
        if (this.state.hasError) {
            return (
                <View style={styles.container}>
                    <Text style={styles.title} accessibilityRole="header">
                        Something went wrong
                    </Text>
                    <Text style={styles.message}>
                        The app ran into an unexpected error. Try reloading.
                    </Text>
                    <TouchableOpacity
                        style={styles.button}
                        onPress={this.handleReload}
                        accessibilityRole="button"
                        accessibilityLabel="Reload"
                    >
                        <Text style={styles.buttonText}>Reload</Text>
                    </TouchableOpacity>
                </View>
            )
        }

        return (
            <React.Fragment key={this.state.resetKey}>
                {this.props.children}
            </React.Fragment>
        )
    }
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0a0a0a',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    title: {
        fontSize: 22,
        fontWeight: '700',
        color: '#ffffff',
        marginBottom: 12,
    },
    message: {
        fontSize: 15,
        color: '#98989f',
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 32,
    },
    button: {
        backgroundColor: '#ececee',
        paddingHorizontal: 28,
        paddingVertical: 14,
        borderRadius: 12,
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#000000',
    },
})
