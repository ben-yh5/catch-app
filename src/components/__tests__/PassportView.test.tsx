import { fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import PassportView from '../PassportView'

// Mocks
jest.mock('../../services/firebase', () => ({ db: {}, functions: {} }))

const mockGetDoc = jest.fn()
jest.mock('firebase/firestore', () => ({
    doc: jest.fn(),
    getDoc: (...args: any[]) => mockGetDoc(...args),
}))

const mockGetPassportData = jest.fn()
const mockGetPublicPassportData = jest.fn()
jest.mock('../../utils/passportQueries', () => ({
    getPassportData: (...args: any[]) => mockGetPassportData(...args),
    getPublicPassportData: (...args: any[]) =>
        mockGetPublicPassportData(...args),
}))

const lisbonPassport = {
    cities: [
        {
            key: 'Portugal|Lisbon',
            country: 'Portugal',
            city: 'Lisbon',
            posted: 3,
            caught: 12,
            pioneers: 2,
            lastActivity: null,
        },
    ],
    countryCount: 1,
    cityCount: 1,
    pioneerCount: 2,
}

function mockUserDoc() {
    mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ totalCatches: 42 }),
    })
}

describe('PassportView', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('renders stats and the passport cover from the direct doc read', async () => {
        mockUserDoc()
        mockGetPassportData.mockResolvedValue(lisbonPassport)

        const { getByText, getByLabelText } = render(
            <PassportView userId="me" isOwnProfile={true} />
        )

        await waitFor(() => {
            expect(getByLabelText('Open passport cover')).toBeTruthy()
        })
        expect(getByText('PASSPORT')).toBeTruthy()
        expect(getByText('Countries')).toBeTruthy()
        await waitFor(() => {
            expect(getByText('42')).toBeTruthy()
        })
        expect(mockGetPassportData).toHaveBeenCalledWith('me')
        expect(mockGetPublicPassportData).not.toHaveBeenCalled()
    })

    it('opens the book inline when the cover is tapped', async () => {
        mockUserDoc()
        mockGetPassportData.mockResolvedValue(lisbonPassport)

        const { getByLabelText, getByText, queryByLabelText } = render(
            <PassportView userId="me" isOwnProfile={true} />
        )

        await waitFor(() => {
            expect(getByLabelText('Open passport cover')).toBeTruthy()
        })
        // Closed at rest — the book mounts once the cover is tapped open
        expect(queryByLabelText('Passport pages')).toBeNull()

        fireEvent.press(getByLabelText('Open passport cover'))
        await waitFor(() => {
            expect(getByLabelText('Passport pages')).toBeTruthy()
        })
        expect(getByText('LISBON')).toBeTruthy()
        expect(getByText('PORTUGAL')).toBeTruthy()
    })

    it("renders another user's cover via the callable", async () => {
        mockUserDoc()
        mockGetPublicPassportData.mockResolvedValue(lisbonPassport)

        const { getByLabelText } = render(
            <PassportView userId="other" isOwnProfile={false} />
        )

        await waitFor(() => {
            expect(getByLabelText('Open passport cover')).toBeTruthy()
        })
        expect(mockGetPublicPassportData).toHaveBeenCalledWith('other')
        expect(mockGetPassportData).not.toHaveBeenCalled()
    })

    it('shows the private state on permission-denied', async () => {
        mockUserDoc()
        const denied: any = new Error('This passport is private')
        denied.code = 'functions/permission-denied'
        mockGetPublicPassportData.mockRejectedValue(denied)

        const { getByText } = render(
            <PassportView userId="other" isOwnProfile={false} />
        )

        await waitFor(() => {
            expect(getByText('This passport is private')).toBeTruthy()
        })
    })

    it('shows the empty state when there are no cities', async () => {
        mockUserDoc()
        mockGetPassportData.mockResolvedValue({
            cities: [],
            countryCount: 0,
            cityCount: 0,
            pioneerCount: 0,
        })

        const { getByText, queryByLabelText } = render(
            <PassportView userId="me" isOwnProfile={true} />
        )

        await waitFor(() => {
            expect(getByText('No cities yet')).toBeTruthy()
        })
        expect(queryByLabelText('Open passport cover')).toBeNull()
    })

    it('shows an error state and retries on demand', async () => {
        mockUserDoc()
        mockGetPassportData.mockRejectedValueOnce(new Error('offline'))

        const { getByText, getByLabelText } = render(
            <PassportView userId="me" isOwnProfile={true} />
        )

        await waitFor(() => {
            expect(getByText("Couldn't load your passport.")).toBeTruthy()
        })

        mockGetPassportData.mockResolvedValue(lisbonPassport)
        fireEvent.press(getByText('Try Again'))

        await waitFor(() => {
            expect(getByLabelText('Open passport cover')).toBeTruthy()
        })
    })
})
