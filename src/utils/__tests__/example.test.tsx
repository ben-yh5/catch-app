import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { View, Text } from 'react-native';

const TestComponent = () => {
    return (
        <View>
        <Text>Hello Testing! </Text>
            </View>
  );
};

describe('Sanity Check', () => {
    it('renders correctly', () => {
        render(<TestComponent />);
        expect(screen.getByText('Hello Testing!')).toBeTruthy();
    });

    it('basic math works', () => {
        expect(1 + 1).toBe(2);
    });
});
