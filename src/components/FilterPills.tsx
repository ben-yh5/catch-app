import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '@/theme/colors';

export type FilterType = 'trending' | 'new' | 'near';

interface FilterPillsProps {
  activeFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  nearDisabled?: boolean;
}

export default function FilterPills({ activeFilter, onFilterChange, nearDisabled = false }: FilterPillsProps) {
  const filters: { type: FilterType; label: string; emoji: string }[] = [
    { type: 'trending', label: 'Trending', emoji: '🔥' },
    { type: 'new', label: 'New', emoji: '⚡' },
    { type: 'near', label: 'Near', emoji: '📍' },
  ];

  return (
    <View style={styles.container}>
      {filters.map((filter) => {
        const isActive = activeFilter === filter.type;
        const isDisabled = filter.type === 'near' && nearDisabled;

        return (
          <TouchableOpacity
            key={filter.type}
            style={[
              styles.pill,
              isActive && styles.pillActive,
              isDisabled && styles.pillDisabled,
            ]}
            onPress={() => !isDisabled && onFilterChange(filter.type)}
            disabled={isDisabled}
            activeOpacity={0.7}
          >
            <Text style={styles.emoji}>{filter.emoji}</Text>
            <Text
              style={[
                styles.label,
                isActive && styles.labelActive,
                isDisabled && styles.labelDisabled,
              ]}
            >
              {filter.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pillDisabled: {
    opacity: 0.4,
  },
  emoji: {
    fontSize: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  labelActive: {
    color: '#fff',
  },
  labelDisabled: {
    color: colors.textSecondary,
  },
});
