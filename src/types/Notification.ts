export interface Notification {
    id: string
    type: 'caught' | 'follow' | 'new_post'
    fromUserId?: string
    fromUsername?: string // Hydrated on client
    fromUserPhoto?: string // Hydrated on client
    postId?: string
    postThumbnail?: string // Hydrated on client
    // caught only — written by onPostCreated (older docs lack them; the
    // client falls back to the plain thread path)
    catchPostId?: string // The catcher's post (postId is the ROOT)
    city?: string | null // Postmark city from the root's locationMeta
    catchPhotoURL?: string // Hydrated on client
    catchCreatedAt?: any // Hydrated on client (Firestore Timestamp)
    createdAt: any // Firestore Timestamp
    read: boolean
}
