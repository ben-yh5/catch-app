import firebase_admin
from firebase_admin import credentials, firestore
import argparse
import os
from dotenv import load_dotenv

load_dotenv()

# Configuration
SERVICE_ACCOUNT_KEY = 'serviceAccountKey.json'

# Contribution Constants (matching functions/src/index.ts)
CONTRIBUTION = {
    'PIONEER_POST': 10,
    'NEARBY_POST': 2,
    'CATCH': 14,
}

def initialize_firebase():
    """Initializes Firebase Admin SDK."""
    cred = credentials.Certificate(SERVICE_ACCOUNT_KEY)
    try:
        app = firebase_admin.initialize_app(cred)
        return app
    except ValueError:
        return firebase_admin.get_app()

def recount_user_stats(user_id):
    """Recounts totalPosts, totalCatches, and contribution for a user."""
    db = firestore.client()
    
    print(f"analyzing stats for user: {user_id}...")
    
    # Get all posts by this user
    posts_ref = db.collection('posts')
    query = posts_ref.where('authorId', '==', user_id).stream()
    
    total_posts = 0
    total_catches = 0
    calculated_contribution = 0
    
    updates = []
    
    for doc in query:
        data = doc.to_dict()
        post_id = doc.id
        
        if data.get('isOriginal', False):
            total_posts += 1
            contrib = data.get('contributionEarned', 0)
            calculated_contribution += contrib
            # print(f"   Post {post_id}: +{contrib} points")
        else:
            total_catches += 1
            # Catches are worth fixed amount
            catch_value = CONTRIBUTION['CATCH']
            calculated_contribution += catch_value
            # print(f"   Catch {post_id}: +{catch_value} points")
            
            # Check if catch post has contributionEarned (self-healing)
            if data.get('contributionEarned') != catch_value:
                updates.append((doc.reference, {'contributionEarned': catch_value}))

    print(f"Calculated Stats:")
    print(f"   Total Posts: {total_posts}")
    print(f"   Total Catches: {total_catches}")
    print(f"   Contribution: {calculated_contribution}")
    
    # Update User
    user_ref = db.collection('users').document(user_id)
    user_doc = user_ref.get()
    
    if not user_doc.exists:
        print(f"User {user_id} not found!")
        return

    current_data = user_doc.to_dict()
    print(f"\nCurrent Stats (Before):")
    print(f"   Total Posts: {current_data.get('totalPosts', 0)}")
    print(f"   Total Catches: {current_data.get('totalCatches', 0)}")
    print(f"   Contribution: {current_data.get('contribution', 0)}")
    
    print("\nUpdating user stats...", end="")
    user_ref.update({
        'totalPosts': total_posts,
        'totalCatches': total_catches,
        'contribution': calculated_contribution
    })
    print(" Done!")
    
    # Apply self-healing updates
    if updates:
        print(f"Fixing missing contributionEarned on {len(updates)} catch posts...", end="")
        batch = db.batch()
        count = 0
        for ref, data in updates:
            batch.update(ref, data)
            count += 1
            if count >= 400: # Batch limit safety
                batch.commit()
                batch = db.batch()
                count = 0
        if count > 0:
            batch.commit()
        print(" Done!")

def main():
    parser = argparse.ArgumentParser(description='Recount user stats.')
    parser.add_argument('identifier', help='User ID or Username (starts with @)')
    args = parser.parse_args()
    
    initialize_firebase()
    db = firestore.client()
    
    user_id = args.identifier
    
    # Resolve username to ID if needed
    if user_id.startswith('@'):
        username = user_id[1:]
        print(f"Resolving username @{username}...")
        users_ref = db.collection('users')
        query = users_ref.where('username', '==', username).limit(1).stream()
        found = False
        for doc in query:
            user_id = doc.id
            found = True
            break
        
        if not found:
            print(f"Username @{username} not found.")
            return

    recount_user_stats(user_id)

if __name__ == "__main__":
    main()
