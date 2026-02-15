import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, arrayUnion, arrayRemove } from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'catch-rules-test',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

// ─── USERS COLLECTION ────────────────────────────────────────────────

describe('users collection', () => {
  const USER_ID = 'user1';
  const OTHER_USER_ID = 'user2';

  const seedUser = async (userId: string, data: Record<string, any> = {}) => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', userId), {
        username: 'testuser',
        email: 'test@test.com',
        totalPosts: 0,
        totalCatches: 0,
        contribution: 0,
        followers: [],
        following: [],
        pushToken: null,
        createdAt: new Date(),
        ...data,
      });
    });
  };

  // --- Read ---

  test('unauthenticated user CANNOT read user profiles', async () => {
    await seedUser(USER_ID);
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(unauthed.firestore(), 'users', USER_ID)));
  });

  test('authenticated user can read own profile', async () => {
    await seedUser(USER_ID);
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertSucceeds(getDoc(doc(authed.firestore(), 'users', USER_ID)));
  });

  test('authenticated user can read other user profiles', async () => {
    await seedUser(USER_ID);
    const otherAuthed = testEnv.authenticatedContext(OTHER_USER_ID);
    await assertSucceeds(getDoc(doc(otherAuthed.firestore(), 'users', USER_ID)));
  });

  // --- Create ---

  test('user can create their own document', async () => {
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertSucceeds(
      setDoc(doc(authed.firestore(), 'users', USER_ID), {
        username: 'newuser',
        email: 'new@test.com',
        followers: [],
        following: [],
      })
    );
  });

  test('user cannot create another user document', async () => {
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      setDoc(doc(authed.firestore(), 'users', OTHER_USER_ID), {
        username: 'hacked',
      })
    );
  });

  // --- Self-update (allowlisted fields) ---

  test('owner can update allowlisted fields', async () => {
    await seedUser(USER_ID);
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertSucceeds(
      updateDoc(doc(authed.firestore(), 'users', USER_ID), {
        username: 'newname',
      })
    );
  });

  test('owner can update pushToken', async () => {
    await seedUser(USER_ID);
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertSucceeds(
      updateDoc(doc(authed.firestore(), 'users', USER_ID), {
        pushToken: 'new-token-123',
      })
    );
  });

  test('owner can update notificationSettings', async () => {
    await seedUser(USER_ID);
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertSucceeds(
      updateDoc(doc(authed.firestore(), 'users', USER_ID), {
        notificationSettings: { push: false },
      })
    );
  });

  test('owner can update dataContributionEnabled', async () => {
    await seedUser(USER_ID);
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertSucceeds(
      updateDoc(doc(authed.firestore(), 'users', USER_ID), {
        dataContributionEnabled: true,
      })
    );
  });

  test('owner CANNOT update following array (managed by Cloud Functions)', async () => {
    await seedUser(USER_ID);
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', USER_ID), {
        following: arrayUnion('someUserId'),
      })
    );
  });

  // --- Self-update BLOCKED for server-computed fields ---

  test('owner CANNOT update contribution', async () => {
    await seedUser(USER_ID);
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', USER_ID), {
        contribution: 999999,
      })
    );
  });

  test('owner CANNOT update totalPosts', async () => {
    await seedUser(USER_ID);
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', USER_ID), {
        totalPosts: 10000,
      })
    );
  });

  test('owner CANNOT update totalCatches', async () => {
    await seedUser(USER_ID);
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', USER_ID), {
        totalCatches: 10000,
      })
    );
  });

  // --- Followers/following managed by Cloud Functions only ---

  test('other user CANNOT update followers (managed by Cloud Functions)', async () => {
    await seedUser(USER_ID);
    const otherAuthed = testEnv.authenticatedContext(OTHER_USER_ID);
    await assertFails(
      updateDoc(doc(otherAuthed.firestore(), 'users', USER_ID), {
        followers: arrayUnion(OTHER_USER_ID),
      })
    );
  });

  test('other user CANNOT update any fields on another user', async () => {
    await seedUser(USER_ID);
    const otherAuthed = testEnv.authenticatedContext(OTHER_USER_ID);
    await assertFails(
      updateDoc(doc(otherAuthed.firestore(), 'users', USER_ID), {
        username: 'hacked',
      })
    );
  });

  test('unauthenticated user CANNOT update user documents', async () => {
    await seedUser(USER_ID);
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(
      updateDoc(doc(unauthed.firestore(), 'users', USER_ID), {
        followers: arrayUnion('nobody'),
      })
    );
  });
});

// ─── NOTIFICATIONS SUBCOLLECTION ─────────────────────────────────────

describe('notifications subcollection', () => {
  const USER_ID = 'user1';
  const OTHER_USER_ID = 'user2';
  const NOTIF_ID = 'notif1';

  const seedNotification = async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', USER_ID), {
        username: 'testuser',
        followers: [],
        following: [],
      });
      await setDoc(
        doc(context.firestore(), 'users', USER_ID, 'notifications', NOTIF_ID),
        {
          type: 'royalty',
          amount: 7,
          fromUserId: OTHER_USER_ID,
          read: false,
          createdAt: new Date(),
        }
      );
    });
  };

  test('owner can read their notifications', async () => {
    await seedNotification();
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertSucceeds(
      getDoc(doc(authed.firestore(), 'users', USER_ID, 'notifications', NOTIF_ID))
    );
  });

  test('owner can list their notifications', async () => {
    await seedNotification();
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertSucceeds(
      getDocs(collection(authed.firestore(), 'users', USER_ID, 'notifications'))
    );
  });

  test('owner can mark notification as read', async () => {
    await seedNotification();
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertSucceeds(
      updateDoc(
        doc(authed.firestore(), 'users', USER_ID, 'notifications', NOTIF_ID),
        { read: true }
      )
    );
  });

  test('owner CANNOT update non-read fields on notification', async () => {
    await seedNotification();
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      updateDoc(
        doc(authed.firestore(), 'users', USER_ID, 'notifications', NOTIF_ID),
        { type: 'hacked' }
      )
    );
  });

  test('owner can delete their notification', async () => {
    await seedNotification();
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertSucceeds(
      deleteDoc(doc(authed.firestore(), 'users', USER_ID, 'notifications', NOTIF_ID))
    );
  });

  test('other user CANNOT read notifications', async () => {
    await seedNotification();
    const otherAuthed = testEnv.authenticatedContext(OTHER_USER_ID);
    await assertFails(
      getDoc(doc(otherAuthed.firestore(), 'users', USER_ID, 'notifications', NOTIF_ID))
    );
  });

  test('other user CANNOT delete notifications', async () => {
    await seedNotification();
    const otherAuthed = testEnv.authenticatedContext(OTHER_USER_ID);
    await assertFails(
      deleteDoc(doc(otherAuthed.firestore(), 'users', USER_ID, 'notifications', NOTIF_ID))
    );
  });

  test('no one can create notifications client-side', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', USER_ID), {
        username: 'testuser',
        followers: [],
        following: [],
      });
    });
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      setDoc(
        doc(authed.firestore(), 'users', USER_ID, 'notifications', 'new-notif'),
        { type: 'follow', read: false, createdAt: new Date() }
      )
    );
  });
});

// ─── POSTS COLLECTION ────────────────────────────────────────────────

describe('posts collection', () => {
  const USER_ID = 'user1';
  const OTHER_USER_ID = 'user2';

  const validPost = {
    authorId: USER_ID,
    authorUsername: 'testuser',
    photoURL: 'https://example.com/photo.jpg',
    caption: 'test caption',
    hasLocation: true,
    catchCount: 0,
    isOriginal: true,
    createdAt: new Date(),
  };

  test('authenticated user can create post with own authorId', async () => {
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertSucceeds(
      setDoc(doc(authed.firestore(), 'posts', 'post1'), validPost)
    );
  });

  test('CANNOT create post with spoofed authorId', async () => {
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      setDoc(doc(authed.firestore(), 'posts', 'post1'), {
        ...validPost,
        authorId: OTHER_USER_ID,
      })
    );
  });

  test('unauthenticated user CANNOT create post', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(
      setDoc(doc(unauthed.firestore(), 'posts', 'post1'), validPost)
    );
  });

  test('anyone can read posts', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'posts', 'post1'), validPost);
    });
    const unauthed = testEnv.unauthenticatedContext();
    await assertSucceeds(getDoc(doc(unauthed.firestore(), 'posts', 'post1')));
  });

  test('author can delete own post', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'posts', 'post1'), validPost);
    });
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertSucceeds(deleteDoc(doc(authed.firestore(), 'posts', 'post1')));
  });

  test('other user CANNOT delete post', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'posts', 'post1'), validPost);
    });
    const otherAuthed = testEnv.authenticatedContext(OTHER_USER_ID);
    await assertFails(deleteDoc(doc(otherAuthed.firestore(), 'posts', 'post1')));
  });

  test('NO ONE can update posts client-side (catchCount blocked)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'posts', 'post1'), validPost);
    });
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      updateDoc(doc(authed.firestore(), 'posts', 'post1'), {
        catchCount: 999,
      })
    );
  });

  test('author CANNOT update own post either', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'posts', 'post1'), validPost);
    });
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      updateDoc(doc(authed.firestore(), 'posts', 'post1'), {
        caption: 'edited',
      })
    );
  });
});

// ─── POST LOCATIONS COLLECTION ───────────────────────────────────────

describe('post_locations collection', () => {
  const USER_ID = 'user1';

  const validLocation = {
    postId: 'post1',
    latitude: 40.7128,
    longitude: -74.006,
    geohash: 'dr5reg',
    createdAt: new Date(),
  };

  test('authenticated user can create with valid data', async () => {
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertSucceeds(
      setDoc(doc(authed.firestore(), 'post_locations', 'loc1'), validLocation)
    );
  });

  test('CANNOT create without postId', async () => {
    const authed = testEnv.authenticatedContext(USER_ID);
    const { postId, ...noPostId } = validLocation;
    await assertFails(
      setDoc(doc(authed.firestore(), 'post_locations', 'loc1'), noPostId)
    );
  });

  test('CANNOT create without geohash', async () => {
    const authed = testEnv.authenticatedContext(USER_ID);
    const { geohash, ...noGeohash } = validLocation;
    await assertFails(
      setDoc(doc(authed.firestore(), 'post_locations', 'loc1'), noGeohash)
    );
  });

  test('CANNOT create with latitude out of range (> 90)', async () => {
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      setDoc(doc(authed.firestore(), 'post_locations', 'loc1'), {
        ...validLocation,
        latitude: 999,
      })
    );
  });

  test('CANNOT create with latitude out of range (< -90)', async () => {
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      setDoc(doc(authed.firestore(), 'post_locations', 'loc1'), {
        ...validLocation,
        latitude: -91,
      })
    );
  });

  test('CANNOT create with longitude out of range (> 180)', async () => {
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      setDoc(doc(authed.firestore(), 'post_locations', 'loc1'), {
        ...validLocation,
        longitude: 181,
      })
    );
  });

  test('CANNOT create with non-numeric latitude', async () => {
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      setDoc(doc(authed.firestore(), 'post_locations', 'loc1'), {
        ...validLocation,
        latitude: 'not-a-number',
      })
    );
  });

  test('no one can read post_locations', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'post_locations', 'loc1'), validLocation);
    });
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(getDoc(doc(authed.firestore(), 'post_locations', 'loc1')));
  });

  test('no one can update post_locations', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'post_locations', 'loc1'), validLocation);
    });
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      updateDoc(doc(authed.firestore(), 'post_locations', 'loc1'), {
        latitude: 0,
      })
    );
  });

  test('no one can delete post_locations', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'post_locations', 'loc1'), validLocation);
    });
    const authed = testEnv.authenticatedContext(USER_ID);
    await assertFails(
      deleteDoc(doc(authed.firestore(), 'post_locations', 'loc1'))
    );
  });

  test('unauthenticated user CANNOT create post_locations', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(
      setDoc(doc(unauthed.firestore(), 'post_locations', 'loc1'), validLocation)
    );
  });
});
