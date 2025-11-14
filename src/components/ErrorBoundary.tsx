import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors } from '@/theme/colors'

interface Props {
    children: React.ReactNode
    fallback?: React.ReactNode
}

interface State {
    hasError: boolean
    error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error: Error): State {
        console.error('ErrorBoundary caught error:', error)
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('ErrorBoundary - Component stack:', errorInfo.componentStack)
        console.error('ErrorBoundary - Error:', error.toString())
        console.error('ErrorBoundary - Error stack:', error.stack)
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback
            }

            return (
                <View style={styles.container}>
                    <Text style={styles.title}>Something went wrong</Text>
                    <Text style={styles.error}>
                        {this.state.error?.message || 'Unknown error'}
                    </Text>
                    <TouchableOpacity
                        style={styles.button}
                        onPress={() => this.setState({ hasError: false, error: null })}
                    >
                        <Text style={styles.buttonText}>Try Again</Text>
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
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
        padding: 20,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: colors.textPrimary,
        marginBottom: 16,
    },
    error: {
        fontSize: 14,
        color: colors.error,
        marginBottom: 24,
        textAlign: 'center',
    },
    button: {
        backgroundColor: colors.primary,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    buttonText: {
        color: colors.textPrimary,
        fontSize: 16,
        fontWeight: '600',
    },
})
