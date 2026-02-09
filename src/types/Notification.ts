export interface Notification {
    id: string
    type: 'royalty' | 'follow'
    fromUserId?: string
    fromUsername?: string // Hydrated on client
    fromUserPhoto?: string // Hydrated on client
    postId?: string
    postThumbnail?: string // Hydrated on client
    amount?: number
    createdAt: any // Firestore Timestamp
    read: boolean
}
