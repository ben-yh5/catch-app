import {
    clusterCellsToGeoJSON,
    CoverageCell,
    decodeGeohashBBox,
} from '../coverageQueries'

jest.mock('../../services/firebase', () => ({ db: {} }))

function cell(overrides: Partial<CoverageCell>): CoverageCell {
    return {
        geohash: 'u4pru',
        precision: 5,
        postCount: 1,
        originalCount: 1,
        bbox: [10, 20, 12, 22],
        ...overrides,
    }
}

describe('clusterCellsToGeoJSON', () => {
    it('emits one point per cell with originals, centered in the cell', () => {
        const fc = clusterCellsToGeoJSON([
            cell({ geohash: 'aaaaa', originalCount: 7, bbox: [10, 20, 12, 22] }),
        ])

        expect(fc.features).toHaveLength(1)
        const feature = fc.features[0]
        expect(feature.properties).toEqual({ geohash: 'aaaaa', count: 7 })
        // GeoJSON coordinates are [lon, lat]; center of bbox
        expect((feature.geometry as GeoJSON.Point).coordinates).toEqual([
            21, 11,
        ])
    })

    it('drops cells whose posts are all catches (originalCount 0)', () => {
        const fc = clusterCellsToGeoJSON([
            cell({ geohash: 'aaaaa', postCount: 5, originalCount: 0 }),
            cell({ geohash: 'bbbbb', postCount: 3, originalCount: 2 }),
        ])

        expect(fc.features).toHaveLength(1)
        expect(fc.features[0].properties?.geohash).toBe('bbbbb')
    })

    it('returns an empty collection for no cells', () => {
        expect(clusterCellsToGeoJSON([]).features).toHaveLength(0)
    })
})

describe('decodeGeohashBBox', () => {
    it('round-trips a known geohash to a bbox containing its point', () => {
        // 'u4pruydqqvj' ≈ 57.64911, 10.40744 (classic geohash example)
        const [minLat, minLon, maxLat, maxLon] = decodeGeohashBBox('u4pru')
        expect(minLat).toBeLessThanOrEqual(57.64911)
        expect(maxLat).toBeGreaterThanOrEqual(57.64911)
        expect(minLon).toBeLessThanOrEqual(10.40744)
        expect(maxLon).toBeGreaterThanOrEqual(10.40744)
    })
})
