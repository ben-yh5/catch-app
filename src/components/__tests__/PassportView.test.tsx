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

    it('renders stats and the city list from the direct doc read', async () => {
        mockUserDoc()
        mockGetPassportData.mockResolvedValue(lisbonPassport)

        const { getByText } = render(
            <PassportView userId="me" isOwnProfile={true} />
        )

        await waitFor(() => {
            expect(getByText('Lisbon')).toBeTruthy()
        })
        expect(getByText('Portugal')).toBeTruthy()
        expect(getByText('12 catches · 3 posted')).toBeTruthy()
        expect(getByText('Countries')).toBeTruthy()
        expect(getByText('42')).toBeTruthy()
        expect(getByText('CITIES')).toBeTruthy()
        expect(mockGetPassportData).toHaveBeenCalledWith('me')
        expect(mockGetPublicPassportData).not.toHaveBeenCalled()
    })

    it("renders another user's passport via the callable", async () => {
        mockUserDoc()
        mockGetPublicPassportData.mockResolvedValue(lisbonPassport)

        const { getByText } = render(
            <PassportView userId="other" isOwnProfile={false} />
        )

        await waitFor(() => {
            expect(getByText('Lisbon')).toBeTruthy()
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

        const { getByText, queryByText } = render(
            <PassportView userId="me" isOwnProfile={true} />
        )

        await waitFor(() => {
            expect(getByText('No cities yet')).toBeTruthy()
        })
        expect(queryByText('CITIES')).toBeNull()
    })

    it('shows an error state and retries on demand', async () => {
        mockUserDoc()
        mockGetPassportData.mockRejectedValueOnce(new Error('offline'))

        const { getByText } = render(
            <PassportView userId="me" isOwnProfile={true} />
        )

        await waitFor(() => {
            expect(getByText("Couldn't load your passport.")).toBeTruthy()
        })

        mockGetPassportData.mockResolvedValue(lisbonPassport)
        fireEvent.press(getByText('Try Again'))

        await waitFor(() => {
            expect(getByText('Lisbon')).toBeTruthy()
        })
    })
})
