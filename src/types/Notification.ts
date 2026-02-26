export interface Notification {
    id: string
    type: 'royalty' | 'follow' | 'new_post' | 'xp_post' | 'xp_catch'
    fromUserId?: string
    fromUsername?: string // Hydrated on client
    fromUserPhoto?: string // Hydrated on client
    postId?: string
    postThumbnail?: string // Hydrated on client
    amount?: number
    isPioneer?: boolean // For xp_post: pioneer vs nearby
    createdAt: any // Firestore Timestamp
    read: boolean
}
