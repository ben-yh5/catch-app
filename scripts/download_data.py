import firebase_admin
from firebase_admin import credentials, firestore, storage
import os
import requests
import json
import argparse
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Configuration
SERVICE_ACCOUNT_KEY = 'serviceAccountKey.json'
DATA_DIR = Path('training_data/raw')
STORAGE_BUCKET = os.getenv('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET')

def initialize_firebase():
    """Initializes Firebase Admin SDK."""

    cred = credentials.Certificate(SERVICE_ACCOUNT_KEY)
    try:
        app = firebase_admin.initialize_app(cred, {
            'storageBucket': STORAGE_BUCKET
        })
        return app
    except ValueError:
        # App already initialized
        return firebase_admin.get_app()

def download_image(url, save_path):
    """Downloads an image from a URL (if public) or Storage blob."""
    try:
        # Ensure parent directory exists
        save_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Try downloading via requests first (if public URL)
        if url.startswith('http'):
            response = requests.get(url, stream=True)
            if response.status_code == 200:
                with open(save_path, 'wb') as f:
                    for chunk in response.iter_content(1024):
                        f.write(chunk)
                return True
        
        return False
    except Exception as e:
        print(f"   ⚠️ Failed to download {save_path.name}: {e}")
        return False

def scan_storage_bucket(bucket, limit):
    """Scans the storage bucket directly for training_data/ folders."""
    print("\n📦 Scanning Storage Bucket directly...")
    
    blobs = list(bucket.list_blobs(prefix='training_data/'))
    
    # Group by parent folder
    pairs = {}
    for blob in blobs:
        parts = blob.name.split('/')
        # Expected: training_data/{pairId}/{filename}
        if len(parts) >= 3:
            pair_id = parts[1]
            filename = parts[-1]
            
            if pair_id not in pairs:
                pairs[pair_id] = {}
            
            pairs[pair_id][filename] = blob.name

    print(f"   Found {len(pairs)} folders in Storage.")
    
    count = 0
    manifest = {}
    
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    sorted_pairs = list(pairs.items())[:limit]
    
    for pair_id, files in sorted_pairs:
        print(f"Processing {pair_id}...")
        
        pair_dir = DATA_DIR / pair_id
        pair_dir.mkdir(parents=True, exist_ok=True)
        
        original_path = pair_dir / 'original.jpg'
        catch_path = pair_dir / 'catch.jpg'
        
        # Download Original
        if 'original.jpg' in files:
            blob = bucket.blob(files['original.jpg'])
            blob.download_to_filename(str(original_path))
        
        # Download Catch
        if 'catch.jpg' in files:
            blob = bucket.blob(files['catch.jpg'])
            blob.download_to_filename(str(catch_path))
            
        if original_path.exists() and catch_path.exists():
            manifest[pair_id] = {
                'original': str(original_path),
                'catch': str(catch_path),
                'label': 'POSITIVE', 
                'id': pair_id
            }
            count += 1
            print("   ✅ Downloaded.")
    
    return manifest

def main():
    parser = argparse.ArgumentParser(description='Download training data from Firebase.')
    parser.add_argument('--limit', type=int, default=100, help='Max number of pairs to download')
    args = parser.parse_args()

    app = initialize_firebase()
    if not app:
        return

    db = firestore.client()
    bucket = storage.bucket() # Uses default bucket from config

    print(f"🚀 Scanning Storage Bucket for training pairs (Limit: {args.limit})...")
    
    # Verify Project ID
    try:
        project_id = db.project
        print(f"   Connected to Project ID: {project_id}")
    except:
        pass

    # Directly scan storage bucket as requested
    manifest = scan_storage_bucket(bucket, args.limit)

    # Save Manifest
    if manifest:
        with open(DATA_DIR / 'manifest.json', 'w') as f:
            json.dump(manifest, f, indent=2)

        print(f"\n🎉 Done! Processed {len(manifest)} pairs.")
        print(f"📂 Data saved to: {DATA_DIR.resolve()}")
    else:
        print("\n❌ No data found in Storage.")

if __name__ == "__main__":
    main()
