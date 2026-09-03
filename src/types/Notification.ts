export interface Notification {
    id: string
    type: 'caught' | 'follow' | 'new_post'
    fromUserId?: string
    fromUsername?: string // Hydrated on client
    fromUserPhoto?: string // Hydrated on client
    postId?: string
    postThumbnail?: string // Hydrated on client
    createdAt: any // Firestore Timestamp
    read: boolean
}
