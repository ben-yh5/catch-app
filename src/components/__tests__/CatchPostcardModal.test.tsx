import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import CatchPostcardModal from '../CatchPostcardModal'
import { Notification } from '../../types/Notification'

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

const hydratedNotification: Notification = {
    id: 'n1',
    type: 'caught',
    fromUserId: 'u2',
    fromUsername: 'wanderer',
    postId: 'root1',
    catchPostId: 'catch1',
    catchPhotoURL: 'https://example.com/catch.jpg',
    city: 'Lisbon',
    createdAt: null,
    read: false,
}

describe('CatchPostcardModal', () => {
    it('renders the postcard front for a hydrated caught notification', () => {
        const { getByLabelText } = render(
            <CatchPostcardModal
                visible
                notification={hydratedNotification}
                onOpenThread={jest.fn()}
                onClose={jest.fn()}
            />
        )
        expect(
            getByLabelText('Postcard from @wanderer. Tap to turn over')
        ).toBeTruthy()
        // Postmark carries the city
        expect(getByLabelText(/LISBON stamp/)).toBeTruthy()
    })

    it('routes into the thread via the catch post id', () => {
        const onOpenThread = jest.fn()
        const { getByText } = render(
            <CatchPostcardModal
                visible
                notification={hydratedNotification}
                onOpenThread={onOpenThread}
                onClose={jest.fn()}
            />
        )
        fireEvent.press(getByText(/see this place's timeline/i))
        expect(onOpenThread).toHaveBeenCalledWith('catch1')
    })

    it('renders nothing without a hydrated catch photo (old-format docs)', () => {
        const { toJSON } = render(
            <CatchPostcardModal
                visible
                notification={{
                    ...hydratedNotification,
                    catchPhotoURL: undefined,
                }}
                onOpenThread={jest.fn()}
                onClose={jest.fn()}
            />
        )
        expect(toJSON()).toBeNull()
    })

    it('falls back to the act word on the postmark when city is unknown', () => {
        const { getByLabelText } = render(
            <CatchPostcardModal
                visible
                notification={{ ...hydratedNotification, city: null }}
                onOpenThread={jest.fn()}
                onClose={jest.fn()}
            />
        )
        expect(getByLabelText(/CAUGHT stamp/)).toBeTruthy()
    })
})
