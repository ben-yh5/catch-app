import React, { Component, ErrorInfo, ReactNode } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

interface Props {
    children: ReactNode
}

interface State {
    hasError: boolean
}

export default class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false }

    static getDerivedStateFromError(): State {
        return { hasError: true }
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error(error, errorInfo.componentStack)
    }

    handleReload = () => {
        this.setState({ hasError: false })
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

        return this.props.children
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
        backgroundColor: '#007AFF',
        paddingHorizontal: 28,
        paddingVertical: 14,
        borderRadius: 12,
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#ffffff',
    },
})
