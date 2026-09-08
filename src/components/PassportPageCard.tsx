/**
 * PassportPageCard - The passport-page surface the payoff modals mount
 * their photos on: page paper, the mounted content, and an ink stamp
 * slamming down over the content's bottom edge.
 *
 * Shared by PostStampModal (POSTED) and CatchRevealModal (CAUGHT) so the
 * two payoff moments stay the same physical object.
 */

import PassportStamp, {
    StampPlace,
    StampVariant,
} from '@/components/PassportStamp'
import { paper, PRINT_PAPER } from '@/theme/document'
import { radii, spacing } from '@/theme/tokens'
import React from 'react'
import { StyleSheet, View } from 'react-native'

interface PassportPageCardProps {
    variant: StampVariant
    place?: StampPlace | null
    /** ms before the stamp slams (sync with surrounding animations) */
    stampDelay: number
    stampSize: number
    /** px the stamp rides up over the content below it, like ink over the page */
    overlap: number
    children: React.ReactNode
}

export default function PassportPageCard({
    variant,
    place,
    stampDelay,
    stampSize,
    overlap,
    children,
}: PassportPageCardProps) {
    return (
        <View style={styles.pageCard}>
            {/* Photos sit on print stock — thicker bottom edge like a
                physical print; the stamp then inks over the print */}
            <View style={styles.printMount}>{children}</View>
            <View
                style={[styles.stampWrap, { marginTop: -overlap }]}
                pointerEvents="none"
            >
                <PassportStamp
                    variant={variant}
                    place={place}
                    delay={stampDelay}
                    size={stampSize}
                />
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    pageCard: {
        width: '100%',
        backgroundColor: paper.surface,
        borderRadius: radii.lg,
        padding: 10,
        paddingBottom: spacing.lg,
    },
    printMount: {
        backgroundColor: PRINT_PAPER,
        padding: 7,
        paddingBottom: 22,
        borderRadius: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.35,
        shadowRadius: 5,
        elevation: 3,
    },
    stampWrap: {
        alignSelf: 'center',
    },
})
